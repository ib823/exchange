/**
 * Refresh token rotation + strict replay detection (M3.A4-T05).
 *
 * Token format:
 *   `<tenantId>.<base64url(32-byte random)>`
 *   Example: `cabcdef1234567890abcdef.xvY3kQ...`
 *
 * The tenantId prefix is not a secret — the caller already knows
 * their tenant from login. It lets refresh() route the lookup via
 * forTenant(tenantId, ...) instead of needing a privileged cross-
 * tenant SELECT. The runtime DB role (sep_app) has RLS forced, so a
 * bare `forSystem().refreshToken.findUnique(...)` would return null
 * (RLS filter evaluates tenantId = NULL). Embedding the tenantId in
 * the token envelope keeps the lookup inside the normal tenant-
 * scoped path.
 *
 * Token lifecycle:
 *   issue — generate 256-bit random, build `<tenantId>.<raw>`, hmac
 *           the whole token, persist row, return the envelope to
 *           the caller. Raw bytes never touch the DB.
 *   refresh — parse tenantId prefix, look up by hmac inside
 *             forTenant, validate state, mark usedAt, issue a new
 *             token with replacedById pointing at the old.
 *   replay — if a token with usedAt != null is presented, this
 *            is a replay: the caller presented a token that was
 *            already exchanged. Revoke the entire chain (the
 *            presented row, its successor, all downstream
 *            successors) and force re-login.
 *
 * Why HMAC-SHA256 over argon2id on this column:
 *   Refresh tokens are 256-bit cryptographically-random values.
 *   They don't benefit from slow hashing — brute-force against
 *   this input entropy is infeasible regardless of hash speed.
 *   HMAC-SHA256 is deterministic (same input → same output), which
 *   lets the `tokenHash` unique index serve lookup-by-presentation;
 *   argon2id's random salt prevents that.
 *
 *   The HMAC key lives in Vault and is loaded at module init (see
 *   refresh-hmac-key.provider.ts). Comparing against a stolen DB
 *   dump alone is impossible without the key — same defense-in-
 *   depth argon2id offers for passwords, delivered differently.
 *
 * Strict replay discipline:
 *   No grace window. The moment a used token is presented, we
 *   assume the original holder was compromised and ANY derived
 *   token could belong to an attacker. Chain revocation walks
 *   from the presented row forward (via replacedById) and back
 *   (via a reverse scan) to close off every token issued by
 *   that login session.
 */

import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService, type Prisma } from '@sep/db';
import { SepError, ErrorCode } from '@sep/common';
import { CuidSchema } from '@sep/schemas';
import { createLogger } from '@sep/observability';
import { REFRESH_HMAC_KEY, hmacToken } from './refresh-hmac-key.provider';

const logger = createLogger({ service: 'control-plane', module: 'refresh-token' });

const REFRESH_TOKEN_BYTES = 32; // 256 bits
const REFRESH_TOKEN_TTL_DAYS = 30;
const TOKEN_SEPARATOR = '.';

export interface IssuedRefreshToken {
  /** The raw token — return to caller, never persist. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface RefreshResult {
  readonly refreshToken: IssuedRefreshToken;
  readonly userId: string;
  readonly tenantId: string;
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REFRESH_HMAC_KEY) private readonly hmacKey: Buffer,
  ) {}

  /**
   * Issue a new refresh token for a successful login. Creates the
   * row inside the caller's tenant context — call this from a
   * forTenant(...) wrapper after MFA verify / password login
   * succeeds.
   */
  async issue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<IssuedRefreshToken> {
    const rawBytes = this.generateRawBytes();
    const token = `${tenantId}${TOKEN_SEPARATOR}${rawBytes}`;
    const tokenHash = hmacToken(token, this.hmacKey);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await tx.refreshToken.create({
      data: {
        tenantId,
        userId,
        tokenHash,
        expiresAt,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Exchange a refresh token for a new one. Enforces strict replay
   * detection: a token presented after its usedAt is set triggers
   * chain revocation — every token linked by replacedById in both
   * directions is revoked, and the caller is forced to re-login.
   */
  async refresh(rawToken: string): Promise<RefreshResult> {
    // Parse the `<tenantId>.<rawBytes>` envelope. Malformed or
    // non-cuid tenantIds fail the same shape as "token not found"
    // so an attacker probing with junk strings gets the same
    // AUTH_REFRESH_TOKEN_INVALID response as one probing with
    // well-formed but unregistered tokens.
    const tenantId = this.extractTenantId(rawToken);
    if (tenantId === null) {
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
          {},
          'Refresh token not recognised',
        ).toClientJson(),
      );
    }

    const tokenHash = hmacToken(rawToken, this.hmacKey);
    const row = await this.database.forTenant(tenantId, async (tx) =>
      tx.refreshToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
        },
      }),
    );

