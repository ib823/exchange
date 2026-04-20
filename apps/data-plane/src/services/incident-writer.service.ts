/**
 * System-authored incident writer for data-plane processors.
 *
 * The control-plane IncidentsService takes a user TokenPayload —
 * scheduled data-plane processors have no user context, so this
 * service creates incidents directly with actorType='SYSTEM' in the
 * audit record.
 *
 * Consumers: key-expiry-scan.processor (raises 7/30/90-day warnings).
 * Future consumers (DLQ depth alerts, stuck-job alerts) can reuse
 * the same entry point; the create() method is intentionally generic.
 *
 * Idempotency:
 *   Scheduled scanners run repeatedly. `existsOpenForSource(...)`
 *   lets callers query for an open incident matching a (tenantId,
 *   sourceType, sourceId, severity) tuple so they can skip creating
 *   a duplicate. Callers are responsible for the check — the writer
 *   itself does not deduplicate.
 */

import {
  DatabaseService,
  type IncidentSeverity,
  type IncidentState,
} from '@sep/db';
import { createLogger } from '@sep/observability';
import { AuditWriterService } from './audit-writer.service';

const logger = createLogger({ service: 'data-plane', module: 'incident-writer' });

// Incident states where the incident is still "live" for de-dup purposes.
// Does NOT include RESOLVED/CLOSED — once resolved, a fresh warning that
// triggers later should produce a new incident.
const OPEN_LIKE_STATES: IncidentState[] = [
  'OPEN',
  'TRIAGED',
  'IN_PROGRESS',
  'WAITING_EXTERNAL',
];

export interface SystemIncidentParams {
  tenantId: string;
  severity: IncidentSeverity;
  title: string;
  description: string;
  sourceType: string;
  sourceId: string;
  /** Correlation id for audit + logging; optional but recommended. */
  correlationId?: string;
}

export class IncidentWriterService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Return true if there is already an open-like incident for
   * (tenantId, sourceType, sourceId) at or above `severity`. The
   * caller typically uses this for tier de-duplication in scanners:
   * "don't re-raise a 7-day critical if one is already open."
   */
  async existsOpenForSource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    severity: IncidentSeverity,
  ): Promise<boolean> {
    return this.database.forTenant(tenantId, async (db) => {
      const existing = await db.incident.findFirst({
        where: {
          tenantId,
          sourceType,
          sourceId,
          severity,
          state: { in: OPEN_LIKE_STATES },
        },
        select: { id: true },
      });
      return existing !== null;
    });
  }

  /**
   * Create a system-authored incident. Audit record is appended in
   * the same transaction (append-only chain stays valid).
   */
  async create(params: SystemIncidentParams): Promise<{ id: string }> {
    return this.database.forTenant(params.tenantId, async (db) => {
      const incident = await db.incident.create({
        data: {
          tenantId: params.tenantId,
          severity: params.severity,
          title: params.title,
          description: params.description,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
        select: { id: true },
      });

      await this.auditWriter.record(db, {
        tenantId: params.tenantId,
        actorType: 'SYSTEM',
        actorId: 'system:data-plane',
        objectType: 'Incident',
        objectId: incident.id,
        action: 'INCIDENT_CREATED',
        result: 'SUCCESS',
        ...(params.correlationId !== undefined && { correlationId: params.correlationId }),
      });

      logger.info(
        {
          tenantId: params.tenantId,
          incidentId: incident.id,
          severity: params.severity,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
        'System incident created',
      );

      return incident;
    });
  }
}
