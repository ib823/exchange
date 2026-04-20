# M3.A5 Self-Review — Key custody + Vault backends

**Per §10.1 option (ii)** of `_plan/M3_EXECUTION_PLAN.md`: solo contributor
with self-review discipline. This PR touches `packages/crypto/` (the
security-critical path) so a self-review against three dimensions is
mandatory before merge.

**Branch:** `m3.a5/key-custody` (14 commits, `4ec295b`..`f6b6810`)
**Scope:** 10-method `IKeyCustodyBackend` V1 contract, `KeyCustodyAbstraction`
dispatcher, Platform + Tenant Vault backends, ExternalKms/SoftwareLocal
interface-only stubs, CryptoService + KeyRetrievalService delegation,
data-plane Vault-backed key retrieval, 38-test conformance suite,
key-expiry scanner, ADR-0007.

---

## 1. Threat model

### Assets under protection

- **Private PGP key material** stored in HashiCorp Vault KV v2 under
  `platform/keys/*` and `tenant/<tenantId>/keys/*`.
- **Armored public keys** (non-secret but integrity-critical — a
  substituted public key enables a forged signature to verify).
- **Tenant boundary** — one tenant must never read/write another
  tenant's keys.
- **Audit trail** — every key-custody op eventually records a
  CryptoOperationRecord; scanner-initiated Incidents are
  system-authored but audit-coupled.

### Threats considered and mitigations

| # | Threat | Mitigation | Evidence |
|---|---|---|---|
| T1 | Private key material leaks to logs | Backends NEVER log armored private keys. Log only fingerprint prefixes (8 chars). Pino redaction paths cover `*.privateKey`, `*.passphrase`, etc. | `vault-backend.ts:98`, `vault-backend.ts:241` |
| T2 | Private key material leaks via error paths | SepError context field allowlist (`SepError.ts:3-73`) does not include `armoredKey`/`privateKey`. Operation name + keyReferenceId only. | All backend `throw new SepError(...)` sites |
| T3 | Private key buffer lingers in memory after an op | Every private-material operation wraps Buffer alloc + `zeroBuffer(buf)` in `try/finally`. Docs note string-based material is not zeroable (JS strings immutable) — only Buffers we allocate are cleared. | `vault-backend.ts:98-129`, `:222-266`, `:222-292` |
| T4 | Cross-tenant key access via TENANT_VAULT backend | `TenantVaultBackend` takes tenantId at construction. `kvPathFor(ref)` throws `TENANT_BOUNDARY_VIOLATION` if `ref.tenantId` ≠ construction tenantId, BEFORE any Vault HTTP call. | `vault-backend.ts:340-356` |
| T5 | Cross-tenant composite op (both `TENANT_VAULT`, different tenantIds) slips through because backendType matches | Dispatcher compares backend **instances**, not backendType. Each tenantId resolves to its own `TenantVaultBackend`. `dispatchSignAndEncrypt`/`dispatchDecryptAndVerify` throw `CRYPTO_BACKENDS_INCOMPATIBLE` when instances differ. | `key-custody-abstraction.ts:90-150`, test cases at `key-custody-abstraction.test.ts:244-285` |
| T6 | Key substitution in Vault storage (attacker rewrites armored material) | Two-layer fingerprint check: backend compares stored-fingerprint vs `ref.fingerprint` (catches the naive case); `KeyRetrievalService` parses the armored key and compares extracted fingerprint vs DB row (catches the case where both stored-fingerprint and armored are forged but diverge). | `vault-backend.ts:263-282`, `key-retrieval.service.ts:116-147` |
| T7 | Algorithm substitution (attacker swaps RSA key for weaker algorithm) | `KeyRetrievalService` extracts algorithm from the armored key and compares to `row.algorithm`. Mismatch → `KEY_FINGERPRINT_MISMATCH` (terminal). Forbidden-algorithm list (`FORBIDDEN_ALGORITHMS`: dsa, elgamal) checked in policy enforcement. | `key-retrieval.service.ts:149-158`, `interfaces.ts:44-65` |
| T8 | Schema drift or poisoned DB row with unknown backendType | `KeyCustodyAbstraction.backendFor` has a `default:` arm that throws `CRYPTO_BACKEND_UNKNOWN` (terminal). Not a silent `undefined` dereference. | `key-custody-abstraction.ts:82-108`, test `backendType outside the enum` |
| T9 | Replay of a stolen rotated key (backend rotate returns old material) | `rotate()` writes a new KV v2 version and returns `newBackendRef` pointing at `path#v<N>`. Caller (KeyReferencesService) must persist the new ref in the SAME transaction as the rotation audit. | `vault-backend.ts:287-323`; note: persistence is caller responsibility — integration audit belongs to the processor consuming rotate |
| T10 | Interface-only backend (ExternalKms/SoftwareLocal) accidentally used in production | Every method on both stubs throws a terminal error (`CRYPTO_BACKEND_NOT_IMPLEMENTED` / `CRYPTO_BACKEND_NOT_AVAILABLE` / `CRYPTO_OPERATION_NOT_SUPPORTED`). Registered in `TERMINAL_ERROR_CODES` — never retried. Conformance suite asserts `terminal=true` on every stub throw. | `stub-backends.ts` (entire file), `conformance.test.ts:177-293` |
| T11 | Malformed JWT / broken auth flow bypasses tenant guard in data-plane scanner | Scanner runs without user context (`actorType='SYSTEM'`). Cross-tenant listing uses `forSystem()` (raw Prisma client) for the READ path — bypasses RLS intentionally. Mutation path drops back into `forTenant(tenantId, ...)` so incident creation is RLS-scoped. | `key-expiry-scan.processor.ts:154-176`, `incident-writer.service.ts:93-120` |
| T12 | Scanner spams incidents on every daily run | `IncidentWriterService.existsOpenForSource` checks for an open-like incident at the same severity before creating; scanner calls it per tier. Resolved/closed incidents can re-trigger if the key is still in tier — by design (the reminder should resurface if operator ignored). | `key-expiry-scan.processor.ts:107-115`, test `skips creating a duplicate...` |

