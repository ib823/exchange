# ADR-0002 — Argon2id for password / API-key hashing

**Status:** Accepted (M3.0, 2026-04-17)
**Deciders:** Platform engineering, security engineering
**Supersedes:** None

## Context

bcrypt (5.1.1) is 2015-era. Known operational footguns:

- 72-byte input truncation (passwords longer than 72 bytes collide silently).
- No memory-hard property; GPU-accelerated cracking is cheap.
- OWASP's current (April 2026) password-storage guidance recommends
  **Argon2id** as the default, with a documented parameter set.

The only bcrypt callsite in this repo is API-key hash verification
(`apps/control-plane/src/modules/auth/auth.service.ts`).

## Decision

Use **`@node-rs/argon2` 2.0.2** with Argon2id and OWASP-recommended
parameters:

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2';

const h = await hash(secret, {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,   // KiB (~19 MiB)
  timeCost: 2,
  parallelism: 1,
});
const ok = await verify(h, secret);
```

Rationale for the package choice:

- Rust-native binding, no C++ toolchain at install time.
- Native binary ships for every platform we care about (Linux x64/arm64, macOS
  universal, Windows x64).
- Active maintenance; multiple maintainers.

## Consequences

**Positive:**

- Memory-hard function resists GPU/ASIC cracking.
- No silent truncation. Inputs of arbitrary length.
- API-key and (future) password hashing share one primitive.

**Negative:**

- bcrypt and Argon2id hashes are not cross-compatible. Phase 1 has no
  production API-key records; clean cutover is safe (seed file creates zero
  ApiKey rows). If any non-test environment is later found to contain bcrypt
  hashes, a dual-verify transition will be needed — design that in M3 when
  ApiKeyService CRUD lands.
- Argon2id with these parameters takes ~200 ms per hash on a typical laptop.
  Intentional for production. Test suites must mock the hash function or
  pass a test-only low-cost parameter set; do **not** lower the defaults
  in production code (§15 gotcha 5).
- Alpine-based Docker images may need `libc6-compat` or a switch to
  `node:20-bookworm-slim` (§15 gotcha 9). Document when M3.5 adds a Dockerfile.

## Related findings

Closes: part of R5-005 (bcrypt package staleness).

## References

- `_plan/M3_0_FOUNDATION_RESET.md` §7B, §15 gotcha 5, §15 gotcha 9
- OWASP Password Storage Cheat Sheet (April 2026 revision)