    if (row === null) {
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
          {},
          'Refresh token not recognised',
        ).toClientJson(),
      );
    }

    if (row.revokedAt !== null) {
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
          { reason: 'Token has been revoked' },
          'Refresh token not recognised',
        ).toClientJson(),
      );
    }

    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
          { reason: 'Token expired' },
          'Refresh token not recognised',
        ).toClientJson(),
      );
    }

    // Strict replay detection. No grace window.
    if (row.usedAt !== null) {
      await this.revokeChain(row.tenantId, row.id);
      logger.warn(
        { tenantId: row.tenantId, userId: row.userId, tokenId: row.id },
        'Refresh token replay detected — chain revoked',
      );
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_REFRESH_TOKEN_REPLAY,
          { reason: 'Presented token was already used; chain revoked' },
          'Refresh token reuse detected — please log in again',
        ).toClientJson(),
      );
    }

    return this.database.forTenant(row.tenantId, async (tx) => {
      const newIssued = await this.issue(tx, row.tenantId, row.userId);
      const newHash = hmacToken(newIssued.token, this.hmacKey);
      const newRow = await tx.refreshToken.findUnique({
        where: { tokenHash: newHash },
        select: { id: true },
      });
      if (newRow === null) {
        throw new SepError(ErrorCode.DATABASE_ERROR, {
          reason: 'Newly issued refresh token not found by its own hash',
        });
      }
      await tx.refreshToken.update({
        where: { id: row.id },
        data: { usedAt: new Date(), replacedById: newRow.id },
      });
      return {
        refreshToken: newIssued,
        userId: row.userId,
        tenantId: row.tenantId,
      };
    });
  }

  /**
   * Revoke every token in the chain reachable from a given token id,
   * walking both directions via `replacedById`. Called on replay
   * detection.
   *
   * Runs inside forTenant(tenantId, ...) so RLS is enforced. The
   * caller supplies `tenantId` from the presented row, which is the
   * row's true tenant — so this is not a cross-tenant escalation.
   */
  private async revokeChain(tenantId: string, rootTokenId: string): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      // Walk backward: find the earliest ancestor by iterating
      // `replacedById` back until we hit a row no other row
      // replaced.
      const chainIds = new Set<string>([rootTokenId]);

      // Backward walk — rows whose replacedById points at anything
      // already in our set, looped until stable.
      for (let iter = 0; iter < 100; iter += 1) {
        const before = chainIds.size;
        const parents = await tx.refreshToken.findMany({
          where: { replacedById: { in: Array.from(chainIds) } },
          select: { id: true },
        });
        for (const p of parents) {
          chainIds.add(p.id);
        }
        if (chainIds.size === before) {
          break;
        }
      }

      // Forward walk — follow replacedById from each known node
      // until no new ids appear.
      for (let iter = 0; iter < 100; iter += 1) {
        const known = await tx.refreshToken.findMany({
          where: { id: { in: Array.from(chainIds) } },
          select: { replacedById: true },
        });
        const before = chainIds.size;
        for (const k of known) {
          if (k.replacedById !== null) {
            chainIds.add(k.replacedById);
          }
        }
        if (chainIds.size === before) {
          break;
        }
      }

      await tx.refreshToken.updateMany({
        where: { id: { in: Array.from(chainIds) }, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: 'replay-detected',
        },
      });
    });
  }

  private generateRawBytes(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  /**
   * Parse the `<tenantId>.<rawBytes>` envelope; return null on
   * malformed input (shape mismatch, non-cuid prefix, empty bytes).
   * Shape failures map to AUTH_REFRESH_TOKEN_INVALID so an attacker
   * cannot distinguish "malformed" from "unknown" responses.
   */
  private extractTenantId(rawToken: string): string | null {
    const sepIndex = rawToken.indexOf(TOKEN_SEPARATOR);
    if (sepIndex <= 0 || sepIndex === rawToken.length - 1) {
      return null;
    }
    const candidate = rawToken.slice(0, sepIndex);
    if (!CuidSchema.safeParse(candidate).success) {
      return null;
    }
    return candidate;
  }
}