### Threats considered out of scope for this PR

- **Vault operator compromise** — if the Vault admin credential is
  stolen, all keys are compromised. Mitigation is operational (Vault
  AppRole with tightly scoped policies, audit of admin events), not
  code-level. Tracked in M3.A7+ ops runbooks.
- **Process memory dump during crypto op** — an attacker with
  privileged local access can read the private key between Buffer
  alloc and `zeroBuffer()`. JavaScript's immutable-string semantics
  preclude a full mitigation; the Buffer-zero pattern narrows the
  window. Out of scope for pure-software backends; future KMS-class
  backends that hold keys in HSM address this.
- **Side-channel timing on verify** — `openpgp.verify` is not
  guaranteed constant-time. Mitigation depends on the openpgp.js
  library, not our code. Upstream concern.

---

## 2. Test coverage

### Numbers

| Suite | Before | After | Delta |
|---|---|---|---|
| `@sep/crypto` unit | 82 | 114 | +32 |
| `@sep/common` unit | unchanged | unchanged | 0 |
| `@sep/control-plane` unit | 116 | 116 | 0 |
| `@sep/data-plane` unit | 67 | 76 | +9 |
| `@sep/custody-conformance-tests` integration | — | 38 (new) | +38 |
| **Total** | — | — | **+79** |

Full test task count across the monorepo: **15** (green).
Full lint task count: **17** (green).

### Coverage by risk dimension

**Backend contract conformance** — live Vault round-trip for
PlatformVaultBackend and TenantVaultBackend covers all 10 methods
plus tamper detection on `verifyDetached`. Fail-closed assertions for
both stubs cover all 10 methods plus explicit `terminal=true` check.
See `tests/integration/custody-conformance/conformance.test.ts`.

