# M3.A6 Self-Review — Partner config Zod validation (NEW-04)

**Per §10.1 option (ii).** This PR touches
`packages/schemas/src/partner-profile-config.schema.ts` (new),
`packages/common/src/errors/ErrorCode.ts` (one enum add),
`packages/common/src/errors/SepError.ts` (one context field),
`apps/control-plane/src/modules/partner-profiles/partner-profiles.service.ts`
(one method). **None of the four §10.1 binding paths** (migrations,
crypto, auth, data-plane processors) are touched, so the self-review
is intentionally concise.

**Branch:** `m3.a6/partner-config-validation` off `main@1eaea88`
**Scope:** Single commit. A read-time parser that validates the
stored NESTED `config` shape (matching `CreatePartnerProfileSchema`
and the seed fixture) and asserts transport-to-subobject coherence,
wired into `PartnerProfilesService.findById()`.

---

## 1. Threat model

| #   | Threat                                                                           | Mitigation                                                                                                                          | Evidence                               |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| T1  | Malformed partner config reaches runtime callers                                 | `findById()` fail-closes on `PARTNER_CONFIG_INVALID`; error carries `issues[]` pinpointing each violation + the `transportProtocol` | `partner-profiles.service.ts:findById` |
| T2  | Transport/config mismatch (SFTP profile with only `config.https`, or vice versa) | Parser asserts `config.sftp !== undefined` for SFTP and `config.https !== undefined` for HTTPS before returning                     | `parsePartnerProfileConfig` body       |
| T3  | Partial SFTP config allows host-key-fingerprint bypass                           | Reuses `SftpConfigSchema` (hostKeyFingerprint required, min(1))                                                                     | `partner-profile-config.schema.ts`     |

### Fresh-eyes re-read caught one regression before push

The first draft defined a FLAT read-path schema (`config.host`) — which would have rejected the seed fixture (`packages/db/prisma/seed.ts:204` writes NESTED `config.sftp.host`) and every profile created via the HTTP flow (`CreatePartnerProfileSchema` writes NESTED). Corrected to validate the NESTED shape the write path and seed already use. The data-plane processors' current FLAT reads are the real misalignment — they're a separate bug, filed as follow-up.

### Out of scope (flagged as follow-ups)

- **Data-plane processor adoption.** `intake.processor.ts` reads `profileConfig['keyReferenceId']` at top-level; `delivery.processor.ts` reads `profileConfig['host']` / `['port']` / etc. at top-level with a silent fallback to `'partner.example.com'`; `inbound.processor.ts` reads `profileConfig['inboundKeyReferenceId']` at top-level. The seed + CREATE flow + this parser all agree on NESTED (`config.sftp.host`), so the processors are silently misrouting. Fix is to route processor reads through `parsePartnerProfileConfig` and then index into the matched sub-object. Load-bearing security fix but beyond 0.5-eng-day M3.A6 scope.
- **AS2 schema.** AS2 is in `TransportProtocol` enum but has no data-plane connector. The parser accepts any object for AS2; M3.5 will tighten.

---

## 2. Test coverage

| Suite                                 | Before     | After | Delta                         |
| ------------------------------------- | ---------- | ----- | ----------------------------- |
| `@sep/schemas` unit                   | (existing) | +18   | schema + parser cases         |
| `@sep/control-plane` partner-profiles | (existing) | +2    | findById read-time validation |
| **Total**                             |            |       | +20                           |

New cases:

- `PartnerProfileConfigSchema` — nested SFTP/HTTPS accept, both sub-objects permitted, empty object permitted (coherence is the parser's job), extra-key tolerance via passthrough, non-object rejection, malformed sub-object rejection
- `parsePartnerProfileConfig` — SFTP/HTTPS/AS2 happy, AS2-empty, SFTP-no-sftp throws, HTTPS-no-https throws, malformed nested sftp surfaces issues array, null-for-SFTP throws, error carries `transportProtocol`
- `PartnerProfilesService.findById` — empty config throws; nested sftp with empty host throws

### Coverage gaps (accepted)

- `findAll / update / transition / suspend / retire` don't invoke the validator. Rationale: plan's T01 literally named `findById`; extending to all read paths is scope creep. `findAll` in particular would validate every row on every list call — expensive and not security-load-bearing since list consumers don't touch connector fields.
- Data-plane processors don't invoke the validator. See follow-up above.

---

## 3. Rollback

Pre-merge: single commit. Revert is code-only; schemas and error code are additive.

Post-merge: `git revert <merge-commit>` removes the new schema file + error code + one-line service wiring. No migration, no Vault changes, no DB state.

A rollback would re-expose the silent-misrouting risk on malformed configs but would not corrupt data in flight (the validator gates on read, not on write). Existing seed profile + any created profile remain fully readable.

---

## 4. Sign-off

- [x] Threat model addressed — 3 threats (T1–T3), file:line evidence
- [x] Test coverage asserted — +20 cases; no integration tests needed for a pure-parse validator
- [x] Rollback documented — single revert, no state carry-over
- [x] Known gaps flagged — 2 follow-up issues (data-plane adoption; AS2 schema tightening) to file post-merge
- [x] §10.1 lightweight — not a high-blast-radius path, review is proportionate
- [x] Fresh-eyes re-read per §10.1 step 3-4 — caught one shape regression before push; corrected in-commit

**Ready to merge.** Plan-literal scope satisfied; the observed
data-plane misalignment is filed as a separate follow-up rather
than silently mixed into this PR.
