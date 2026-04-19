import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, Prisma, type PartnerProfileStatus } from '@sep/db';
import { SepError, ErrorCode } from '@sep/common';
import { AuditService } from '../audit/audit.service';
import type { CreatePartnerProfileDto, UpdatePartnerProfileDto } from '@sep/schemas';
import type { TokenPayload } from '../auth/auth.service';

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['TEST_READY', 'RETIRED'],
  TEST_READY: ['TEST_APPROVED', 'RETIRED'],
  TEST_APPROVED: ['PROD_PENDING_APPROVAL', 'RETIRED'],
  PROD_PENDING_APPROVAL: ['PROD_ACTIVE', 'RETIRED'],
  PROD_ACTIVE: ['SUSPENDED', 'RETIRED'],
  SUSPENDED: ['PROD_ACTIVE', 'RETIRED'],
  RETIRED: [],
};

interface PartnerProfileRow {
  id: string;
  tenantId: string;
  name: string;
  partnerType: string;
  environment: string;
  version: number;
  status: string;
  transportProtocol: string;
  messageSecurityMode: string;
  payloadContractRef: string | null;
  retryPolicyRef: string | null;
  keyPolicyRef: string | null;
  config: unknown;
  notes: string | null;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PartnerProfilesService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  private async assertTenantOwnership(
    db: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ): Promise<PartnerProfileRow> {
    const profile = await db.partnerProfile.findUnique({ where: { id } });
    if (profile === null || profile.tenantId !== tenantId) {
      throw new NotFoundException('Partner profile not found');
    }
    return profile;
  }

  async create(dto: CreatePartnerProfileDto, actor: TokenPayload): Promise<PartnerProfileRow> {
    return this.database.forTenant(dto.tenantId, async (db) => {
      const profile = await db.partnerProfile.create({
        data: {
          tenantId: dto.tenantId,
          name: dto.name,
          partnerType: dto.partnerType,
          environment: dto.environment,
          transportProtocol: dto.transportProtocol,
          messageSecurityMode: dto.messageSecurityMode,
          config: dto.config as Prisma.InputJsonValue,
          notes: dto.notes ?? null,
          effectiveDate: dto.effectiveDate !== undefined ? new Date(dto.effectiveDate) : null,
          expiryDate: dto.expiryDate !== undefined ? new Date(dto.expiryDate) : null,
        },
      });

      await this.audit.record(db, {
        tenantId: dto.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        objectType: 'PartnerProfile',
        objectId: profile.id,
        action: 'PARTNER_PROFILE_CREATED',
        result: 'SUCCESS',
      });

      return profile;
    });
  }

  async findById(id: string, actor: TokenPayload): Promise<PartnerProfileRow> {
    return this.database.forTenant(actor.tenantId, (db) =>
      this.assertTenantOwnership(db, id, actor.tenantId),
    );
  }

  async findAll(
    actor: TokenPayload,
    page: number,
    pageSize: number,
    filters: { status: string | undefined; environment: string | undefined },
  ): Promise<{
    data: PartnerProfileRow[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const where: Prisma.PartnerProfileWhereInput = {
        tenantId: actor.tenantId,
      };
      if (filters.status !== undefined) {
        where.status = filters.status as PartnerProfileStatus;
      }
      if (filters.environment !== undefined) {
        where.environment = filters.environment as 'TEST' | 'CERTIFICATION' | 'PRODUCTION';
      }

      const [data, total] = await Promise.all([
        db.partnerProfile.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
        }),
        db.partnerProfile.count({ where }),
      ]);

      return {
        data,
        meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async update(
    id: string,
    dto: UpdatePartnerProfileDto,
    actor: TokenPayload,
  ): Promise<PartnerProfileRow> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const existing = await this.assertTenantOwnership(db, id, actor.tenantId);

      if (existing.status !== 'DRAFT') {
        throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          message: 'Only DRAFT profiles can be updated',
          currentStatus: existing.status,
        });
      }

      const updated = await db.partnerProfile.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.partnerType !== undefined && { partnerType: dto.partnerType }),
          ...(dto.transportProtocol !== undefined && {
            transportProtocol: dto.transportProtocol,
          }),
          ...(dto.messageSecurityMode !== undefined && {
            messageSecurityMode: dto.messageSecurityMode,
          }),
          ...(dto.config !== undefined && { config: dto.config as Prisma.InputJsonValue }),
          ...(dto.notes !== undefined && { notes: dto.notes ?? null }),
          ...(dto.effectiveDate !== undefined && { effectiveDate: new Date(dto.effectiveDate) }),
          ...(dto.expiryDate !== undefined && { expiryDate: new Date(dto.expiryDate) }),
        },
      });

      await this.audit.record(db, {
        tenantId: actor.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        objectType: 'PartnerProfile',
        objectId: id,
        action: 'PARTNER_PROFILE_UPDATED',
        result: 'SUCCESS',
      });

      return updated;
    });
  }

  async transition(
    id: string,
    targetStatus: string,
    actor: TokenPayload,
  ): Promise<PartnerProfileRow> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const existing = await this.assertTenantOwnership(db, id, actor.tenantId);
      const currentStatus = existing.status;

      const allowed = VALID_TRANSITIONS[currentStatus];
      if (allowed?.includes(targetStatus) !== true) {
        throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          message: `Invalid transition from ${currentStatus} to ${targetStatus}`,
          currentStatus,
          targetStatus,
          allowedTransitions: allowed ?? [],
        });
      }

      // PROD_ACTIVE requires an approved Approval (except when resuming from SUSPENDED)
      if (targetStatus === 'PROD_ACTIVE' && currentStatus !== 'SUSPENDED') {
        const approval = await db.approval.findFirst({
          where: {
            tenantId: actor.tenantId,
            objectType: 'PartnerProfile',
            objectId: id,
            status: 'APPROVED',
          },
          orderBy: { respondedAt: 'desc' },
        });

        if (approval === null) {
          throw new SepError(ErrorCode.APPROVAL_REQUIRED, {
            message: 'An approved approval is required to activate a production profile',
            profileId: id,
          });
        }

        if (approval.initiatorId === approval.approverId) {
          throw new SepError(ErrorCode.APPROVAL_SELF_APPROVAL_FORBIDDEN, {
            message: 'Initiator and approver must be different users for production activation',
            profileId: id,
          });
        }
      }

      const updated = await db.partnerProfile.update({
        where: { id },
        data: {
          status: targetStatus as PartnerProfileStatus,
          version: { increment: 1 },
        },
      });

      await this.audit.record(db, {
        tenantId: actor.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        objectType: 'PartnerProfile',
        objectId: id,
        action: 'PARTNER_PROFILE_STATUS_CHANGED',
        result: 'SUCCESS',
        metadata: { from: currentStatus, to: targetStatus },
      });

      return updated;
    });
  }

  async suspend(id: string, actor: TokenPayload): Promise<PartnerProfileRow> {
    return this.transition(id, 'SUSPENDED', actor);
  }

  async retire(id: string, actor: TokenPayload): Promise<PartnerProfileRow> {
    return this.transition(id, 'RETIRED', actor);
  }
}