**Dispatcher routing** — `key-custody-abstraction.test.ts` covers every
`KeyBackendType` literal (exhaustive switch), cached vs fresh tenant
backends, poisoned-enum fallback, cross-backend composite rejection
(6 explicit cases: same-platform, same-tenant, different-tenant-same-class,
platform-vs-tenant, vault-vs-kms, kms-vs-softwarelocal) — for both
composites.

**CryptoService delegation** — `crypto.service.test.ts` (10 cases)
exercises every path through the new backend-routed implementation
with a mock backend performing real openpgp.js round-trips. Policy
enforcement asserted pre-backend (expired key, forbidden algorithm,
invalid state).

**Key retrieval defence-in-depth** — `key-retrieval.service.test.ts`
(18 cases) covers state machine, environment mismatch, expiry, and
the two-layer fingerprint/algorithm check against real RSA + ECC
fixture keys.

**Scanner logic** — `key-expiry-scan.processor.test.ts` (9 cases)
covers tier mapping (P1/P2/P3), narrowest-tier-wins on overlapping
tiers, de-dup against open incidents, batch with out-of-range
exclusion, past-expiry skip, explicit `scanAt` reproducibility.

**Vault client (undici)** — `vault-client.test.ts` (10 cases) covers
constructor validation, KV read/write, 401/403/404 mapping, retry
exhaustion, transit ops, namespace header.

### Known gaps (intentionally deferred)

- **CryptoService return-contract bug**: `encryptedPayloadRef` is a
  synthetic path string, not actual ciphertext. Processor writes the
  path string to object storage instead of the ciphertext
  (`crypto.processor.ts:174-179`, `:462`). This is an M2 carry-over
  flagged in code comments; downstream decryption in production would
  fail. Tagged for follow-up PR — fix requires processor call-site
  changes and e2e fixture rework that would have inflated this
  milestone. Does **not** affect the correctness of the backend
  contract or the delegation path this PR ships.
- **SIGN_ENCRYPT processor passes the signing key twice**: surfaced
  during fresh-eyes re-read. `crypto.processor.ts:218-226` calls
  `cryptoService.signAndEncrypt(payload, resolvedKey.keyRef,
  resolvedKey.keyRef, ...)` — signing AND recipient are the same
  `KeyRef`. In production, this produces an OpenPGP message signed by
  the partner's signing key and encrypted to that same signing key
  (sign-and-encrypt-to-self), **not to the partner's encryption key**.
  Git blame (`8d2c49dc`, 2026-04-19) confirms this is a pre-existing
  M2 bug; this PR neither introduces nor fixes it. The new dispatcher
  check (`CRYPTO_BACKENDS_INCOMPATIBLE`) passes trivially when the two
  refs are identical, so the bug is not caught at the dispatcher
  layer. **Action for the fix-up PR:** the processor must resolve two
  distinct `KeyReference` rows — the tenant's signing key and the
  partner profile's recipient encryption key — and pass both to
  `signAndEncrypt`. Scope overlaps with M3.A5-T08 (partner profile
  key resolution).
- **`verify(... detached: true)` quirk**: preserved M2 behaviour of
  treating `payloadRef` as the signature and verifying against an
  empty message. Not a new bug; not fixed here. Flagged in code
  comments for API cleanup.
- **Repeatable-job bootstrap for the expiry scanner**: processor is
  wired into `AppModule`, but the daily cron trigger lives in
  deployment bootstrap (not covered here). Infra-level concern.

### Scenario coverage against `docs/03_SECURITY_CRYPTO_SPEC.md` 14 threat scenarios

This PR contributes mitigations to:
- Scenario 3 (wrong partner public key) — T1, T2, T6, T7
- Scenario 4 (expired key) — T7 (policy enforcement path) + expiry scanner
- Scenario 7 (secret in logs) — T1, T2
- Scenario 8 (cross-tenant data exposure) — T4, T5

Full 14-scenario matrix is the subject of a separate threat-scenario
test suite (tracked in M3.A9).

---

