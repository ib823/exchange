import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@sep/db';
import { assertOutboundUrlSafe } from '@sep/common';
import { AuditService } from '../audit/audit.service';
import type { TokenPayload } from '../auth/auth.service';

interface CreateWebhookInput {
  tenantId: string;
  url: string;
  events: string[];
  secretRef: string;
}

interface WebhookRow {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  active: boolean;
  successCount: number;
  failureCount: number;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Fields to select — secretRef is write-only, never returned
const WEBHOOK_SELECT = {
  id: true,
  tenantId: true,
  url: true,
  events: true,
  active: true,
  successCount: true,
  failureCount: true,
  lastFiredAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  private async assertTenantOwnership(id: string, tenantId: string): Promise<WebhookRow> {
    const db = this.database.forTenant(tenantId);
    const webhook = await db.webhook.findUnique({
      where: { id },
      select: WEBHOOK_SELECT,
    });
    if (webhook === null || webhook.tenantId !== tenantId) {
      throw new NotFoundException('Webhook not found');
    }
    return webhook;
  }

  async create(input: CreateWebhookInput, actor: TokenPayload): Promise<WebhookRow> {
    // Validate URL is safe for outbound requests (SSRF protection)
    assertOutboundUrlSafe(input.url);

    const db = this.database.forTenant(input.tenantId);
    const webhook = await db.webhook.create({
      data: {
        tenantId: input.tenantId,
        url: input.url,
        events: input.events,
        secretRef: input.secretRef,
      },
      select: WEBHOOK_SELECT,
    });

    await this.audit.record({
      tenantId: input.tenantId,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'Webhook',
      objectId: webhook.id,
      action: 'WEBHOOK_REGISTERED',
      result: 'SUCCESS',
    });

    return webhook;
  }

  async findAll(actor: TokenPayload, page: number, pageSize: number): Promise<{
    data: WebhookRow[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const db = this.database.forTenant(actor.tenantId);
    const where = { tenantId: actor.tenantId };

    const [data, total] = await Promise.all([
      db.webhook.findMany({
        where,
        select: WEBHOOK_SELECT,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      db.webhook.count({ where }),
    ]);

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async findById(id: string, actor: TokenPayload): Promise<WebhookRow> {
    const webhook = await this.assertTenantOwnership(id, actor.tenantId);
    return webhook;
  }

  async deactivate(id: string, actor: TokenPayload): Promise<WebhookRow> {
    await this.assertTenantOwnership(id, actor.tenantId);

    const db = this.database.forTenant(actor.tenantId);
    const updated = await db.webhook.update({
      where: { id },
      data: { active: false },
      select: WEBHOOK_SELECT,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'Webhook',
      objectId: id,
      action: 'WEBHOOK_DEACTIVATED',
      result: 'SUCCESS',
    });

    return updated;
  }
}
