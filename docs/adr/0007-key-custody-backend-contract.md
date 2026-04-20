# ADR-0007 — Key custody backend contract: 10-method V1, V2 trajectory, composite-op design

**Status:** Decided (M3.A5, 2026-04-20); implemented (M3.A5)
**Deciders:** Platform engineering, security engineering
**Supersedes:** None
**Related:** ADR-0004 (reject `node-vault`)

## Context

M3.A5 delivered `KeyCustodyAbstraction` + `IKeyCustodyBackend` as the single
entry point for every cryptographic operation that touches private key
material. Four concrete backends (PlatformVaultBackend, TenantVaultBackend,
ExternalKmsBackend, SoftwareLocalBackend) sit behind it; the first two are
real implementations against HashiCorp Vault, the last two are interface-only
stubs that fail closed with typed errors.

This ADR records three decisions that surfaced during execution and that
future readers will otherwise have to reverse-engineer from the diff:

1. What the 10-method V1 contract covers and why it grew mid-milestone.
2. The same-backend precondition for composite ops and its dispatcher
   enforcement layer.
3. The V2 trajectory — a single `perform(op: KeyOperation)` method over
   a tagged-union descriptor — and the explicit trigger for cutting over.

## Decision — the 10-method V1 contract

`IKeyCustodyBackend` exposes ten methods. Eight are single-key operations; two
are composite operations that require both a signing/decryption key and a
counterparty public key in simultaneous scope:

| #   | Method                | Kind          | Purpose                                                               |
| --- | --------------------- | ------------- | --------------------------------------------------------------------- |
| 1   | `getPublicKey`        | single-key    | Return armored public key (safe to log fingerprint only)              |
| 2   | `signDetached`        | single-key    | Produce detached OpenPGP signature                                    |
| 3   | `signInline`          | single-key    | Produce inline-signed OpenPGP MESSAGE block                           |
| 4   | `verifyDetached`      | single-key    | Verify detached signature; returns boolean (never throws on mismatch) |
| 5   | `decrypt`             | single-key    | Decrypt OpenPGP ciphertext                                            |
| 6   | `encryptForRecipient` | single-key    | Encrypt plaintext for recipient's public key                          |
| 7   | `signAndEncrypt`      | **composite** | Atomic RFC 9580 sign-then-encrypt                                     |
| 8   | `decryptAndVerify`    | **composite** | Atomic decrypt-then-verify (embedded signature)                       |
| 9   | `rotate`              | lifecycle     | Generate new key material; return new backendRef + fingerprint        |
| 10  | `revoke`              | lifecycle     | Destroy key material in backend (idempotent)                          |

### Why 10, not 7

The contract started at 7 methods. Three grew in during C6b-ii
(CryptoService refactor) because call-site patterns surfaced gaps the
original sketch hadn't accounted for:

- **`signAndEncrypt`** (added in C5b-pre): `openpgp.sign({ signingKeys })` +
  `openpgp.encrypt({ encryptionKeys, signingKeys })` is **atomic at the
  openpgp.js boundary** — both keys must be in scope on the same call. The
  original 7-method design assumed we could decompose this into
  `signDetached(sig) → encryptForRecipient(sig+payload)`, but detached
  signatures and inline-signed messages are different OpenPGP packet
  structures; reassembling locally would re-introduce private-material
  handling outside the backend boundary.

- **`decryptAndVerify`** (added in C5c): symmetric inverse.
  `openpgp.decrypt({ decryptionKeys, verificationKeys })` verifies
  embedded signatures inside the ciphertext in a single call. Decomposing
  into `decrypt(ct) → verifyDetached(...)` would not work because the
  verification target is embedded in the encrypted packet, not a separate
  detached signature.

- **`signInline`** (added in C5d): required by the data-plane SIGN
  operation for partner profiles that use inline-signed (non-detached)
  signatures. `openpgp.sign({ detached: false })` produces a distinct
  output from `openpgp.sign({ detached: true })` — an armored PGP MESSAGE
  block containing payload + signature versus a standalone signature.
  Different backend method because of the distinct output brand and
  semantic role.

### Lesson

