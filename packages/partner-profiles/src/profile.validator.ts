import { SepError, ErrorCode } from '@sep/common';
import { CreatePartnerProfileSchema, type CreatePartnerProfileDto } from '@sep/schemas';
import type { ZodError } from 'zod';

export function validatePartnerProfile(raw: unknown): CreatePartnerProfileDto {
  const result = CreatePartnerProfileSchema.safeParse(raw);
  if (!result.success) {
    const zodErr = result.error as ZodError;
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      issues: zodErr.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const data = result.data;
  // Transport config must match declared protocol
  if (data.transportProtocol === 'SFTP' && data.config.sftp === undefined) {
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      field: 'config.sftp',
      message: 'SFTP config required when transportProtocol is SFTP',
    });
  }
  if (data.transportProtocol === 'HTTPS' && data.config.https === undefined) {
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      field: 'config.https',
      message: 'HTTPS config required when transportProtocol is HTTPS',
    });
  }
  return data;
}
