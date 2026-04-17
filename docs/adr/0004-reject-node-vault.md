# ADR-0004 — Reject `node-vault`; thin HTTP client in M3

**Status:** Decided (M3.0, 2026-04-17); implemented (M3)
**Deciders:** Platform engineering, security engineering
**Supersedes:** None

## Context

M3 needs a HashiCorp Vault client (plus AWS KMS for AWS-native tenants) to
back `KeyCustodyAbstraction`. The obvious option is the
[`node-vault`](https://www.npmjs.com/package/node-vault) npm package, but:

- Effectively single-maintainer.
- Last major release > 2 years ago as of 2026-04-17.
- Maintenance activity is sparse (issues open for months).

The surface area this platform needs from Vault is small:

- `kv/data/*` for secret material (API keys, partner credentials)
- `transit/sign`, `transit/verify` for signing keys
- Token renewal, lease management at the session level

## Decision

Do **not** adopt `node-vault`. In M3, build an in-house ~200-line Vault
client using `undici` (already a direct dep as of §6.2) for HTTP. Pair
with `@aws-sdk/client-kms` (installed in §6.2, wired in M3) for
AWS-native tenants. `KeyCustodyAbstraction` retains its 3-backend shape:
Vault, AWS KMS, future Azure KV.

## Consequences

**Positive:**

- Own the client code end to end; no single-maintainer exposure on a
  security-critical path.
- Keep the dependency graph small.
- Unit testing is straightforward — no external mocks needed beyond what
  msw (§6.2 install) already supports.

**Negative:**

- We take on maintenance of a ~200-line Vault client. Must track Vault API
  changes ourselves. In practice the Vault HTTP API is stable and this
  surface is small.
- No ready-made auth helpers (AppRole, Kubernetes, AWS IAM). M3 will
  implement the specific auth methods tenants actually need. Deferring this
  until the pattern is proven keeps us from building an abstraction against
  zero customer signal.

**Rejected alternatives:**

- `node-vault` — see Context above.
- `@hashicorp/vault-client-typescript` — does not exist at time of writing.
- A generic REST wrapper library — the authentication flows and token
  lifecycle concerns make generic HTTP libs unsuitable without wrapping
  anyway.

## Related findings

Contributes to R6-001 (Vault integration, deferred to M3).

## References

- `_plan/M3_0_FOUNDATION_RESET.md` §6.2, §13
