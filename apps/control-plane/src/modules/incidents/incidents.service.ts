import { Injectable, NotFoundException } from '@nestjs/common';
import { getPrismaClient, Prisma, type IncidentSeverity, type IncidentState } from '@sep/db';
import { SepError, ErrorCode } from '@sep/common';
import { AuditService } from '../audit/audit.service';
import type { TokenPayload } from '../auth/auth.service';

const VALID_INCIDENT_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['TRIAGED'],
  TRIAGED: ['IN_PROGRESS', 'WAITING_EXTERNAL'],
  IN_PROGRESS: ['WAITING_EXTERNAL', 'RESOLVED'],
  WAITING_EXTERNAL: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

const SEVERITY_RANK: Record<string, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

interface CreateIncidentInput {
  tenantId: string;
  severity: string;
  title: string;
  description: string | undefined;
  sourceType: string;
  sourceId: string | undefined;
  assignedTo: string | undefined;
}

interface UpdateIncidentInput {
  severity: string | undefined;
  title: string | undefined;
  description: string | undefined;
  assignedTo: string | undefined;
  state: string | undefined;
  resolution: string | undefined;
}

interface IncidentRow {
  id: string;
  tenantId: string;
  severity: string;
  state: string;
  title: string;
  description: string | null;
  sourceType: string;
  sourceId: string | null;
  assignedTo: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolution: string | null;
  escalatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class IncidentsService {
  private readonly db = getPrismaClient();

  constructor(private readonly audit: AuditService) {}

  private async assertTenantOwnership(id: string, tenantId: string): Promise<IncidentRow> {
    const incident = await this.db.incident.findUnique({ where: { id } });
    if (incident === null || incident.tenantId !== tenantId) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  async create(input: CreateIncidentInput, actor: TokenPayload): Promise<IncidentRow> {
    const incident = await this.db.incident.create({
      data: {
        tenantId: input.tenantId,
        severity: input.severity as IncidentSeverity,
        title: input.title,
        description: input.description ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        assignedTo: input.assignedTo ?? null,
      },
    });

    await this.audit.record({
      tenantId: input.tenantId,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'Incident',
      objectId: incident.id,
      action: 'INCIDENT_CREATED',
      result: 'SUCCESS',
    });

    return incident;
  }

  async findById(id: string, actor: TokenPayload): Promise<IncidentRow> {
    const incident = await this.assertTenantOwnership(id, actor.tenantId);
    return incident;
  }

  async findAll(
    actor: TokenPayload,
    page: number,
    pageSize: number,
    filters: { state: string | undefined; severity: string | undefined },
  ): Promise<{
    data: IncidentRow[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const where: Prisma.IncidentWhereInput = {
      tenantId: actor.tenantId,
    };
    if (filters.state !== undefined) {
      where.state = filters.state as IncidentState;
    }
    if (filters.severity !== undefined) {
      where.severity = filters.severity as IncidentSeverity;
    }

    const [data, total] = await Promise.all([
      this.db.incident.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      }),
      this.db.incident.count({ where }),
    ]);

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async update(id: string, input: UpdateIncidentInput, actor: TokenPayload): Promise<IncidentRow> {
    const existing = await this.assertTenantOwnership(id, actor.tenantId);

    // Severity cannot be downgraded (P1 is highest, P4 is lowest)
    if (input.severity !== undefined) {
      const currentRank = SEVERITY_RANK[existing.severity] ?? 4;
      const newRank = SEVERITY_RANK[input.severity] ?? 4;
      if (newRank > currentRank) {
        throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          message: 'Incident severity cannot be downgraded',
          currentSeverity: existing.severity,
          requestedSeverity: input.severity,
        });
      }
    }

    // State transition validation
    if (input.state !== undefined) {
      const allowed = VALID_INCIDENT_TRANSITIONS[existing.state];
      if (allowed?.includes(input.state) !== true) {
        throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          message: `Invalid state transition from ${existing.state} to ${input.state}`,
          currentState: existing.state,
          targetState: input.state,
          allowedTransitions: allowed ?? [],
        });
      }

      // Resolution required before RESOLVED
      if (input.state === 'RESOLVED' && (input.resolution === undefined || input.resolution.length === 0) && (existing.resolution === null || existing.resolution.length === 0)) {
        throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          message: 'Resolution is required before transitioning to RESOLVED',
          currentState: existing.state,
          targetState: input.state,
        });
      }
    }

    const data: Record<string, unknown> = {};
    if (input.severity !== undefined) { data.severity = input.severity as IncidentSeverity; }
    if (input.title !== undefined) { data.title = input.title; }
    if (input.description !== undefined) { data.description = input.description; }
    if (input.assignedTo !== undefined) { data.assignedTo = input.assignedTo; }
    if (input.state !== undefined) { data.state = input.state as IncidentState; }
    if (input.resolution !== undefined) { data.resolution = input.resolution; }
    if (input.state === 'RESOLVED') {
      data.resolvedAt = new Date();
      data.resolvedBy = actor.userId;
    }

    const updated = await this.db.incident.update({
      where: { id },
      data,
    });

    // Determine audit action based on what changed
    let auditAction: 'INCIDENT_TRIAGED' | 'INCIDENT_RESOLVED' = 'INCIDENT_TRIAGED';
    if (input.state === 'RESOLVED') {
      auditAction = 'INCIDENT_RESOLVED';
    }

    const metadata: Record<string, string> = {};
    if (input.state !== undefined) {
      metadata.fromState = existing.state;
      metadata.toState = input.state;
    }
    if (input.severity !== undefined) {
      metadata.fromSeverity = existing.severity;
      metadata.toSeverity = input.severity;
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorType: 'USER',
      actorId: actor.userId,
      objectType: 'Incident',
      objectId: id,
      action: auditAction,
      result: 'SUCCESS',
      ...(Object.keys(metadata).length > 0 && { metadata }),
    });

    return updated;
  }
}
