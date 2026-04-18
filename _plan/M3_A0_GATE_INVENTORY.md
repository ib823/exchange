# M3.A0-T06 — Dormant-gate inventory

**Produced:** 2026-04-18
**Scope:** Every (job, trigger) pair declared under `.github/workflows/*.yml`, classified by whether it has actually run and exited green.
**Source-of-truth:** `gh run list --workflow=ci.yml --event=<event> --limit=20`, cross-referenced with job- and step-level `.jobs[]` output.

---

## 1. Workflows in scope

Single workflow: `.github/workflows/ci.yml`.

Triggers declared:

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
```

Jobs declared (8):

1. `install` — "Install dependencies"
2. `lint` — "Lint" (includes `pnpm lint` + `pnpm format:check`)
3. `typecheck` — "Type check"
4. `unit-tests` — "Unit tests"
5. `build` — "Build"
6. `contract-tests` — "Contract tests"
7. `integration-tests` — "Integration tests"
8. `security` — "Security scan" (osv-scanner + TruffleHog)

No `workflow_dispatch`, `schedule`, or `workflow_call` triggers are defined.

**Product space:** 8 jobs × 4 trigger variants (push-to-main, push-to-develop, pull_request-to-main, pull_request-to-develop) = **32 (job, trigger) pairs** to classify.

---

## 2. Confidence classification

Per the M3.A0-T06 prompt:

- **Verified-green** — job has run on this trigger and exited green at least once in the last 30 days.
- **Verified-skipped** — job (or a named step within it) is intentionally skipped on this trigger; the reason is documented.
- **Never-run** — no record of this job having run on this trigger.

---

## 3. Summary tables

### 3.1 `push` to `main` — reference run `24594093528` (SHA `e8ef9e8`, 2026-04-18T01:44Z)

All 8 jobs verified-green on the merge commit of PR #17.

| Job                  | Confidence     | Last-green run | Notes                                                                     |
| -------------------- | -------------- | -------------- | ------------------------------------------------------------------------- |
| Install dependencies | Verified-green | 24594093528    | —                                                                         |
| Lint                 | Verified-green | 24594093528    | Covers `pnpm lint` + `pnpm format:check`                                  |
| Type check           | Verified-green | 24594093528    | —                                                                         |
| Unit tests           | Verified-green | 24594093528    | —                                                                         |
| Build                | Verified-green | 24594093528    | —                                                                         |
| Contract tests       | Verified-green | 24594093528    | —                                                                         |
| Integration tests    | Verified-green | 24594093528    | Uses Postgres + Redis service containers                                  |
| Security scan        | Verified-green | 24594093528    | osv-scanner step: success. TruffleHog step: verified-skipped (see §3.1.1) |

#### 3.1.1 Security-scan step-level (push-to-main)

| Step                         | Conclusion       | Reason                                                                                                                                                        |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| osv-scanner                  | success          | Dependency-advisory scan against pinned `.osv-scanner.toml` waivers; runs on every push (see ADR-0006 + hygiene PR #11).                                      |
| Secret scanning (TruffleHog) | Verified-skipped | Step-level `if: github.event_name == 'pull_request'` guard added in hygiene PR #14 — TruffleHog diff mode fails when base=HEAD (always true on push-to-main). |

### 3.2 `pull_request` to `main` — reference run `24593840250` (SHA `e68d13a`, 2026-04-18T01:30Z)

All 8 jobs verified-green on the last commit of PR #17.

| Job                  | Confidence     | Last-green run | Notes                                                                 |
| -------------------- | -------------- | -------------- | --------------------------------------------------------------------- |
| Install dependencies | Verified-green | 24593840250    | —                                                                     |
| Lint                 | Verified-green | 24593840250    | —                                                                     |
| Type check           | Verified-green | 24593840250    | —                                                                     |
| Unit tests           | Verified-green | 24593840250    | —                                                                     |
| Build                | Verified-green | 24593840250    | —                                                                     |
| Contract tests       | Verified-green | 24593840250    | —                                                                     |
| Integration tests    | Verified-green | 24593840250    | —                                                                     |
| Security scan        | Verified-green | 24593840250    | osv-scanner + TruffleHog both succeed on PR (full-scan coverage path) |

### 3.3 `push` to `develop` — all 8 jobs Never-run

See §4 resolution.

| Job        | Confidence | Notes                                                          |
| ---------- | ---------- | -------------------------------------------------------------- |
| All 8 jobs | Never-run  | `develop` branch does not exist on `origin` — trigger dormant. |

### 3.4 `pull_request` to `develop` — all 8 jobs Never-run

See §4 resolution.

| Job        | Confidence | Notes                                                                            |
| ---------- | ---------- | -------------------------------------------------------------------------------- |
| All 8 jobs | Never-run  | No PR has ever targeted `develop` (base branch doesn't exist) — trigger dormant. |

---

## 4. Resolution for Never-run entries

All 16 Never-run entries share one root cause: `ci.yml` declares `develop` as a valid push/PR target, but `develop` does not exist as a branch on `origin`. No CI run has fired for either trigger variant since the repo was created.

Triggering a run is not practical in M3.A0 scope — it would require creating a `develop` branch, which is a repo-state change outside T06's mandate and outside the M3 execution plan's in-scope list (§1.1).

**Resolution:** filed **issue #19** (`labels: m3, m3.a0-followup`; `milestone: M3`) proposing two paths:

1. Adopt a `develop` branch (git flow or release-train style) and exercise the gates via a minimal push; update CONTRIBUTING / CLAUDE.md to name when develop is used.
2. Remove `develop` from the workflow triggers — aligns CI with the actual single-branch flow the repo has used since inception (smallest-diff option).

Either choice is acceptable; the decision belongs to M3 execution, ideally alongside branch-protection review (see §6).

---

## 5. Known future actions

### 5.1 Node.js 20 deprecation (GitHub Actions runner)

**Surfaced:** main CI run `24594093528` (2026-04-18) added an annotation on every Node-using step:

> Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`, `pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d`.
>
> Actions will be forced to run with Node.js 24 by default starting **June 2nd, 2026**. Node.js 20 will be removed from the runner on **September 16th, 2026**.

