import { Injectable, NotFoundException } from '@nestjs/common';
import { getPrismaClient, Prisma } from '@sep/db';
import { AuditService } from '../audit/audit.service';
import type { CreateTenantDto, UpdateTenantDto } from '@sep/schemas';
import type { TokenPayload } from '../auth/auth.service';

@Injectable()
export class TenantsService {
  private readonly db = getPrismaClient();

  constructor(private readonly audit: AuditService) {}

  async create(dto: CreateTenantDto, actor: TokenPayload): Promise<{
    id: string; name: string; legalEntityName: string; serviceTier: string;
    defaultRegion: string; status: string; createdAt: Date; updatedAt: Date;
  }> {
    const tenant = await this.db.tenant.create({
      data: {
        name: dto.name,
        legalEntityName: dto.legalEntityName,
        serviceTier: dto.serviceTier,
        defaultRegion: dto.defaultRegion,
        metadata: dto.metadata !== undefined ? (dto.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    await this.audit.record({
      tenantId: tenant.id,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'Tenant',
      objectId: tenant.id,
      action: 'TENANT_CREATED',
      result: 'SUCCESS',
    });

    return tenant;
  }

  async findById(id: string, actor: TokenPayload): Promise<{
    id: string; name: string; legalEntityName: string; serviceTier: string;
    defaultRegion: string; status: string; createdAt: Date; updatedAt: Date;
  }> {
    const tenant = await this.db.tenant.findUnique({ where: { id } });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found');
    }

    // Only PLATFORM_SUPER_ADMIN can view other tenants
    if (actor.role !== 'PLATFORM_SUPER_ADMIN' && tenant.id !== actor.tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  async findAll(actor: TokenPayload, page: number, pageSize: number): Promise<{
    data: Array<Record<string, unknown>>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    // PLATFORM_SUPER_ADMIN sees all; others see only their own tenant
    const where = actor.role === 'PLATFORM_SUPER_ADMIN'
      ? {}
      : { id: actor.tenantId };

    const [data, total] = await Promise.all([
      this.db.tenant.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.tenant.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async update(id: string, dto: UpdateTenantDto, actor: TokenPayload): Promise<{
    id: string; name: string; legalEntityName: string; serviceTier: string;
    defaultRegion: string; status: string; createdAt: Date; updatedAt: Date;
  }> {
    const existing = await this.db.tenant.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException('Tenant not found');
    }
    if (actor.role !== 'PLATFORM_SUPER_ADMIN' && existing.id !== actor.tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const updated = await this.db.tenant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.legalEntityName !== undefined && { legalEntityName: dto.legalEntityName }),
        ...(dto.serviceTier !== undefined && { serviceTier: dto.serviceTier }),
        ...(dto.defaultRegion !== undefined && { defaultRegion: dto.defaultRegion }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as Prisma.InputJsonValue }),
      },
    });

    await this.audit.record({
      tenantId: id,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'Tenant',
      objectId: id,
      action: 'TENANT_UPDATED',
      result: 'SUCCESS',
    });

    return updated;
  }

  async suspend(id: string, actor: TokenPayload): Promise<{
    id: string; name: string; status: string;
  }> {
    const existing = await this.db.tenant.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException('Tenant not found');
    }
    if (actor.role !== 'PLATFORM_SUPER_ADMIN' && existing.id !== actor.tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const updated = await this.db.tenant.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    await this.audit.record({
      tenantId: id,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'Tenant',
      objectId: id,
      action: 'TENANT_SUSPENDED',
      result: 'SUCCESS',
    });

    return updated;
  }
}
