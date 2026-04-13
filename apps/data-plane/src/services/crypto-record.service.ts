/**
 * CryptoOperationRecord persistence service.
 *
 * Persists immutable records of every crypto operation via DatabaseService.
 * The record must succeed BEFORE the operation result is returned to the caller.
 */

import { DatabaseService, type Prisma } from '@sep/db';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import type { CryptoOperationMeta, CryptoAlgorithmPolicy } from '@sep/crypto';

const logger = createLogger({ service: 'data-plane', module: 'crypto-record' });

export interface CryptoRecordInput {
  tenantId: string;
  submissionId?: string;
  meta: CryptoOperationMeta;
  policy: CryptoAlgorithmPolicy;
  result: 'SUCCESS' | 'FAILURE' | 'POLICY_VIOLATION';
  errorCode?: string;
  correlationId?: string;
  actorId: string;
  /** Actual cryptographic fingerprint from the resolved key material */
  keyFingerprint: string;
}

function mapOperationType(operation: string): 'SIGN' | 'ENCRYPT' | 'DECRYPT' | 'VERIFY' | 'SIGN_AND_ENCRYPT' | 'VERIFY_AND_DECRYPT' {
  switch (operation) {
    case 'SIGN': return 'SIGN';
    case 'ENCRYPT': return 'ENCRYPT';
    case 'DECRYPT': return 'DECRYPT';
    case 'VERIFY': return 'VERIFY';
    case 'SIGN_ENCRYPT': return 'SIGN_AND_ENCRYPT';
    case 'VERIFY_DECRYPT': return 'VERIFY_AND_DECRYPT';
    default: {
      const _exhaustive: never = operation as never;
      throw new SepError(ErrorCode.INTERNAL_ERROR, { operation: String(_exhaustive) });
    }
  }
}

export class CryptoRecordService {
  constructor(private readonly database: DatabaseService) {}

  async persist(input: CryptoRecordInput): Promise<string> {
    try {
      const db = this.database.forTenant(input.tenantId);

      const record = await db.cryptoOperationRecord.create({
        data: {
          tenantId: input.tenantId,
          submissionId: input.submissionId ?? null,
          keyReferenceId: input.meta.keyReferenceId,
          operationType: mapOperationType(input.meta.operation),
          result: input.result,
          algorithmPolicy: input.policy as unknown as Prisma.InputJsonValue,
          keyFingerprint: input.keyFingerprint,
          performedAt: input.meta.performedAt,
          errorCode: input.errorCode ?? null,
          correlationId: input.correlationId ?? null,
          actorId: input.actorId,
        },
      });

      logger.debug(
        {
          recordId: record.id,
          tenantId: input.tenantId,
          operation: input.meta.operation,
          correlationId: input.correlationId,
        },
        'Crypto operation record persisted',
      );

      return record.id;
    } catch (err) {
      if (err instanceof SepError) {throw err;}
      logger.error(
        { tenantId: input.tenantId, operation: input.meta.operation },
        'CRITICAL: crypto operation record persistence failed',
      );
      throw new SepError(ErrorCode.DATABASE_ERROR, {
        operation: 'crypto-record.persist',
      });
    }
  }

  async existsForSubmission(
    tenantId: string,
    submissionId: string,
    operationType: string,
  ): Promise<boolean> {
    const db = this.database.forTenant(tenantId);
    const record = await db.cryptoOperationRecord.findFirst({
      where: {
        tenantId,
        submissionId,
        operationType: mapOperationType(operationType),
        result: 'SUCCESS',
      },
      select: { id: true },
    });
    return record !== null;
  }
}