**Why not closed in M3:** ADR-0005 deferred undici 8 (and by extension Node 22+) for exactly this class of reason — the ecosystem hadn't stabilized at M3 start. Node 20 → Node 22+ migration is out-of-scope for M3 and M3.5.

**Timeline risk:** June 2026 forces the change if we haven't made it voluntarily. Our M3 close target is well before that; M3.5 + M4 + M5 execution spans it.

**Tracking:** Dependabot is already catching GitHub Actions version bumps — 5 open Dependabot branches observed on origin (checkout, setup-node, upload-artifact, download-artifact, pnpm/action-setup, trufflehog). These upgrades will transparently bring Node 24 support as they merge. No issue filed — Dependabot's auto-bumps are the tracking mechanism. Flag for M3.5 planning to explicitly decide: auto-merge cadence for Dependabot PRs, or a single coordinated bump.

### 5.2 `format:check` not in lefthook pre-push

**Already tracked:** issue #18 (surfaced by PR #17). Fix should land in the first M3.A0-aligned session after T07 handoff is accepted (single-line addition to `lefthook.yml` plus dev re-install).

---

## 6. Recommendation on branch-protection required checks

**Current state:** `gh api repos/:owner/:repo/branches/main/protection` returns 403 (the current token lacks admin scope). Current branch-protection settings cannot be programmatically inspected from this session. Recommendations below are based on job criticality, not diff against current rules.

### 6.1 Gates that SHOULD be required on `main`

Based on the M3 plan's security posture (CLAUDE.md §0 priority order: security, correctness, deterministic/auditable, explicit config, observability, ergonomics, speed), the following CI jobs should block merges to `main`:

| Job                  | Should-be-required | Reasoning                                                                                             |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Install dependencies | Yes                | Other jobs depend on it; a broken install masks all downstream signal.                                |
| Lint                 | Yes                | Includes `format:check`; catches prettier drift that CI PR-checks have already caught twice (PR #17). |
| Type check           | Yes                | First line of defense against regressions; cheap (~45s).                                              |
| Unit tests           | Yes                | Required for any code change; cheap (~50s).                                                           |
| Build                | Yes                | Sanity check that the TS + bundler pipeline produces distributable artefacts.                         |
| Contract tests       | Yes                | Consumer-driven contracts must not silently drift.                                                    |
| Integration tests    | Yes                | Real Postgres + Redis under testcontainers; catches what unit tests cannot.                           |
| Security scan        | Yes                | osv-scanner runs on every push; TruffleHog runs on PR — both must pass.                               |

**All 8 jobs should be required.** Rationale: the repo is a security-sensitive enterprise platform (per CLAUDE.md §0) — no job is optional.

### 6.2 Action for M3.A0

M3.A0 scope does **not** include modifying branch-protection rules (admin action; requires GitHub UI access or a token with `admin:repo` scope that this session doesn't have). Recommendation:

- **Action item for user (post-T07):** manually verify current branch-protection rules on `main` and add any missing required checks from §6.1.
- If the required-checks list is already complete: no follow-up issue needed.
- If any of §6.1 is missing: M3 execution can file a follow-up when the gap is named.

### 6.3 Dependabot on GitHub Actions

Dependabot is currently opening PRs for GitHub Actions SHA bumps (5 open at time of inventory). These PRs run the full CI matrix, so their gate-fidelity is covered by §3.2. No additional gate required; existing CI covers them.

---

## 7. Summary of findings

| Category                              | Count   | Resolution                                                     |
| ------------------------------------- | ------- | -------------------------------------------------------------- |
| Verified-green (job, trigger) pairs   | 16      | No action needed.                                              |
| Verified-skipped steps                | 1       | TruffleHog on push — documented as by-design (hygiene PR #14). |
| Never-run (job, trigger) pairs        | 16      | Covered by issue #19; resolved during M3.                      |
| Known future actions                  | 2       | Node 20 deprecation (Dependabot tracks); issue #18 (lefthook). |
| New follow-up issues filed during T06 | 1       | Issue #19 (develop-branch triggers).                           |
| Branch-protection gaps                | Unknown | User to verify manually; see §6.2.                             |

**No "never-run gate that cannot be resolved either way" was uncovered** (the T06 stop-and-report trigger per the session prompt).

---

## 8. Evidence

- Reference push run: https://github.com/ib823/exchange/actions/runs/24594093528
- Reference PR run: https://github.com/ib823/exchange/actions/runs/24593840250
- Step-level breakdown queried via: `gh run view <id> --json jobs --jq '.jobs[] | select(.name=="...") | .steps[] | "\(.conclusion)  \(.name)"'`
- Develop branch check: `git ls-remote --heads origin develop` returns empty.
- Branch protection: inaccessible with current token (403).
- Follow-up issue: https://github.com/ib823/exchange/issues/19
- Existing relevant issue: https://github.com/ib823/exchange/issues/18

---

**End of inventory.**
