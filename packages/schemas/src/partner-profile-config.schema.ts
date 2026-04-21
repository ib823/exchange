/**
 * Partner profile `config` JSON validation at READ-time (M3.A6 / NEW-04).
 *
 * The `PartnerProfile.config` column is a Prisma Json blob whose shape
 * is authored by the HTTP CREATE flow (via `CreatePartnerProfileSchema`
 * in `./partner-profile.schema.ts`) and by `packages/db/prisma/seed.ts`.
 * Both use a NESTED layout keyed by transport:
 *
 *     { sftp: { host, port, username, hostKeyFingerprint, ... },
 *       https: { baseUrl, authType, ... },
 *       retryPolicy: { maxAttempts, ... } }
 *
 * NEW-04 adds a read-time parser that validates this SAME nested
 * shape (reusing the existing sub-schemas) and asserts a transport-
 * coherence invariant: a profile with `transportProtocol = 'SFTP'`
 * must carry a `config.sftp` object, and similarly for HTTPS.
 *
 * Why a separate schema instead of re-running `CreatePartnerProfileSchema`:
 *   `CreatePartnerProfileSchema` expects the full DTO (tenantId, name,
 *   ...) — it validates API request BODIES, not stored `config` blobs.
 *   This module validates just the config JSON given the row's
 *   `transportProtocol` column.
 *
 * Discriminator lives OUTSIDE the config JSON:
 *   `transportProtocol` is a separate Prisma column on partner_profiles.
 *   We accept it as a parser parameter rather than via Zod
 *   `discriminatedUnion`, because a discriminatedUnion would require
 *   injecting the column value into the parsed object first.
 *
 * AS2 is permissive:
 *   AS2 is in the `TransportProtocol` enum but has no data-plane
 *   connector as of M3.A6. The AS2 branch accepts any well-formed
 *   object with no transport-coherence requirement. M3.5 will tighten
 *   when AS2 ships.
 *
 * Known follow-up (out of M3.A6 scope):
 *   The data-plane processors (`apps/data-plane/src/processors/{intake,
 *   delivery,inbound}.processor.ts`) currently read `config.host`,
 *   `config.port`, etc. at TOP-LEVEL — not from the nested `sftp`/`https`
 *   sub-objects. That's a silent-misrouting bug: a seeded or user-
 *   created profile with `config.sftp.host` would cause the delivery
 *   processor to fall back to `'partner.example.com'`. Fixing the
 *   processor reads to go through `parsePartnerProfileConfig` and
 *   then index into the matched transport sub-object is the natural
 *   sequel to this PR and is filed as a follow-up issue.
 */

import { z } from 'zod';
import { SepError, ErrorCode } from '@sep/common';
import { SftpConfigSchema, HttpsConfigSchema, RetryPolicySchema } from './partner-profile.schema';
import { TransportProtocolSchema } from './shared.schema';

/**
 * The stored `config` JSON shape. Matches what
 * `CreatePartnerProfileSchema.config` accepts on CREATE and what
 * `packages/db/prisma/seed.ts` writes. `.passthrough()` tolerates
 * forward-compatible extra keys (e.g., `_note` in the seed fixture).
 */
export const PartnerProfileConfigSchema = z
  .object({
    sftp: SftpConfigSchema.optional(),
    https: HttpsConfigSchema.optional(),
    retryPolicy: RetryPolicySchema.optional(),
  })
  .passthrough();

export type PartnerProfileConfig = z.infer<typeof PartnerProfileConfigSchema>;
export type TransportProtocol = z.infer<typeof TransportProtocolSchema>;

/**
 * Parse the `config` blob against `PartnerProfileConfigSchema` and
 * enforce transport-to-subobject coherence. Throws
 * `SepError(PARTNER_CONFIG_INVALID)` on any failure, with an `issues`
 * array describing each violation and the `transportProtocol` for
 * operator debug.
 */
export function parsePartnerProfileConfig(
  transportProtocol: TransportProtocol,
  rawConfig: unknown,
): PartnerProfileConfig {
  const parsed = PartnerProfileConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new SepError(ErrorCode.PARTNER_CONFIG_INVALID, {
      transportProtocol,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  // Transport coherence: the row's transportProtocol must match an
  // actual sub-config present in the blob. A SFTP profile with no
  // `config.sftp` would silently misroute — fail closed instead.
  const data = parsed.data;
  if (transportProtocol === 'SFTP' && data.sftp === undefined) {
    throw new SepError(ErrorCode.PARTNER_CONFIG_INVALID, {
      transportProtocol,
      issues: [{ path: 'sftp', message: 'config.sftp is required when transportProtocol is SFTP' }],
    });
  }
  if (transportProtocol === 'HTTPS' && data.https === undefined) {
    throw new SepError(ErrorCode.PARTNER_CONFIG_INVALID, {
      transportProtocol,
      issues: [
        { path: 'https', message: 'config.https is required when transportProtocol is HTTPS' },
      ],
    });
  }
  // AS2 is permissive; M3.5 will tighten.
  return data;
}
