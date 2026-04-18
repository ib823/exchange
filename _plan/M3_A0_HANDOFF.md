# M3.A0 — Handoff note

**Status:** 🟢 COMPLETE — M3.A1 through M3.A10 can begin
**Produced:** 2026-04-18
**Branch:** `m3.a0/pre-m3-housekeeping` → PR opened after this commit lands
**Supersedes:** issue #16 (closes on PR merge)
**Next session:** M3.A1 — Database tenant isolation (RLS)

---

## 1. Verification table

Final `_plan/scripts/verify-m3-0-findings.mjs` output (run immediately before this handoff commit):

```
M3.0 Findings Verification (reconciled for post-m3.0-baseline)
======================================================================
OK     PRIOR-R1-001                     CI SHA-pinning: every `uses:` ref ends in 40-char SHA
OK     PRIOR-R1-003                     TypeScript project references: composite:true on all package tsconfigs
OK     PRIOR-R1-004-dockerignore        R1-004 (part): .dockerignore exists
OK     PRIOR-R1-004-hooks               R1-004 (part): pre-commit hooks configured (lefthook)
OK     PRIOR-R3-003                     R3-003: no `body as {...}` cast pattern in controllers
OK     PRIOR-R4-001                     R4-001: plain `throw new Error` count within documented budget (<=2)
OK     PRIOR-R4-002                     R4-002: `as unknown as` count within documented budget (<=5)
OK     PRIOR-R4-003                     R4-003: exports `types` condition first
OK     PRIOR-R5-001                     R5-001: no caret ranges on production dependencies
OK     PRIOR-R5-002                     R5-002: working SCA gate
OK     REMOVED-passport                 passport stack removed from all manifests
OK     REMOVED-class-validator          class-validator + class-transformer removed
OK     REMOVED-bcrypt                   bcrypt removed; @node-rs/argon2 installed
OK     ADDED-nestjs-zod                 nestjs-zod installed
OK     NEW-05                           no `body as {...}` cast in approvals controller
OK     NEW-06                           API URI versioning enabled
OK     NEW-09                           single openpgp version across lockfile
OK     NEW-TEST-COUNT-REFUTED           refutation recorded in PLANS.md
OK     ENV-scrubbed                     .env.example scrubbed
OK     ADR-0001                         ADR-0001 exists and is substantive
OK     ADR-SET                          all 6 ADRs present
OK     CODEOWNERS                       CODEOWNERS file exists
OK     HYGIENE-fastify-override         fastify pinned to 5.8.5
OK     HYGIENE-osv-config               OSV waivers present
OK     HYGIENE-trufflehog-push-guard    TruffleHog pull_request guard found
======================================================================

25 passed, 0 failed, 0 blocked, 25 total
```

**Exit code: 0.**

This is a flip from the M3.A0 entry state (`23 passed / 0 failed / 2 blocked` on main `219c1a6`, exit 1) to the M3.A0 exit state (`25 passed / 0 failed / 0 blocked`, exit 0).

---

## 2. What M3.A0 closed

### 2.1 PRIOR-R1-003 — TypeScript project references

Delivered via T01 + T05 + T01b + T02 + T03 + T03b + T04:

- `composite: true` on all 6 package tsconfigs + all 3 app tsconfigs (T01, T03b)
- Source-alias `paths` block removed from `tsconfig.base.json` (T02)
- `references[]` declared on every consuming tsconfig (5 packages + 3 apps) (T03)
- `tsconfig.solution.json` at repo root — the "solution file" for `tsc -b` that walks the full 9-project graph (T03)
- `build:types` script in root `package.json` runs `tsc -b tsconfig.solution.json` (T04)
- Build pipeline migrated from `tsup --dts` to `tsup` + `tsc -b` for declaration emission (T01b) — tsup's `--dts` spawns an isolated tsc compile that fails under composite mode (TS6307 "file not listed within project"). See T01b commit message for full rationale.
- Exports condition order corrected to `types`-first across all 6 packages so TypeScript resolves declaration files before falling through to `import`/`require` conditions (T05 — moved ahead of T02 because composite-based tsc was found empirically to depend on it).

