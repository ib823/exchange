/**
 * Key expiry scanner (M3.A5-T07).
 *
 * Runs on a cadence (daily, scheduled as a BullMQ repeatable job — the
 * scheduler wiring lives in data-plane's bootstrap and is not this
 * processor's concern). For every ACTIVE KeyReference with a non-null
 * `expiresAt`, buckets the days-until-expiry into three tiers and
 * raises an Incident the first time a key enters each tier:
 *
 *   ≤ 7 days  → P1 (critical — immediate action)
 *   ≤ 30 days → P2 (warning — schedule rotation)
 *   ≤ 90 days → P3 (early notice — plan rotation)
 *
 * Only one tier fires per scan per key — the narrowest tier wins.
 * The scanner is idempotent within a tier: if an open-like incident
 * already exists for (tenantId, KeyReference, severity) it is not
 * re-created. Incidents that have been resolved/closed can recur if
 * the key is still in the tier on a subsequent run, which is the
 * right behaviour (re-surface the reminder if the operator didn't
 * rotate).
 *
 * Cross-tenant read: the initial listing uses `db.forSystem()` to
 * scan every tenant in one query. Per-key incident writes drop back
 * into `forTenant(tenantId, ...)` via IncidentWriterService so RLS
 * is enforced on the mutation path.
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DatabaseService, type IncidentSeverity } from '@sep/db';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { createLogger, keyExpiryWarningCounter } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import { AuditWriterService } from '../services/audit-writer.service';
import { IncidentWriterService } from '../services/incident-writer.service';

const logger = createLogger({ service: 'data-plane', module: 'key-expiry-scan' });

const MS_PER_DAY = 86_400_000;

export interface KeyExpiryScanJob {
  /** ISO timestamp of the scan trigger (for observability). Optional; defaults to now. */
  readonly scanAt?: string;
  /** Correlation id for audit trail; optional. */
  readonly correlationId?: string;
}

interface TierDefinition {
  readonly thresholdDays: number;
  readonly severity: IncidentSeverity;
  readonly label: 'critical' | 'warning' | 'early';
}

interface KeyExpiryRow {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly expiresAt: Date;
}

@Processor(QUEUES.KEY_EXPIRY_SCAN)
export class KeyExpiryScanProcessor extends WorkerHost {
  private readonly incidentWriter: IncidentWriterService;
  private readonly tiers: readonly TierDefinition[];

  constructor(private readonly database: DatabaseService) {
    super();
    const auditWriter = new AuditWriterService(database);
    this.incidentWriter = new IncidentWriterService(database, auditWriter);

    const cfg = getConfig().crypto;
    // Tiers are ordered narrowest-first so the first match in
    // bucketFor() returns the highest severity that applies.
    this.tiers = [
      { thresholdDays: cfg.keyExpiryCriticalDays, severity: 'P1', label: 'critical' },
      { thresholdDays: cfg.keyExpiryAlertDays, severity: 'P2', label: 'warning' },
      { thresholdDays: cfg.keyExpiryEarlyWarningDays, severity: 'P3', label: 'early' },
    ];
  }

  async process(job: Job<KeyExpiryScanJob>): Promise<void> {
    const scanAt = job.data.scanAt !== undefined ? new Date(job.data.scanAt) : new Date();
    const correlationId = job.data.correlationId;

    logger.info({ correlationId, scanAt: scanAt.toISOString() }, 'Key expiry scan started');

    try {
      const keys = await this.listCandidateKeys(scanAt);
      let raised = 0;
      let skipped = 0;

      for (const key of keys) {
        const days = Math.ceil((key.expiresAt.getTime() - scanAt.getTime()) / MS_PER_DAY);
        const tier = this.bucketFor(days);
        if (tier === null) {
          continue;
        }

        const alreadyOpen = await this.incidentWriter.existsOpenForSource(
          key.tenantId,
          'KeyReference',
          key.id,
          tier.severity,
        );
        if (alreadyOpen) {
          skipped += 1;
          continue;
        }

        await this.incidentWriter.create({
          tenantId: key.tenantId,
          severity: tier.severity,
          title: `Key "${key.name}" expires in ${days.toString()} day(s)`,
          description:
            `Key reference ${key.id} reaches its expiry date on ${key.expiresAt.toISOString()} ` +
            `(${days.toString()} days from scan). Rotation is due at this tier.`,
          sourceType: 'KeyReference',
          sourceId: key.id,
          ...(correlationId !== undefined && { correlationId }),
        });

        keyExpiryWarningCounter.inc({
          tier_days: String(tier.thresholdDays),
          severity: tier.severity,
          tenant_id: key.tenantId,
        });
        raised += 1;
      }

      logger.info(
        {
          correlationId,
          scanAt: scanAt.toISOString(),
          scanned: keys.length,
          raised,
          skipped,
        },
        'Key expiry scan completed',
      );
    } catch (err) {
      logger.error(
        { correlationId, err: err instanceof Error ? err.message : String(err) },
        'Key expiry scan failed',
      );
      if (err instanceof SepError) {
        throw err;
      }
      throw new SepError(ErrorCode.INTERNAL_ERROR, {
        operation: 'keyExpiryScan',
        reason: 'Unhandled error during key expiry scan',
      });
    }
  }

  /**
   * Cross-tenant listing of candidate keys. `forSystem()` is the
   * right tool here — per-tenant iteration would require either a
   * prior distinct-tenant query or walking the Tenant table, both
   * costlier than a single indexed scan.
   */
  private async listCandidateKeys(scanAt: Date): Promise<KeyExpiryRow[]> {
    // Widest tier = last in the array (tiers sorted narrowest-first
    // at construction); the cutoff is the farthest-out expiry the
    // scanner cares about.
    const widest = this.tiers[this.tiers.length - 1];
    if (widest === undefined) {
      return [];
    }
    const cutoff = new Date(scanAt.getTime() + widest.thresholdDays * MS_PER_DAY);
    const rows = await this.database.forSystem().keyReference.findMany({
      where: {
        state: 'ACTIVE',
        expiresAt: { not: null, gt: scanAt, lte: cutoff },
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        expiresAt: true,
      },
    });
    // `expiresAt: { not: null, ... }` narrows the Prisma type at
    // runtime but not at the types level; filter explicitly so the
    // return type is Date, not Date | null.
    return rows.filter((r): r is KeyExpiryRow => r.expiresAt !== null);
  }

  /**
   * Given remaining days, return the narrowest tier the key falls
   * into, or null if it's outside every tier (too far out).
   */
  private bucketFor(days: number): TierDefinition | null {
    if (days <= 0) {
      // Already expired; the key state machine transitions to
      // EXPIRED independently. Scanner does not raise tier incidents
      // for already-past expiry.
      return null;
    }
    for (const tier of this.tiers) {
      if (days <= tier.thresholdDays) {
        return tier;
      }
    }
    return null;
  }
}
