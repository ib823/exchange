# Malaysia Secure Exchange Platform

Hostile audit report  
Date: 2026-04-16  
Milestone audited: M2 — Data Plane and Transport Baseline (post-M2 remediation boundary)

## Context

- Platform: Malaysia Secure Exchange Platform (SEP)
- Repository: `/workspaces/exchange`
- Repository state at audit time: clean working tree except untracked `audit/`
- Branch: `main`
- Prior findings source: `PLANS.md` accepted-risk register and milestone tracker

## Wave 1

### R1 — Principal Platform & Build Engineer

Executive summary: The build is functional and `pnpm`/Turbo workflows execute, but the CI trust boundary is not hardened enough for a regulated release. Overall verdict: `FAIL`.

#### Findings

**FINDING-R1-001**

- Severity: `HIGH`
- Category: `CI/CD Security`
- Location: `.github/workflows/ci.yml`
- Evidence: workflow steps use mutable tags such as `actions/checkout@v4`, `pnpm/action-setup@v3`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`
- Risk: upstream action retagging or compromise can change build behavior without a repository diff
- Standard Violated: GitHub Actions security hardening guide; OpenSSF Scorecard pinned-actions check
- Remediation: pin every `uses:` reference to a full commit SHA
- Validation: grep workflow `uses:` lines and confirm every one ends in a 40-char SHA
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R1-002**

- Severity: `HIGH`
- Category: `Artifact Integrity`
- Location: `.github/workflows/ci.yml`
- Evidence: artifacts are uploaded and consumed across jobs without checksum, signature, provenance, or image scan verification
- Risk: downstream jobs trust unverified artifacts
- Standard Violated: SLSA Framework Levels 1-3; NIST SSDF SP 800-218; CIS Docker Benchmark v1.6
- Remediation: generate checksums or signatures for build outputs, verify them before consumption, and add image vulnerability gates
- Validation: CI fails on checksum mismatch and CRITICAL image findings
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R1-003**

- Severity: `MEDIUM`
- Category: `Monorepo Build Isolation`
- Location: `tsconfig.base.json`, workspace `tsconfig.json` files, vitest configs
- Evidence: root path aliases point directly to sibling package `src/`; package tsconfigs have no `references` and no `composite: true`
- Risk: package boundaries are porous and incremental correctness is not guaranteed
- Standard Violated: TypeScript Handbook — Project References; Turborepo documentation — Caching and pipeline configuration
- Remediation: add project references with `composite: true` and consume declared package outputs only
- Validation: `tsc -b` succeeds and no app resolves another package `src/` directly
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R1-004**

- Severity: `MEDIUM`
- Category: `Secrets and Developer Workflow`
- Location: `.env.example`, `docker-compose.yml`, repository root
- Evidence: example configs and compose use fixed dev credentials; repository lacks `.dockerignore`, Husky or equivalent hooks, and dead-code tooling
- Risk: copy-forward of defaults into higher environments remains plausible and local workflow gates are weaker than CI
- Standard Violated: NIST SSDF SP 800-218; CIS Docker Benchmark v1.6; OpenSSF Scorecard
- Remediation: replace sample secrets with unmistakably unusable placeholders, add `.dockerignore`, and enforce local hooks
- Validation: repo contains `.dockerignore`, hook config, and no example file ships runnable credentials
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- Monorepo and workspace structure: `FINDING-R1-003`
- CI/CD pipeline design: `FINDING-R1-001`, `FINDING-R1-002`
- Secrets and environment management: `FINDING-R1-004`
- Docker and container security: `FINDING-R1-002`, `FINDING-R1-004`
- Developer workflow and code quality gates: `FINDING-R1-004`

#### BUILD HEALTH SUMMARY

| Dimension          | Critical | High | Medium | Low | Verdict          |
| ------------------ | -------: | ---: | -----: | --: | ---------------- |
| Monorepo/workspace |        0 |    0 |      1 |   0 | Conditional Pass |
| CI/CD pipeline     |        0 |    2 |      0 |   0 | Fail             |
| Secrets/env        |        0 |    0 |      1 |   0 | Conditional Pass |
| Docker/container   |        0 |    1 |      1 |   0 | Fail             |
| Developer workflow |        0 |    0 |      1 |   0 | Conditional Pass |

#### Finding summary by severity

`CRITICAL: 0  HIGH: 2  MEDIUM: 2  LOW: 0  INFO: 0  Total: 4`

#### Verdict and milestone gate recommendation

`FAIL`

### R2 — Principal Database Architect & Data Integrity Specialist

Executive summary: Schema breadth is solid for M2, but tenant isolation is still application-only and audit durability is not transactionally coupled to state change. Overall verdict: `FAIL`.

#### Findings

**FINDING-R2-001**

- Severity: `CRITICAL`
- Category: `Row-Level Security`
- Location: `packages/db/prisma/schema.prisma`, `packages/db/src/database.service.ts`, Prisma migrations
- Evidence: only `audit_events` and `crypto_operation_records` have RLS; `DatabaseService.forTenant()` still returns raw Prisma client and documents future `SET LOCAL app.current_tenant_id`
- Risk: any missed `tenantId` predicate can expose cross-tenant data
- Standard Violated: PostgreSQL documentation — Row Security Policies; BNM RMiT November 2025; PCI DSS v4.0
- Remediation: enable and force RLS on every tenant-scoped table and bind policies to `current_setting('app.current_tenant_id')`
- Validation: all tenant-scoped tables have explicit `SELECT/INSERT/UPDATE/DELETE` policies and cross-tenant negative tests fail under `sep_app`
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R2-002**

- Severity: `HIGH`
- Category: `Audit Trail Integrity`
- Location: `apps/control-plane/src/modules/audit/audit.service.ts`, `apps/data-plane/src/services/audit-writer.service.ts`, state-changing services
- Evidence: state changes and audit writes are separate operations with no service-level transaction wrapping both
- Risk: partial failure can commit state without audit evidence
- Standard Violated: PCI DSS v4.0 Requirement 10; BNM RMiT November 2025; Prisma documentation — Transactions
- Remediation: wrap state change and audit append in a single Prisma transaction
- Validation: injected failure confirms neither state nor audit commits alone
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R2-003**

- Severity: `MEDIUM`
- Category: `Timestamp Authority and Update Discipline`
- Location: audit services, `schema.prisma`, initial migration SQL
- Evidence: audit services set application timestamps with `new Date()`; mutable tables rely on ORM `@updatedAt` without DB triggers
- Risk: timestamp authority depends on app clocks and ORM write paths
- Standard Violated: PCI DSS v4.0 Requirement 10; BNM RMiT November 2025; CIS PostgreSQL Benchmark
- Remediation: move audit timestamp authority to DB `now()` and add a shared `set_updated_at()` trigger
- Validation: direct SQL update changes `updatedAt`; audit inserts use DB server time
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R2-004**

- Severity: `MEDIUM`
- Category: `Retention Enforcement`
- Location: `packages/db/prisma/schema.prisma`, `packages/db/prisma/seed.ts`, `PLANS.md`
- Evidence: retention policy entities exist, but there is no DB purge, archival, erasure, or enforcement mechanism
- Risk: retention becomes advisory only
- Standard Violated: PDPA 2010; BNM RMiT November 2025; PCI DSS v4.0 Requirement 3
- Remediation: implement DB-backed archival/purge paths that consume active retention policy
- Validation: old fixture data is archived or purged by automated policy enforcement
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- Schema integrity and relational design: `FINDING-R2-003`
- Row-level security (RLS): `FINDING-R2-001`
- Audit trail and tamper resistance: `FINDING-R2-002`, `FINDING-R2-003`
- Index strategy and performance: No findings in this dimension at current milestone scope.
- Data retention and PDPA compliance: `FINDING-R2-004`
- Prisma ORM usage discipline: No findings in this dimension at current milestone scope.

#### SCHEMA INTEGRITY SCORECARD

| Entity                   | RLS status | FK completeness | Audit trail status            | Retention status              |
| ------------------------ | ---------- | --------------- | ----------------------------- | ----------------------------- |
| tenants                  | Missing    | Complete        | N/A                           | Policy reference only         |
| users                    | Missing    | Complete        | Via audit service, non-atomic | No DB enforcement             |
| submissions              | Missing    | Complete        | State and audit split         | No DB enforcement             |
| audit_events             | Present    | Complete        | Append-only with hash chain   | Retained, not policy-enforced |
| crypto_operation_records | Present    | Complete        | Immutable                     | Retained, not policy-enforced |

#### Finding summary by severity

`CRITICAL: 1  HIGH: 1  MEDIUM: 2  LOW: 0  INFO: 0  Total: 4`

#### Verdict and milestone gate recommendation

`FAIL`

### R5 — Principal Supply Chain Security Engineer

Executive summary: dependency installation is deterministic via lockfile, but dependency governance is still weak and the declared vulnerability gate is currently broken. Overall verdict: `FAIL`.

#### Findings

**FINDING-R5-001**

- Severity: `HIGH`
- Category: `Dependency Pinning`
- Location: root and workspace `package.json` files
- Evidence: production and dev dependencies broadly use caret ranges
- Risk: future installs can drift to different dependency trees from the reviewed source state
- Standard Violated: NIST SSDF SP 800-218; SLSA Framework; pnpm documentation — frozen-lockfile enforcement
- Remediation: exact-pin production and security-sensitive dependencies
- Validation: production dependencies use exact versions
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R5-002**

- Severity: `HIGH`
- Category: `Vulnerability Scanning`
- Location: `.github/workflows/ci.yml`
- Evidence: `pnpm audit --audit-level=high` returned `ERR_PNPM_AUDIT_BAD_RESPONSE` with HTTP `410`
- Risk: the repository advertises a vulnerability gate that currently does not provide usable coverage
- Standard Violated: NIST SSDF SP 800-218; OpenSSF Scorecard
- Remediation: replace with a supported SCA path
- Validation: CI security job returns actionable results and fails on seeded vulnerable packages
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R5-003**

- Severity: `HIGH`
- Category: `SBOM and Provenance`
- Location: repository root, `.github/workflows/ci.yml`, compose manifests
- Evidence: no SBOM, no provenance attestation, no signing, and mutable image tags like `latest`
- Risk: dependency exposure cannot be enumerated or attested for auditors
- Standard Violated: SLSA Framework; NIST SSDF SP 800-218; OpenSSF Scorecard; CIS Docker Benchmark v1.6
- Remediation: generate SBOMs in CI, attest builds, sign release artifacts, and digest-pin images
- Validation: SBOM, provenance, signature verification, and digest-pinned images appear in CI
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- Direct dependency risk: `FINDING-R5-001`
- Transitive dependency risk: `FINDING-R5-002`
- GitHub Actions and pipeline dependency risk: `FINDING-R5-003`
- Container/base image supply chain: `FINDING-R5-003`
- Secret scanning and external scripts: No findings in this dimension at current milestone scope.

#### DEPENDENCY RISK REGISTER

| Area                    | Status        | Evidence                          |
| ----------------------- | ------------- | --------------------------------- |
| Exact pinning           | Not satisfied | Caret ranges throughout workspace |
| Vulnerability gate      | Not satisfied | `pnpm audit` returns HTTP 410     |
| SBOM/provenance/signing | Not satisfied | No implementation found           |

#### Finding summary by severity

`CRITICAL: 0  HIGH: 3  MEDIUM: 0  LOW: 0  INFO: 0  Total: 3`

#### Verdict and milestone gate recommendation

`FAIL`

**WAVE 1 COMPLETE**

## Wave 2

### R3 — Application Security / PenTest

Executive summary: the main application controls are thoughtful, but the platform still relies on correct application predicates rather than structural tenant isolation. Overall verdict: `FAIL`.

#### Findings

**FINDING-R3-001**

- Severity: `CRITICAL`
- Category: `Tenant Isolation / BOLA`
- Location: `apps/control-plane/src/common/guards/tenant.guard.ts`, `packages/db/src/database.service.ts`
- Evidence: object-level routes proceed without path/body tenant ID and rely on service-layer ownership checks; `forTenant()` returns raw Prisma client
- Risk: one missed ownership assertion becomes a cross-tenant data exposure path
- Standard Violated: OWASP API1:2023 Broken Object Level Authorization; OWASP API3:2023 Broken Object Property Level Authorization; PostgreSQL Row Security Policies
- Remediation: enforce DB-backed tenant isolation with RLS and mandatory tenant-scoped access helpers
- Validation: cross-tenant reads and updates fail even when application filters are intentionally omitted
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R3-002**

- Severity: `HIGH`
- Category: `Authentication Lifecycle`
- Location: auth service and JWT guard
- Evidence: no refresh-token rotation flow, MFA, lockout, revocation list, or session management; JWT uses shared HS256 secret
- Risk: credential theft has a wider blast radius than necessary
- Standard Violated: OWASP API2:2023 Broken Authentication; BNM RMiT November 2025
- Remediation: add MFA, refresh-token rotation, revocation, lockout, and key rotation strategy
- Validation: tests cover refresh replay, lockout, MFA-required paths, and token revocation
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R3-003**

- Severity: `MEDIUM`
- Category: `Input Validation`
- Location: `apps/control-plane/src/modules/partner-profiles/partner-profiles.controller.ts`
- Evidence: transition endpoint extracts `targetStatus` through a direct cast instead of schema parsing
- Risk: a security-relevant transition path bypasses the shared validation model
- Standard Violated: OWASP API8:2023 Security Misconfiguration; NIST SSDF SP 800-218
- Remediation: define and enforce a schema for transition requests
- Validation: malformed `targetStatus` payloads fail before service code executes
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- Authentication and session management: `FINDING-R3-002`
- Tenant isolation and authorization: `FINDING-R3-001`
- Input validation and injection: `FINDING-R3-003`
- SSRF / outbound request hardening: No findings in this dimension at current milestone scope.
- File intake security: No findings in this dimension at current milestone scope.

#### APPLICATION SECURITY MATRIX

| Control area             | Status                               |
| ------------------------ | ------------------------------------ |
| Tenant isolation         | Not satisfied structurally           |
| Authentication lifecycle | Partially satisfied                  |
| Input validation         | Partially satisfied                  |
| SSRF controls            | Satisfied at current milestone scope |
| File intake controls     | Satisfied at current milestone scope |

#### Finding summary by severity

`CRITICAL: 1  HIGH: 1  MEDIUM: 1  LOW: 0  INFO: 0  Total: 3`

#### Verdict and milestone gate recommendation

`FAIL`

### R4 — TypeScript & Code Quality

Executive summary: strict mode and linting are active, and the workspace passes typecheck, but several runtime paths still bypass the typed error and validation model. Overall verdict: `CONDITIONAL PASS`, but not gate-clearing.

#### Findings

**FINDING-R4-001**

- Severity: `MEDIUM`
- Category: `Error Handling`
- Location: `packages/db/src/database.service.ts`, `packages/common/src/config/config.ts`
- Evidence: runtime code throws plain `Error`
- Risk: bootstrap and pre-filter failures bypass the shared typed error taxonomy
- Standard Violated: TypeScript Handbook; NIST SSDF SP 800-218
- Remediation: replace raw `Error` throws with typed platform errors
- Validation: runtime source contains no unapproved raw `Error` throws
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R4-002**

- Severity: `MEDIUM`
- Category: `Unsafe Assertions`
- Location: multiple runtime files including partner-profile transition and data-plane processors
- Evidence: runtime code uses assertion-heavy patterns like `body as { targetStatus: string }` and `as unknown as`
- Risk: type safety becomes advisory in security-relevant control paths
- Standard Violated: TypeScript Handbook; NIST SSDF SP 800-218
- Remediation: replace assertions with parsers and narrowing helpers
- Validation: runtime `as unknown as` patterns are removed from application code
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R4-003**

- Severity: `LOW`
- Category: `Package Metadata Quality`
- Location: internal package `package.json` files
- Evidence: builds warn that export condition `"types"` will never be used because it comes after `"import"` and `"require"`
- Risk: type resolution can be brittle across toolchains
- Standard Violated: TypeScript Handbook package/export resolution guidance
- Remediation: reorder export conditions
- Validation: build completes without export warnings
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- Type safety: `FINDING-R4-002`
- Error handling: `FINDING-R4-001`
- Structured logging: No findings in this dimension at current milestone scope.
- Build/type quality: `FINDING-R4-003`

#### CODE QUALITY SCORECARD

| Area                     | Status              |
| ------------------------ | ------------------- |
| Strict compiler options  | Satisfied           |
| Linting                  | Satisfied           |
| Typed runtime boundaries | Partially satisfied |
| Typed error taxonomy     | Partially satisfied |
| Package metadata hygiene | Partially satisfied |

#### Finding summary by severity

`CRITICAL: 0  HIGH: 0  MEDIUM: 2  LOW: 1  INFO: 0  Total: 3`

#### Verdict and milestone gate recommendation

`CONDITIONAL PASS`

### R6 — Cryptographic Implementation

Executive summary: `openpgp.js` 5.x is present and policy enforcement exists, but the current M2 implementation is still a stubbed custody model and does not operate on real payload bytes. Overall verdict: `FAIL`.

#### Findings

**FINDING-R6-001**

- Severity: `HIGH`
- Category: `Key Custody`
- Location: `apps/data-plane/src/services/armored-key-provider.ts`, `packages/crypto/src/key-material-provider.ts`
- Evidence: M2 uses a stub where `backendRef` contains armored key material and M3 will replace it with real Vault integration
- Risk: key custody is not separated from general application paths
- Standard Violated: NIST SP 800-57 Part 1 Rev 5; MyKriptografi; BNM RMiT November 2025
- Remediation: integrate Vault/HSM-backed retrieval so `backendRef` is only an opaque handle
- Validation: keys are loaded from Vault/HSM paths and not inline armored material
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R6-002**

- Severity: `HIGH`
- Category: `Cryptographic Correctness`
- Location: `packages/crypto/src/crypto.service.ts`
- Evidence: service encrypts/decrypts reference strings such as `payloadRef` and `encryptedPayloadRef`, not stored payload bytes or streams
- Risk: unit paths can pass while the actual file contents are not what gets cryptographically protected
- Standard Violated: openpgp.js documentation — Streaming API; NIST SP 800-57 Part 1 Rev 5
- Remediation: fetch actual payload bytes from storage and use streaming byte-based operations
- Validation: integration tests confirm ciphertext decrypts to original stored payload bytes
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R6-003**

- Severity: `MEDIUM`
- Category: `Key Lifecycle Monitoring`
- Location: `.env.example`, `apps/control-plane/src/modules/key-references/key-references.service.ts`
- Evidence: only 30-day and 7-day expiry thresholds are configured; no 90-day tier or scheduled alert job exists
- Risk: operational runway for regulated key rotation remains too short
- Standard Violated: NIST SP 800-57 Part 1 Rev 5; BNM RMiT November 2025
- Remediation: add a 90-day threshold and scheduled alerting job
- Validation: inventory tests surface 90/30/7-day states and scheduled scan output
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- OpenPGP implementation: `FINDING-R6-002`
- Key lifecycle and custody: `FINDING-R6-001`, `FINDING-R6-003`
- Algorithm policy: No findings in this dimension at current milestone scope.
- Dual control / approvals: No findings in this dimension at current milestone scope.

#### CRYPTO CONTROL MATRIX

| Control                        | Status              |
| ------------------------------ | ------------------- |
| Maintained OpenPGP library     | Satisfied           |
| Real key custody               | Not satisfied       |
| Crypto over real payload bytes | Not satisfied       |
| Key lifecycle alerting         | Partially satisfied |

#### Finding summary by severity

`CRITICAL: 0  HIGH: 2  MEDIUM: 1  LOW: 0  INFO: 0  Total: 3`

#### Verdict and milestone gate recommendation

`FAIL`

**WAVE 2 COMPLETE**

## Wave 3

### R7 — Principal SRE & Operational Readiness Engineer

Executive summary: observability components exist, but they are not wired into a production-grade readiness model. Overall verdict: `FAIL`.

#### Findings

**FINDING-R7-001**

- Severity: `HIGH`
- Category: `Observability`
- Location: `packages/observability/src/metrics.ts`, `infra/prometheus/prometheus.yml`, service bootstraps
- Evidence: metrics are defined and Prometheus targets are configured, but neither service exposes a metrics listener and data-plane starts only an application context
- Risk: Prometheus targets are configured without an actual serving path
- Standard Violated: Google SRE Book; BNM RMiT November 2025; NIST CSF 2.0 Detect
- Remediation: expose metrics endpoints in both services and verify scrape success
- Validation: `/metrics` returns live series and Prometheus targets are healthy
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R7-002**

- Severity: `HIGH`
- Category: `Alerting and SLOs`
- Location: repository root, infra tree, `PLANS.md`
- Evidence: no alert rule files, no Alertmanager config, no SLO definitions
- Risk: the team cannot detect regression or prove service objectives
- Standard Violated: Google SRE Book; BNM RMiT November 2025; NIST CSF 2.0
- Remediation: define SLOs per critical path and add tested alert rules
- Validation: alert rules fire under controlled failure and SLO dashboards show burn-rate data
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R7-003**

- Severity: `HIGH`
- Category: `Runbooks and DR`
- Location: repository root, docs/runbooks absence, `PLANS.md`
- Evidence: no runbook directory or backup/restore drill artifacts are present
- Risk: incidents would be handled ad hoc with no reviewed procedure
- Standard Violated: Google SRE Book; NIST CSF 2.0 Respond/Recover; BNM RMiT November 2025
- Remediation: add runbooks and execute drills
- Validation: runbook set exists and drill evidence is stored
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- Observability and metrics: `FINDING-R7-001`
- Alerting and SLO management: `FINDING-R7-002`
- Runbooks and disaster recovery: `FINDING-R7-003`
- Capacity/readiness evidence: No findings in this dimension at current milestone scope.

#### READINESS MATRIX

| Area               | Status        |
| ------------------ | ------------- |
| Metrics definition | Present       |
| Metrics exposure   | Not satisfied |
| Alerting           | Not satisfied |
| SLOs               | Not satisfied |
| Runbooks/DR        | Not satisfied |

#### Finding summary by severity

`CRITICAL: 0  HIGH: 3  MEDIUM: 0  LOW: 0  INFO: 0  Total: 3`

#### Verdict and milestone gate recommendation

`FAIL`

### R8 — Regulatory Compliance Architect

Executive summary: the codebase shows intent for retention, auditability, and custody separation, but the repository does not yet contain the regulatory evidence layer needed for Malaysian launch. Overall verdict: `FAIL`.

#### Findings

**FINDING-R8-001**

- Severity: `CRITICAL`
- Category: `Cyber Security Act 2024 / Incident Reporting`
- Location: repository-wide evidence gap; `PLANS.md` accepted-risk register
- Evidence: no incident-reporting workflow, NCII assessment procedure, reporting owner assignment, or statutory escalation playbook exists in-repo
- Risk: a qualifying incident could miss mandatory Malaysian reporting timelines
- Standard Violated: Cyber Security Act 2024 (Malaysia); NIST CSF 2.0 Respond
- Remediation: define incident classification, NCII applicability decision flow, owner, reporting deadline matrix, and evidence pack procedure
- Validation: tabletop exercise proves reportability can be assessed and executed within deadlines
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R8-002**

- Severity: `HIGH`
- Category: `BNM RMiT Control Mapping`
- Location: repository-wide evidence gap
- Evidence: no BNM RMiT control matrix, no evidence register, and no shared-control mapping are present
- Risk: control design may exist in code, but compliance readiness cannot be demonstrated
- Standard Violated: BNM RMiT November 2025; ISO/IEC 27001:2022
- Remediation: create a requirement-to-control-to-evidence matrix
- Validation: every CRITICAL/HIGH control has linked evidence
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R8-003**

- Severity: `HIGH`
- Category: `PDPA Data Governance`
- Location: repository-wide evidence gap; schema and plan files
- Evidence: personal-data-bearing entities and retention objects exist, but there is no PDPA data inventory, erasure workflow, or cross-border transfer control documentation
- Risk: lawful handling, deletion, and transfer governance cannot be demonstrated
- Standard Violated: PDPA 2010; PDPC Cross-Border Transfer of Personal Data Guidelines 03/2025
- Remediation: create a data inventory and define erasure, retention, legal-hold, and transfer workflows
- Validation: data inventory and erasure procedure exist and are testable
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

**FINDING-R8-004**

- Severity: `HIGH`
- Category: `LHDN e-Invoice Readiness`
- Location: repository-wide evidence gap; `PLANS.md`
- Evidence: no LHDN e-Invoice API adapter, evidence mapping, or regulator-specific validation procedure is present
- Risk: the platform cannot support or evidence e-Invoice obligations
- Standard Violated: IRBM e-Invoice Guideline v4.6; LHDN e-Invoice API
- Remediation: implement the regulator integration or explicitly scope it out with contractual boundary language
- Validation: conformance tests or explicit out-of-scope support statements exist
- Milestone Introduced: `M2`
- Resolution Status: `OPEN`

#### Dimension coverage confirmation

- BNM RMiT: `FINDING-R8-002`
- PDPA and cross-border transfer: `FINDING-R8-003`
- IRBM/LHDN e-Invoice: `FINDING-R8-004`
- Cyber Security Act 2024: `FINDING-R8-001`
- Shared responsibility / evidence ownership: `FINDING-R8-002`

#### REGULATORY REQUIREMENT MATRIX

| Regulation                       | Status        | Evidence needed                                 | Risk if unaddressed                           |
| -------------------------------- | ------------- | ----------------------------------------------- | --------------------------------------------- |
| BNM RMiT Nov 2025                | Not satisfied | Control matrix, owners, evidence links          | Customer audit failure / enforcement exposure |
| PDPA 2010 + Cross-Border 03/2025 | Not satisfied | Data inventory, erasure flow, transfer controls | Unlawful handling/transfer exposure           |
| IRBM e-Invoice v4.6              | Not satisfied | Adapter evidence, conformance tests, SOPs       | Customer non-compliance risk                  |
| Cyber Security Act 2024          | Not satisfied | Incident reporting workflow and owner           | Mandatory-reporting failure                   |

#### Finding summary by severity

`CRITICAL: 1  HIGH: 3  MEDIUM: 0  LOW: 0  INFO: 0  Total: 4`

#### Verdict and milestone gate recommendation

`FAIL`

### R9 Gate

`R9 GATED — blocked, open findings: FINDING-R1-001, FINDING-R1-002, FINDING-R2-001, FINDING-R2-002, FINDING-R5-001, FINDING-R5-002, FINDING-R5-003, FINDING-R3-001, FINDING-R3-002, FINDING-R6-001, FINDING-R6-002, FINDING-R7-001, FINDING-R7-002, FINDING-R7-003, FINDING-R8-001, FINDING-R8-002, FINDING-R8-003, FINDING-R8-004`

**WAVE 3 COMPLETE — AUDIT FINISHED.**

## Consolidated Summary

| Role | Critical | High | Medium | Low | Info | Total | Verdict          |
| ---- | -------: | ---: | -----: | --: | ---: | ----: | ---------------- |
| R1   |        0 |    2 |      2 |   0 |    0 |     4 | FAIL             |
| R2   |        1 |    1 |      2 |   0 |    0 |     4 | FAIL             |
| R5   |        0 |    3 |      0 |   0 |    0 |     3 | FAIL             |
| R3   |        1 |    1 |      1 |   0 |    0 |     3 | FAIL             |
| R4   |        0 |    0 |      2 |   1 |    0 |     3 | CONDITIONAL PASS |
| R6   |        0 |    2 |      1 |   0 |    0 |     3 | FAIL             |
| R7   |        0 |    3 |      0 |   0 |    0 |     3 | FAIL             |
| R8   |        1 |    3 |      0 |   0 |    0 |     4 | FAIL             |

### Total Findings

| Critical | High | Medium | Low | Info | Total |
| -------: | ---: | -----: | --: | ---: | ----: |
|        3 |   15 |      8 |   1 |    0 |    27 |

Overall milestone gate verdict: `FAIL`

Gate basis:

- `R9` is not permitted to run because CRITICAL/HIGH findings remain open across `R1-R8`
- the milestone cannot be closed until those CRITICAL/HIGH findings are resolved or formally accepted with written justification
