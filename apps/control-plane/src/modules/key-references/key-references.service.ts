import { Injectable, NotFoundException } from '@nestjs/common';
import { getPrismaClient, Prisma, type KeyState } from '@sep/db';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { AuditService } from '../audit/audit.service';
import type { CreateKeyReferenceDto } from '@sep/schemas';
import type { TokenPayload } from '../auth/auth.service';

// Fields to select — backendRef is NEVER returned
const KEY_REF_SELECT = {
  id: true,
  tenantId: true,
  partnerProfileId: true,
  name: true,
  usage: true,
  backendType: true,
  fingerprint: true,
  algorithm: true,
  version: true,
  state: true,
  environment: true,
  activatedAt: true,
  expiresAt: true,
  revokedAt: true,
  rotationTargetId: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface KeyRefRow {
  id: string;
  tenantId: string;
  partnerProfileId: string | null;
  name: string;
  usage: string[];
  backendType: string;
  fingerprint: string;
  algorithm: string;
  version: number;
  state: string;
  environment: string;
  activatedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  rotationTargetId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface KeyRefWithExpiry extends KeyRefRow {
  expiringWithinDays: number | null;
}

@Injectable()
export class KeyReferencesService {
  private readonly db = getPrismaClient();

  constructor(private readonly audit: AuditService) {}

  private async assertTenantOwnership(id: string, tenantId: string): Promise<KeyRefRow> {
    const key = await this.db.keyReference.findUnique({
      where: { id },
      select: KEY_REF_SELECT,
    });
    if (key === null || key.tenantId !== tenantId) {
      throw new NotFoundException('Key reference not found');
    }
    return key;
  }

  async create(dto: CreateKeyReferenceDto, actor: TokenPayload): Promise<KeyRefRow> {
    const keyRef = await this.db.keyReference.create({
      data: {
        tenantId: dto.tenantId,
        partnerProfileId: dto.partnerProfileId ?? null,
        name: dto.name,
        usage: dto.usage,
        backendType: dto.backendType,
        backendRef: dto.backendRef,
        fingerprint: dto.fingerprint,
        algorithm: dto.algorithm,
        environment: dto.environment,
        expiresAt: dto.expiresAt !== undefined ? new Date(dto.expiresAt) : null,
        metadata: dto.metadata !== undefined ? (dto.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
      select: KEY_REF_SELECT,
    });

    await this.audit.record({
      tenantId: dto.tenantId,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'KeyReference',
      objectId: keyRef.id,
      action: 'KEY_REFERENCE_CREATED',
      result: 'SUCCESS',
    });

    return keyRef;
  }

  async findById(id: string, actor: TokenPayload): Promise<KeyRefWithExpiry> {
    const keyRef = await this.assertTenantOwnership(id, actor.tenantId);
    return this.addExpiryFlag(keyRef);
  }

  async findAll(
    actor: TokenPayload,
    page: number,
    pageSize: number,
    filters: { state: string | undefined; environment: string | undefined },
  ): Promise<{
    data: KeyRefWithExpiry[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const where: Prisma.KeyReferenceWhereInput = {
      tenantId: actor.tenantId,
    };
    if (filters.state !== undefined) {
      where.state = filters.state as KeyState;
    }
    if (filters.environment !== undefined) {
      where.environment = filters.environment as 'TEST' | 'CERTIFICATION' | 'PRODUCTION';
    }

    const [data, total] = await Promise.all([
      this.db.keyReference.findMany({
        where,
        select: KEY_REF_SELECT,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.keyReference.count({ where }),
    ]);

    const enrichedData = data.map((k) => this.addExpiryFlag(k));

    return {
      data: enrichedData,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async activate(id: string, actor: TokenPayload): Promise<KeyRefRow> {
    const keyRef = await this.assertTenantOwnership(id, actor.tenantId);

    if (keyRef.state !== 'VALIDATED') {
      throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
        message: `Cannot activate key in state ${keyRef.state}. Key must be in VALIDATED state.`,
        currentState: keyRef.state,
        targetState: 'ACTIVE',
      });
    }

    // Production keys require dual-control approval
    if (keyRef.environment === 'PRODUCTION') {
      await this.assertApprovalExists(id, 'ACTIVATE_PRODUCTION_KEY', actor.tenantId);
    }

    const updated = await this.db.keyReference.update({
      where: { id },
      data: {
        state: 'ACTIVE',
        activatedAt: new Date(),
      },
      select: KEY_REF_SELECT,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'KeyReference',
      objectId: id,
      action: 'KEY_REFERENCE_ACTIVATED',
      result: 'SUCCESS',
      metadata: { environment: keyRef.environment },
    });

    return updated;
  }

  async revoke(id: string, actor: TokenPayload): Promise<KeyRefRow> {
    const keyRef = await this.assertTenantOwnership(id, actor.tenantId);

    if (keyRef.state !== 'ACTIVE' && keyRef.state !== 'ROTATING') {
      throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
        message: `Cannot revoke key in state ${keyRef.state}. Key must be ACTIVE or ROTATING.`,
        currentState: keyRef.state,
        targetState: 'REVOKED',
      });
    }

    // Production keys require dual-control approval for revocation
    if (keyRef.environment === 'PRODUCTION') {
      await this.assertApprovalExists(id, 'REVOKE_PRODUCTION_KEY', actor.tenantId);
    }

    const updated = await this.db.keyReference.update({
      where: { id },
      data: {
        state: 'REVOKED',
        revokedAt: new Date(),
      },
      select: KEY_REF_SELECT,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'KeyReference',
      objectId: id,
      action: 'KEY_REFERENCE_REVOKED',
      result: 'SUCCESS',
      metadata: { environment: keyRef.environment },
    });

    return updated;
  }

  /**
   * Verify that an approved dual-control Approval exists for a production key operation.
   * Mirrors the pattern used by PartnerProfilesService.transition for PROD_ACTIVE.
   */
  private async assertApprovalExists(
    keyReferenceId: string,
    action: string,
    tenantId: string,
  ): Promise<void> {
    const approval = await this.db.approval.findFirst({
      where: {
        tenantId,
        objectType: 'KeyReference',
        objectId: keyReferenceId,
        action,
        status: 'APPROVED',
        expiresAt: { gt: new Date() },
      },
      orderBy: { respondedAt: 'desc' },
    });

    if (approval === null) {
      throw new SepError(ErrorCode.APPROVAL_REQUIRED, {
        message: `An approved approval is required to ${action === 'ACTIVATE_PRODUCTION_KEY' ? 'activate' : 'revoke'} a production key`,
        keyReferenceId,
      });
    }

    if (approval.initiatorId === approval.approverId) {
      throw new SepError(ErrorCode.APPROVAL_SELF_APPROVAL_FORBIDDEN, {
        message: 'Initiator and approver must be different users for production key operations',
        keyReferenceId,
      });
    }
  }

  private addExpiryFlag(keyRef: KeyRefRow): KeyRefWithExpiry {
    if (keyRef.expiresAt === null) {
      return { ...keyRef, expiringWithinDays: null };
    }
    const cfg = getConfig();
    const now = new Date();
    const diffMs = keyRef.expiresAt.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const alertDays = cfg.crypto.keyExpiryAlertDays;
    return {
      ...keyRef,
      expiringWithinDays: diffDays <= alertDays ? diffDays : null,
    };
  }
}