We catalogue external standards up front next time. RFC 9580's composite
ops and inline-vs-detached signature distinction were in the spec; they
surfaced as integration surprises only because the original interface
design sketched methods by convenience ("sign a thing") rather than by
RFC 9580 operation classes ("what OpenPGP primitives does the caller
invoke, and which require simultaneous key scope").

## Decision — composite-op same-backend precondition

Both composite methods carry a contract invariant that is **not enforced
by the backend**: the two keys passed in must resolve to the same backend
instance. Backends do not cross-check the refs they receive; the dispatcher
(`KeyCustodyAbstraction.dispatchSignAndEncrypt` / `dispatchDecryptAndVerify`)
performs this check before forwarding.

### Why instance identity, not backendType

Two refs could both have `backendType: 'TENANT_VAULT'` but different
tenantIds. They legitimately resolve to **different** `TenantVaultBackend`
instances — each holds a per-tenant path prefix and tenant-boundary
invariant. If the dispatcher compared by backendType alone, a cross-tenant
composite op would reach openpgp.js before either backend's own tenant
check fired.

Comparing by backend instance catches the cross-tenant case cleanly.

### Failure mode

Cross-backend composite dispatch throws `CRYPTO_BACKENDS_INCOMPATIBLE`
(terminal). The error context carries both key reference IDs so audit
logs record the attempted routing violation.

### Two methods over a tagged-union `dispatchComposite(op)`

Two parallel dispatcher methods (one per composite) ship over a single
polymorphic `dispatchComposite(op)` taking a union. Call sites read more
cleanly (`dispatcher.dispatchSignAndEncrypt(...)`) and TypeScript return
types are direct rather than discriminated. If a third composite ever
lands, collapse all three into one method — see "Generalization trigger"
below.

## Decision — V1 → V2 trajectory

V1 ships the 10 separate methods. V2 replaces them with a single
`perform(op: KeyOperation)` method taking a tagged-union operation
descriptor. V2 is **explicitly deferred**, not in M3.A5.

### V2 shape (sketch, not implemented)

```typescript
type KeyOperation =
  | { kind: 'getPublicKey'; ref: KeyReferenceInput }
  | { kind: 'signDetached'; ref: KeyReferenceInput; payload: Buffer }
  | { kind: 'signInline'; ref: KeyReferenceInput; payload: Buffer }
  | { kind: 'verifyDetached'; ref: KeyReferenceInput; payload: Buffer; signature: Signature }
  | { kind: 'decrypt'; ref: KeyReferenceInput; ciphertext: Ciphertext }
  | { kind: 'encryptForRecipient'; ref: KeyReferenceInput; plaintext: Plaintext }
  | { kind: 'signAndEncrypt'; signingKeyRef: …; recipientKeyRef: …; plaintext: Plaintext }
  | { kind: 'decryptAndVerify'; decryptionKeyRef: …; senderKeyRef: …; ciphertext: Ciphertext }
  | { kind: 'rotate'; ref: KeyReferenceInput }
  | { kind: 'revoke'; ref: KeyReferenceInput };

interface IKeyCustodyBackendV2 {
  perform<K extends KeyOperation['kind']>(
    op: Extract<KeyOperation, { kind: K }>,
  ): Promise<OperationReturnMap[K]>;
}
```

V1 methods remain available; their implementations delegate to
`perform()` internally. Full V1 removal happens no earlier than M3.A10,
pending migration of all call sites.

### Generalization trigger — composite ops

During M3.A5 we landed with **two** composite methods (`signAndEncrypt`,
`decryptAndVerify`) and chose to keep them as parallel methods rather
than collapse into `composite(op: CompositeOperation)`. The trigger for
cutover:

> If a third RFC 9580 composite operation is added — candidates include
> `signAndEncryptSymmetric` (symmetric-key recipient), `encryptToMultiple
RecipientsWithSignature` (broadcast-sign), `decryptAndVerifyWithFallback
KeyList` (multiple possible signer keys) — refactor all three into a
> single `composite(op)` method taking a tagged-union descriptor at the
> interface layer AND a single `dispatchComposite(op)` at the dispatcher
> layer.

Three parallel methods is the point at which the interface sprawls and
the precondition-check code starts to duplicate. Two parallel methods
is below that threshold; shipping two read more cleanly at the call site
and the precondition logic is simple enough to inline without loss.

### Cutover ordering

The planned order when V2 is adopted:

1. M3.A6 (or later): Add `perform()` to `IKeyCustodyBackend` as an
   abstract method. Implement on all four backends.
2. Same commit: V1 methods are marked `@deprecated` and their bodies
   become one-line shims that call `perform({ kind: ... })`.
3. Follow-up commits: migrate call sites from V1 methods to `perform()`,
   one subsystem at a time (CryptoService first, then KeyRetrievalService,
   then processors).
4. M3.A10 or M4: after all call sites are migrated, remove V1 methods
   from the interface. This is a breaking change; timing is a product
   decision, not a technical one.

V2 was explicitly **not** done in M3.A5. Scope analysis in C6c's
stop-and-report surfaced four options (full inversion, additive
convenience layer, type-level-only, defer entirely); Option D (defer
entirely) was selected to close M3.A5 with working V1 rather than
expand scope with a parallel API that duplicates surface without
customer signal.

## Decision — Vault client architecture

`KeyCustodyAbstraction` uses a custom undici-based Vault HTTP client
rather than `node-vault` per ADR-0004. Key architectural choices:

- **KV v2 for armored PGP material, not transit engine.** Vault's transit
  engine emits ciphertext in its own envelope format (`vault:v1:…`) that
  is not RFC 9580 compatible. The platform stores armored PGP key material
  in KV v2 and delegates cryptographic operations to openpgp.js in-process.
  The transit engine is reserved for non-PGP uses (e.g., M3.A4 MFA secret
  encryption).
- **Zeroise-after pattern.** Private material is loaded into a process-local
  `Buffer`, passed to openpgp.js, and zeroised in a `finally` block. String
  material (armored keys as JavaScript strings) is not zeroable (strings
  are immutable); the Buffer copy captures the narrow window we can clear.
- **Fingerprint pinning.** Every `loadMaterial` call compares the stored
  fingerprint (written alongside the armored key) against `ref.fingerprint`
  as a first-line defence against key substitution. `KeyRetrievalService`
  adds a second defence: it parses the returned armored key and checks
  the extracted fingerprint against the DB row — catches tampering where
  both stored-fingerprint and armored-key were forged but diverge.
- **Tenant boundary as construction-time invariant.** `TenantVaultBackend`
  takes its tenantId at construction. Every ref passed to its methods is
  checked against that tenantId before any Vault HTTP call, so cross-tenant
  references fail fast without leaking a KV read. `KeyCustodyAbstraction`
  caches `TenantVaultBackend` instances per tenantId.

## Consequences

**Positive:**

- 10-method interface is explicit about the RFC 9580 operation classes.
  No "I thought this was a one-liner" surprises during integration.
- Composite-op precondition catches cross-tenant routing errors at the
  dispatcher layer, before backend code runs.
- V2 trajectory is documented with an explicit trigger — future work
  doesn't re-litigate "should we collapse these?" from scratch.
- Vault client is ~500 lines of code we control end-to-end. No
  single-maintainer dependency on a security-critical path.

**Negative:**

- Interface is larger than the original 7-method sketch. Adding an 11th
  single-key operation means touching five files (interface + 4
  backends); adding a third composite triggers the V2 generalization.
- V1 stays around until full migration — dual surface (V1 now, V2 when
  M3.A10 lands) for some period.
- Backend implementers must honor a contract that isn't enforced at the
  type level: private material never exits the backend; buffers zeroised
  after use. A lint rule or runtime instrumentation could catch
  violations but we haven't built one.

**Rejected alternatives:**

- **Collapse signAndEncrypt/decryptAndVerify into `composite(op)` in
  M3.A5.** Considered during C5c. Two methods over one polymorphic
  method reads more cleanly at the call site and keeps return types
  direct. The 3-composite trigger above is the explicit point to
  revisit.
- **Add `perform(op)` as a parallel V2 method in M3.A5 (Option B in
  C6c).** Scope-bounded but ships a second API shape without a concrete
  call-site win. Deferred per C6c Option D.
- **Store PGP material via Vault transit.** Envelope format mismatch;
  transit cannot return RFC 9580-compatible ciphertext, so the platform
  would have to re-wrap in-process — defeats the "delegate to the HSM"
  argument.

## Related findings

Contributes to R6-001 (Vault integration) closure in M3.A5.

## References

- `docs/adr/0004-reject-node-vault.md` — Vault client dependency choice.
- `packages/crypto/src/custody/i-key-custody-backend.ts` — the contract
  this ADR documents.
- `packages/crypto/src/custody/key-custody-abstraction.ts` — dispatcher,
  composite-op precondition checks.
- `packages/crypto/src/custody/vault-backend.ts` — Vault-backed
  implementation with zeroise-after pattern.
- `tests/integration/custody-conformance/conformance.test.ts` — the
  suite that asserts every backend honors the contract.
