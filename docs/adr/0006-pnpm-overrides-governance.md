# ADR-0006 — pnpm.overrides governance

**Status:** Accepted (hygiene PR #11, 2026-04-17)
**Deciders:** Platform engineering + user review
**Context:** Forensic audit PRIOR-R5-001 + M3.0 user decision #6 + hygiene PR #11 CVE response
**Supersedes:** Partially supersedes M3.0 handoff note decision #6 (see §Consequences).

## Context

Phase 1's dependency strategy is exact-pinning in every workspace manifest
(PRIOR-R5-001 closure). That strategy on its own cannot close transitive
vulnerabilities when an upstream dependency itself hard-pins a vulnerable
version.

Specifically: `@nestjs/platform-fastify` 11.1.18 (our current pin)
transitively hard-pins `fastify` 5.8.4. GHSA-247c-9743-5963 (CVSS 7.5)
affects `fastify < 5.8.5`. Workspace-level exact-pinning to 5.8.5 in
`apps/control-plane/package.json` did not remove 5.8.4 from the tree,
because the NestJS platform adapter's transitive pin overrode it.

M3.0 user decision #6 removed the `fastify` `pnpm.overrides` entry on the
reasoning that direct exact-pinning made the override redundant. That
reasoning held when the condition "no transitive drift pressure exists"
was true — which it was at the moment of M3.0 decision #6.

The condition changed when the CVE was discovered.

## Decision

`pnpm.overrides` is accepted as a governance mechanism with three
legitimate uses:

1. **Cross-workspace version alignment.** When multiple workspaces declare
   the same direct dependency and version drift could introduce duplicate
   copies, hoist via overrides. Example: `openpgp` 5.11.3 in M3.0.

2. **Targeted security-closure forcing.** When a transitive dependency
   carries a CVE and the upstream pin prevents workspace-level
   exact-pinning from closing it, use an override to force resolution to
   the patched version. Example: `fastify` 5.8.5 in hygiene PR #11
   (this ADR).

3. **Temporary pin-forward during upstream coordination.** When we need a
   newer version than what our direct dependencies will accept (peer-dep
   ranges, transitive pins, etc.) and the upgrade is time-bounded,
   override with an explicit expiry condition. Each such override MUST
   have a linked issue tracking the closure trigger (the upstream release
   that makes the override redundant).

Overrides are **NOT** for:

- Masking actual incompatibilities (fix the dependency graph, don't hide
  the conflict).
- Long-term pin-forwards with no closure trigger (rethink the dependency
  choice, don't carry drift).
- Development-only conveniences (use workspace devDeps or
  `peerDependenciesMeta` instead).

## Consequences

- Decision #6 in `_plan/M3_0_HANDOFF.md` stands as correct for its
  original condition (no drift pressure) but is amended by the addendum
  dated 2026-04-17 to reflect the CVE-triggered restoration.

- Every `pnpm.overrides` entry MUST have an inline comment in the
  governance record (this ADR's "Current overrides" appendix, updated
  with each change) citing the use-case category and — for categories
  (2) and (3) — the closure trigger issue.

- Future CVE-triggered overrides follow the pattern established in
  hygiene PR #11: override + filed issue + closure trigger named +
  ADR-0006 "Current overrides" appendix updated in the same commit.

## Current overrides (as of 2026-04-17)

| Package         | Version  | Use-case | Closure trigger                                                                   |
| --------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| openpgp         | 5.11.3   | (1)      | n/a — permanent cross-package alignment                                           |
| undici          | 7.25.0   | (1)      | n/a — permanent cross-package alignment                                           |
| fastify         | 5.8.5    | (2)      | Issue #12 — @nestjs/platform-fastify transitive bump to fastify ≥ 5.8.5           |
| protobufjs      | 7.5.5    | (2)      | Transitive fix via OTEL proto release (tracked with the overall OSV waiver issue) |
| tar             | >=7.5.11 | (1)      | n/a — supply-chain floor                                                          |
| picomatch       | >=4.0.4  | (1)      | n/a — supply-chain floor                                                          |
| lodash          | >=4.18.0 | (1)      | n/a — supply-chain floor                                                          |
| @fastify/middie | >=9.2.0  | (1)      | n/a — supply-chain floor                                                          |

## Follow-up / review trigger

- When any category-(2) or category-(3) override's closure trigger fires
  (tracked issues close), the override entry is removed in the same PR
  that closes the issue and this ADR's "Current overrides" appendix is
  updated.
- A category-(1) override should be reviewed every major version of the
  related dependency to confirm the cross-package alignment is still
  needed.