### 2.2 PRIOR-R4-003 — exports `types` condition first

Delivered via T05 (6 package.json edits). The finding was marked "independent of R1-003" in the plan, but M3.A0 execution showed it's actually a prerequisite for composite's cross-package type resolution — so it ran ahead of T02/T03/T04 in commit order.

### 2.3 Issue #16

Both blockers tracked in issue #16 (PRIOR-R1-003 composite refs + PRIOR-R4-003 exports types-first) are mechanically closed per §1 verify output. PR body will declare `Closes #16` so the issue auto-closes on merge.

### 2.4 Dormant-gate inventory (T06)

Complete `_plan/M3_A0_GATE_INVENTORY.md` covering every (job, trigger) pair in `.github/workflows/ci.yml`:

- 32 pairs classified
- 16 verified-green (push-to-main + pull_request-to-main; all 8 jobs each)
- 16 never-run (both develop variants — see §3.1)
- 1 verified-skipped step (TruffleHog on push-to-main, by design per PR #14)

No "never-run gate that cannot be resolved" was uncovered (the T06 stop-and-report trigger did not fire).

---

## 3. Findings surfaced during M3.A0 that changed M3 scope

### 3.1 Non-existent `develop` branch referenced in CI workflow

- 16 of the 32 (job × trigger) pairs in T06's inventory are Never-run — all 16 trace to `.github/workflows/ci.yml` declaring `develop` as a valid push/PR target while the `develop` branch does not exist on `origin` (verified via `git ls-remote --heads origin develop` — empty).
- The misconfiguration predates this M3.A0 session's work. It has been silently dead since `main` became the single integration branch. No CI run has fired for either develop trigger since repo inception.
- Resolution tracked in **issue #19** (labels: m3, m3.a0-followup; milestone: M3). Two paths named: adopt a `develop` branch and exercise the gates, or remove `develop` from the workflow triggers (smaller-diff option).
- **Possible M3.A10 cleanup:** a `grep -r 'develop' .` sweep to catch any scripts, docs, or runbooks that carry the same assumption. Not scoped into M3.A10 formally yet — called out here so M3.A10 planning picks it up.
- **Lesson for `verify-m3-findings.mjs` (M3.A10-T04):** add a check that flags any workflow `on:` clause referencing a branch that doesn't exist on `origin`. Would have caught this class of bug in M3.0's exit audit, not in M3.A0's inventory. Keep the pattern out of future milestones.

### 3.2 Plan's T05 ordering was wrong — T05 is a prerequisite for T02

Plan v1.0 §5 labeled `M3.A0-T05` (exports `types`-first) as `Dec dependencies: none (independent of R1-003 work)`. Execution showed T05 must run **before** T02 because tsc's composite-based cross-package type resolution resolves `@sep/common` via the `exports` conditions — with `types` in the wrong position, consumers get `TS7016 (Could not find a declaration file)` at build time.

Captured: T05 commit (`80565a1`) explicitly documents the out-of-order placement; T01b commit message cross-references it.

### 3.3 tsup `--dts` is incompatible with `composite: true`

This surfaced at the T01→T02 boundary. Tsup's `--dts` flag spawns an ephemeral tsc invocation that passes only the entry file rather than honoring the full `include` pattern. Under composite, every imported file must be explicitly listed (TS6307). Before the commit, each package was using `tsup src/index.ts --format cjs --dts --clean` — incompatible.

Resolved in T01b (commit `920586d`): remove `--dts` from tsup, add `&& tsc -b` to each package's build script, add `emitDeclarationOnly: true` + `tsBuildInfoFile: ./dist/.tsbuildinfo` to each package's tsconfig. Full rationale in the T01b commit message.

This wasn't part of the plan's task list — added as a within-scope follow-up to T01 (same shape as T03b is a follow-up to T03).

### 3.4 Node.js 20 deprecation warnings on CI runner

Not strictly a scope change — surfaced during T06 but doesn't alter the M3 task list. See `_plan/M3_A0_GATE_INVENTORY.md` §5.1 for the full entry (deadline, tracking via Dependabot, flag for M3.5 planning).

---

## 4. Empirical finding — `composite: true` works on Next.js apps

**Conventional wisdom:** Next.js apps can't be composite-mode TypeScript projects.

**T03b finding:** `composite: true` works fine on `apps/operator-console` alongside `noEmit: true`, `moduleResolution: "bundler"`, and the Next.js plugin entry. It also works on NestJS apps (`apps/control-plane`, `apps/data-plane`) alongside `nest build` and `tsc --noEmit` typecheck.

**Reason:** `next build` ignores most tsconfig `compilerOptions` — it uses swc for compilation and reads tsconfig only for type-check + path mapping. `composite: true` is a TypeScript project-references concern that affects `tsc -b` specifically; it doesn't affect Next.js' own build pipeline. On NestJS, `nest build` similarly honors the tsconfig for type-check only, and composite is transparent.

**Verified:** T03b commit (`fdfa3fa`) added composite to all 3 apps. Full local gate battery (build, typecheck, lint, format:check, test:unit) passed; `tsc -b tsconfig.solution.json` builds the full 9-project graph in topological order; `pnpm --filter @sep/control-plane run build` (`nest build`) and `pnpm --filter @sep/operator-console run typecheck` (Next.js `tsc --noEmit`) both exit 0.

**For future contributors:** do not re-litigate this. The pattern in `fdfa3fa` is correct. If `next build` behavior changes in a future major (Next 16+), re-evaluate; otherwise leave it.

### 4.2 Why a separate `tsconfig.solution.json` rather than making root tsconfig the solution file

Root `tsconfig.json` is referenced by ESLint's `parserOptions.project` setting (see `.eslintrc.base.js`), which requires a tsconfig with `include` patterns covering the files ESLint needs to type-check. A solution-file tsconfig has no `include` (by design — it only contains `references[]`), so using root as the solution file would break ESLint's type-aware rules across the repo.

Resolution: root tsconfig stays unchanged (with `include` for ESLint), and `tsconfig.solution.json` lives alongside it as the dedicated `tsc -b` entry point. The `build:types` script in root `package.json` runs `tsc -b tsconfig.solution.json` explicitly.

---

## 5. Deviations from plan v1.0 §5

| Deviation                                                  | Justification                                                                                                 | Where documented                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| T05 moved ahead of T02 (plan marked T05 "independent")     | T05 is a prerequisite for T02/T03/T04 under composite-based resolution (§3.2)                                 | T05 commit (`80565a1`) + this handoff §3.2  |
| Added T01b commit (build-pipeline fix)                     | tsup `--dts` incompatible with composite; needed to unblock T01→T02 (§3.3)                                    | T01b commit (`920586d`) + this handoff §3.3 |
| Added T03b commit (apps composite)                         | T01 prompt said "apps get composite in T03"; T03 delivered references, T03b delivers composite in follow-up   | T03b commit (`fdfa3fa`)                     |
| `tsc -b` invoked via `build:types` script rather than bare | Root `tsconfig.json` is used by eslint `parserOptions.project` and needs `include`; can't be a solution file  | T04 commit (`f4787f1`) + §4 of this handoff |
| Filed issue #19 during T06 (not in plan's T06 acceptance)  | Never-run entries all trace to non-existent develop branch; trigger isn't practical without repo state change | T06 commit (`6ce4dd1`) + this handoff §3.1  |

Net commit count: **9** instead of plan's **7** (T01, T05-moved, T01b-added, T02, T03, T03b-added, T04, T06, T07). The split matches the T01→T01b pattern used transparently in prior work.

---

## 6. Commit history on `m3.a0/pre-m3-housekeeping`

| #   | SHA       | Task | Title                                                            |
| --- | --------- | ---- | ---------------------------------------------------------------- |
| 1   | `0123038` | T01  | add composite:true to package tsconfigs (PRIOR-R1-003 part 1)    |
| 2   | `80565a1` | T05  | reorder exports to put types first (PRIOR-R4-003)                |
| 3   | `920586d` | T01b | switch dts emission from tsup --dts to tsc -b (composite compat) |
| 4   | `04a15b6` | T02  | remove cross-package source aliases (PRIOR-R1-003 part 2)        |
| 5   | `f1091e3` | T03  | add references arrays + solution tsconfig (PRIOR-R1-003 part 3)  |
| 6   | `fdfa3fa` | T03b | add composite:true to app tsconfigs (PRIOR-R1-003 part 3b)       |
| 7   | `f4787f1` | T04  | confirm tsc -b works from root (PRIOR-R1-003 part 4)             |
| 8   | `6ce4dd1` | T06  | dormant-gate inventory across all CI triggers                    |
| 9   | `78d4bf8` | T07  | handoff note — M3.A0 complete, M3 execution cleared to start     |

---

## 7. User action items

### 7.1 Branch-protection required checks on `main` — DEFERRED

**Status:** Deferred; no action taken in M3.A0.

The M3.A0 execution prompt framed this as a merge-blocker. User decision on 2026-04-18: defer branch-protection setup. Rationale:

- Repo is private on GitHub Free plan; protected branches are a paid feature (Pro or higher).
- Solo contributor with demonstrated gate-honoring discipline means branch protection would be belt-on-belt over the practical discipline already in place.
- CI runs on every push and PR regardless of branch protection state — gates still execute; only the "must pass before merge" enforcement layer is absent.

**Trigger to revisit:** if a second contributor joins the repo (whether employee, contractor, or advisor with write access), branch protection becomes meaningful and should be enabled alongside a GitHub plan that supports it. This is tied to §10.1 option (ii) → option (i) transition — if we flip to a real second reviewer, branch protection should flip from deferred to enabled in the same change.

**Known risk:** without branch protection, an errant merge (e.g., clicking "merge anyway" past a CI warning) is mechanically possible. Discipline is the compensating control; this is acceptable for solo development but explicitly noted here for future context.

The M3.A0 gate inventory document (§6) recorded the recommendation that all 8 CI jobs should be required checks if branch protection is ever enabled. That recommendation stands; it's just not applicable while protection is deferred.

### 7.2 Follow-up issues tracking (no immediate action required)

- **#16** — M3.A0 blockers (closes when M3.A0 PR merges)
- **#18** — Pre-push lefthook doesn't run format:check; CI does. Address early in M3 (one-line `lefthook.yml` addition).
- **#19** — CI workflow triggers reference `develop` branch but branch doesn't exist. Address during M3 execution.

---

## 8. Green-light statement

**M3.A1 through M3.A10 can begin.**

`_plan/scripts/verify-m3-0-findings.mjs` exits 0. All M3.A0 exit criteria from plan v1.0 §5 are met:

- [x] `verify-m3-0-findings.mjs` exits 0 (25 passed, 0 failed, 0 blocked)
- [x] `_plan/M3_A0_GATE_INVENTORY.md` committed with every (job, trigger) pair classified
- [x] `_plan/M3_A0_HANDOFF.md` committed (this file)
- [ ] Main CI green on push-to-main after final M3.A0 commit — verifies when PR merges and the push-to-main run completes

Execution of M3.A1 (Database tenant isolation via RLS) may begin after this PR merges and main CI confirms green.

---

## 9. Evidence bundle

- Branch: `m3.a0/pre-m3-housekeeping` (9 commits)
- PR: to be opened after this commit; will be filled in on the PR itself
- Issue #16: M3.A0 blockers (closes on merge)
- Issue #18: format:check lefthook gap (follow-up)
- Issue #19: develop-branch triggers (follow-up, filed during T06)
- Gate inventory: `_plan/M3_A0_GATE_INVENTORY.md`
- Verify script: `_plan/scripts/verify-m3-0-findings.mjs` — 25/0/0 exit 0

---

**End of handoff note.**