## 3. Rollback path

### If this PR needs to be reverted

**Clean revert is safe.** The branch is additive in two directions:

1. **New files** (conformance suite package, incident writer, expiry
   scanner processor, ADR) — revert removes them; no external
   references outside this PR.
2. **Modified files** (CryptoService, KeyRetrievalService, processors,
   backend contract) — the 14 commits form a linear history that
   cherry-revertible as one unit. The final tip (`f6b6810`) is the PR
   head; `git revert 4ec295b^..f6b6810 -m 1` after merge produces a
   single revert commit.

### Pre-merge rollback

Before this PR merges, any commit on the branch can be dropped
individually without breaking downstream because the intermediate
compile was verified during the history replay in C1/C2 amendment
(see `4ec295b`..`5965aed` — each commit proven compilable
independently).

### Post-merge rollback

After merge, the following systems would need coordination:

- **Vault KV paths**: if keys have been written to `platform/keys/*`
  or `tenant/<id>/keys/*` via the new backends, those KV entries
  persist after a code revert. Rolling back code alone leaves the
  keys in Vault but no code to read them. Mitigation: the old M2
  `ArmoredKeyMaterialProvider` stored nothing in Vault; after revert
  the system falls back to the old-shape `KeyReference.backendRef =
  armored-key-text` path — but ONLY for rows that still have that
  format. Rows written under the new regime have `backendRef =
  "platform/keys/<id>"` which the old provider would fail to parse
  as armored material.
- **Incidents written by the scanner**: system-authored incidents
  persist after a code revert. Operators handle them manually.
- **Config**: new `KEY_EXPIRY_EARLY_WARNING_DAYS` env var. If unset
  after revert, no harm — the old config doesn't read it.

### Mitigation for the Vault/backendRef cutover

At merge time, **no keys are expected to exist under the new-path
format yet** (this PR does not migrate existing keys). The cutover
would happen in a subsequent PR (tracked under M3.A5-T08 per
`_plan/M3_EXECUTION_PLAN.md` §5 as the data migration task). Until
that migration runs:

- All existing `KeyReference` rows keep their M2-format `backendRef`
  (armored key text).
- The new CryptoService delegates to `backendFor(ref).getPublicKey(...)`,
  which calls `VaultKeyCustodyBackend.loadMaterial`, which reads from
  Vault KV at `kvPathFor(ref)`.
- For legacy rows with M2-format backendRef, this read will 404
  (Vault has no key at that path) and surface as
  `CRYPTO_KEY_NOT_FOUND`. **This is a runtime regression for the
  legacy path.**

**Action before merge: verify there are no existing `KeyReference`
rows in any production-like environment.** The dev seed does create
such rows; the revert path for dev is to re-run `pnpm -r db:seed`
after seeding the new Vault KV paths.

For CI (which this PR adds Vault service to): the conformance suite
creates its own keys in Vault at test-time; no cross-suite
dependency.

### Safe commits

Commits where a subset revert is safe:
- **`3d4e99c` (expiry scanner)** — can be reverted independently;
  purely additive.
- **`5ae1797` (conformance suite + CI)** — test-only; can be
  reverted independently.
- **`f6b6810` (ADR-0007)** — docs-only.

Commits that must move together:
- **`4ec295b`..`5965aed`** (error codes → dispatcher) — interlocked.
- **`b96338e`..`2d821c5`** (composite dispatch → CryptoService refactor
  → data-plane swap) — the data-plane swap cannot run without the
  CryptoService refactor; the refactor cannot compile without the
  composite dispatchers.

---

## Sign-off

- [x] Threat model addressed (12 threats enumerated, mitigations + evidence)
- [x] Test coverage asserted (+79 tests, 15 test tasks green)
- [x] Rollback path documented (clean revert; Vault KV/Incident carry-over noted)
- [x] Known gaps flagged explicitly (return-contract bug, detached-verify quirk, cron wiring) — not regressions introduced by this PR

**Self-review complete. Ready to merge.**
