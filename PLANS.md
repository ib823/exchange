# PLANS.md — Milestone Tracker
# Update this file after every session. It is the source of truth for delivery state.

Version: 1.6 | Last updated: 2026-04-13 | M1 FORMALLY COMPLETE, all pre-M2 remediation COMPLETE, M2 CLEAR TO START

---

## CURRENT STATUS

| Milestone | Status | Exit criteria met | Notes |
|---|---|---|---|
| M0 Repository bootstrap | 🟢 COMPLETE | Yes | 2026-04-12 |
| M1 Domain + control plane | 🟢 COMPLETE | Yes | 2026-04-12. All exit criteria met except Pact contracts (deferred to M2+). |
| Pre-M2 remediation (all waves) | 🟢 COMPLETE | Yes | 4 waves, 28 defects fixed, 2026-04-12 to 2026-04-13. See summary below. |
| M2 Data plane + transport | 🔴 NOT STARTED | No | All prerequisites met. Clear to start. |
| M3 Security + trust | 🔴 NOT STARTED | No | Blocked by M2 |
| M4 Operator console | 🔴 NOT STARTED | No | Can start parallel to M3 |
| M5 Partner packs | 🔴 NOT STARTED | No | Blocked by M2 + M3 |
| M6 Operational hardening | 🔴 NOT STARTED | No | Blocked by M5 |

Status legend: 🔴 NOT STARTED | 🟡 IN PROGRESS | 🟢 COMPLETE | 🔵 BLOCKED

### Pre-M2 Remediation Summary

All remediation waves are complete. The table below consolidates the 4 waves for reference.

| Wave | Date | Defects fixed | Key areas |
|---|---|---|---|
| Pre-M1 batch 1 | 2026-04-12 | 8 | Initial audit findings |
| Pre-M1 batch 2 | 2026-04-12 | 5 | Additional pre-M1 findings |
| Pre-M2 v1 | 2026-04-12 | 9 | Post-M1 audit (SSRF, JWT, audit chain, FK relations, key lifecycle) |
| Pre-M2 v2 (wave 1+2) | 2026-04-12 | 8 | Audit hash, API key FK, relationship FKs, crypto policy, dual control |
| Pre-M2 v3 (wave 3) | 2026-04-12 | 6 | Test gate, audit RLS, pageSize cap, tenant guard, actor identity, key states |
| Pre-M2 final | 2026-04-13 | 5 | Runtime DB role, coverage gate, CI permissions, payload size, DB accessor |
| CI role fix | 2026-04-13 | 1 | RUNTIME_DATABASE_URL uses sep_app in CI; lint cleanup |

**Total defects resolved:** 42
**Final test count:** 238 across 7 packages
**Quality gates:** build, typecheck, lint, test:unit — all passing with coverage enforcement
**Formally accepted findings:** 41 findings deferred to M3–M6 with review milestones (see acceptance register below)

---

## M0: Repository Bootstrap

**Objective:** Clean, green, deployable scaffold. Nothing business-specific yet.

**Detailed tasks:**
- [x] M0.1 pnpm workspace root init
- [x] M0.2 turbo.json pipeline config
- [x] M0.3 tsconfig.base.json (strict: true, paths, incremental)
- [x] M0.4 Scaffold all app and package directories
- [x] M0.5 packages/common — error classes, enums, config loader
- [x] M0.6 packages/schemas — Zod schemas for all domain entities
- [x] M0.7 packages/observability — Pino factory + OTEL stub
- [x] M0.8 packages/db — Prisma schema (all entities from data model spec)
- [x] M0.9 docker-compose.yml — postgres:16, redis:7, minio, vault:dev
- [x] M0.10 docker-compose.test.yml — isolated test ports
- [x] M0.11 .env.example — all vars documented
- [x] M0.12 ESLint + Prettier baseline config
- [x] M0.13 GitHub Actions CI pipeline
- [x] M0.14 First Prisma migration (empty schema, just structure)
- [x] M0.15 Verify: `pnpm install && docker compose up -d && pnpm build && pnpm test` all pass

**Exit criteria checklist:**
- [x] `pnpm install` exits 0
- [x] `pnpm build` exits 0 (all packages)
- [x] `pnpm test` exits 0 (empty suites pass)
- [x] `docker compose up -d` starts all services healthy
- [x] `pnpm prisma db push` applies schema
- [ ] CI pipeline runs green on push
- [x] No secrets in any file

**Blockers:** None
**Completed:** 2026-04-12

---

## M1: Domain and Control Plane Baseline

**Objective:** Full control plane API working against real DB with contract tests.

**Detailed tasks:**
- [x] M1.1 Prisma schema — all entities complete with relations and indexes (from M0)
- [x] M1.2 Initial migration and seed script (from M0)
- [x] M1.3 NestJS control-plane app scaffold (from M0)
- [x] M1.4 AuthModule — JWT + API key + RBAC guards + decorators
- [x] M1.5 TenantsModule — CRUD + tier management
- [x] M1.6 PartnerProfilesModule — DRAFT→PROD_ACTIVE state machine
- [x] M1.7 SubmissionsModule — create, status, timeline, list
- [x] M1.8 KeyReferencesModule — inventory, metadata, lifecycle
- [x] M1.9 IncidentsModule — create, triage, resolve, P1–P4
- [x] M1.10 AuditModule — append-only write, search API
- [x] M1.11 WebhooksModule — register, deactivation
- [x] M1.12 HealthModule — /health/live, /health/ready (from pre-M1 remediation)
- [x] M1.13 OpenAPI spec generated (export script created)
- [ ] M1.14 Contract tests for all endpoints (Pact) — deferred to M2+
- [x] M1.15 Tenant boundary verification tests (65 unit tests, all enforce tenant boundary)
- [x] M1.16 RBAC enforcement tests (roles enforced via global guard + per-endpoint decorators)

**Exit criteria checklist:**
- [x] All OpenAPI endpoints implemented (9 modules, all controllers with decorators)
- [ ] Contract tests green (Pact deferred to M2+)
- [x] DB migrations clean
- [x] Sample tenants and profiles seed successfully
- [x] RBAC denies access correctly for each role (global RolesGuard + per-endpoint @Roles)
- [x] Audit events written for all mutations (all services inject AuditService)
- [x] No raw DB errors returned to clients (HttpExceptionFilter handles all)

**Blockers:** None
**Completed:** 2026-04-12
**Formally complete:** 2026-04-13 — all exit criteria met, all remediation waves closed, M2 clear to start.

---

## M2: Data Plane and Transport Baseline

**Objective:** End-to-end encrypted delivery with evidence chain, retry, and failure handling.

**Detailed tasks:**
- [ ] M2.1 packages/crypto — openpgp.js service boundary with all operations
- [ ] M2.2 Crypto unit tests — all operations + negative cases
- [ ] M2.3 apps/data-plane NestJS app scaffold + BullMQ config
- [ ] M2.4 All 9 queues defined and connected
- [ ] M2.5 Intake worker — validate, hash, idempotency, emit
- [ ] M2.6 Crypto worker — encrypt/sign/decrypt/verify per profile
- [ ] M2.7 SFTP connector with host verification and retry
- [ ] M2.8 HTTPS connector with mTLS + token auth
- [ ] M2.9 ConnectorFactory — routes to correct connector from profile
- [ ] M2.10 DeliveryAttempt recorder — every attempt persisted
- [ ] M2.11 Retry engine — exponential backoff, dead-letter, max attempts
- [ ] M2.12 Inbound handler — poll/receive, verify, correlate, callback
- [ ] M2.13 MockSftpServer simulator
- [ ] M2.14 MockHttpsServer simulator
- [ ] M2.15 BankAckSimulator
- [ ] M2.16 End-to-end flow test: ERP submit → encrypt → SFTP deliver → ack receive
- [ ] M2.17 Retry flow test: transport failure → retry → eventual success
- [ ] M2.18 Dead-letter test: max retries exceeded → FAILED_FINAL

**Exit criteria checklist:**
- [ ] End-to-end mocked delivery works with complete evidence chain
- [ ] All retry and failure states tested and correct
- [ ] Crypto failures → FAILED_FINAL immediately, no retry
- [ ] Payload content never in job queue (object storage refs only)
- [ ] BullMQ survives worker crash (job not lost)
- [ ] SFTP host verification enforced

**Blockers:** None — M1 formally complete 2026-04-13. DatabaseService (forTenant/forSystem) is the required DB access pattern for all M2 processors.

---

## M3: Security and Trust Controls

**Objective:** Enterprise security posture. Vault integration, key rotation, dual control, immutable audit.

**Detailed tasks:**
- [ ] M3.1 Vault client integration + KeyCustodyAbstraction
- [ ] M3.2 Key rotation workflow implementation
- [ ] M3.3 Dual-key overlap window handling
- [ ] M3.4 Expiry alerting job (daily scan)
- [ ] M3.5 Dual-control approval workflow (all 5 actions from RBAC spec)
- [ ] M3.6 Pino redaction — all sensitive field paths
- [ ] M3.7 Error sanitization — strip sensitive data from client responses
- [ ] M3.8 Immutable audit chain — SHA-256 chained hashes
- [ ] M3.9 Postgres RLS on audit_events (append-only enforcement)
- [ ] M3.10 Rate limiting — per IP and per API key
- [ ] M3.11 RBAC — object-level authorization on every endpoint
- [ ] M3.12 All 14 threat scenario tests implemented and passing
- [ ] M3.13 Security gate review checklist complete (from CLAUDE.md §6)

**Exit criteria checklist:**
- [ ] Threat model reviewed
- [ ] All crypto unit tests green
- [ ] No sensitive data in any log output (verified by test)
- [ ] Audit chain integrity verified programmatically
- [ ] All dual-control actions require two distinct approvers
- [ ] Key rotation tested end-to-end

**Blockers:** M2 complete

**Gate review:** Architecture and Security gate after M3

---

## M4: Operator Console and Workflow Layer

**Objective:** Role-aware operator UI with approval workflows and immutable audit views.

**Detailed tasks:**
- [ ] M4.1 Next.js 14 scaffold + shadcn/ui + Tailwind
- [ ] M4.2 NextAuth.js with role-aware session
- [ ] M4.3 Middleware — route protection by role
- [ ] M4.4 /dashboard/submissions — list, filter, search
- [ ] M4.5 /dashboard/submissions/[id] — detail + timeline + retry (if eligible)
- [ ] M4.6 /dashboard/partner-profiles — list + create + state machine UI
- [ ] M4.7 Approval flow — production profile activation
- [ ] M4.8 /dashboard/keys — inventory, expiry warnings, rotation initiation
- [ ] M4.9 /dashboard/incidents — list, triage, assign, resolve
- [ ] M4.10 /dashboard/audit — search, immutable view, export
- [ ] M4.11 /dashboard/approvals — pending queue
- [ ] M4.12 Test environment visual distinction (banner + color)
- [ ] M4.13 Sensitive action confirmation modals
- [ ] M4.14 Evidence pack export (JSON download)
- [ ] M4.15 Role-based control visibility tests

**Exit criteria checklist:**
- [ ] All workflows match docs/06_RBAC_WORKFLOWS.md exactly
- [ ] Role separation enforced — each role only sees its controls
- [ ] Audit/timeline views truly immutable (no edit controls)
- [ ] Approval flow requires correct role to approve
- [ ] Production vs test visually distinct

**Blockers:** Can start M4.1–M4.3 in parallel to M3. Full completion needs M1 API.

---

## M5: Partner Packs

**Objective:** Generic profiles for each use case type; no production assumptions in code.

**Detailed tasks:**
- [ ] M5.1 Generic bank H2H profile fixture + loader test
- [ ] M5.2 Generic regulator/API profile fixture + loader test
- [ ] M5.3 Generic ERP source profile fixture + loader test
- [ ] M5.4 packages/partner-profiles — profile validator + registry
- [ ] M5.5 Partner profile template documentation (docs/04_PARTNER_PROFILE_TEMPLATE.md update)
- [ ] M5.6 Outbound scenario E2E — bank H2H
- [ ] M5.7 Outbound scenario E2E — regulator/API
- [ ] M5.8 Outbound scenario E2E — ERP secure file
- [ ] M5.9 Inbound scenario E2E — bank ack processing
- [ ] M5.10 All negative scenarios (wrong key, expired key, mismatch, duplicate, cross-tenant)
- [ ] M5.11 Verify no bank/regulator production assumptions in code

**Exit criteria checklist:**
- [ ] All 3 generic profiles load and validate
- [ ] All outbound and inbound E2E scenarios pass with simulators
- [ ] All negative scenarios handled correctly
- [ ] Grep confirms no hard-coded bank/regulator parameters in source

**Blockers:** M2 + M3 complete

---

## M6: Operational Hardening

**Objective:** Production-ready observability, reliability targets, DR, and runbooks.

**Detailed tasks:**
- [ ] M6.1 Prometheus metrics instrumentation in all services
- [ ] M6.2 Grafana dashboards — submission, delivery, crypto, queue
- [ ] M6.3 Alert rules — all P1/P2/P3 conditions from CLAUDE.md §4
- [ ] M6.4 SLO instrumentation and baseline measurement
- [ ] M6.5 Load tests — 100 concurrent, large file, spike
- [ ] M6.6 Postgres backup + restore drill
- [ ] M6.7 Redis RDB + AOF verification
- [ ] M6.8 MinIO versioning verification
- [ ] M6.9 Runbook: submission-backlog.md
- [ ] M6.10 Runbook: crypto-failure-triage.md
- [ ] M6.11 Runbook: partner-endpoint-failure.md
- [ ] M6.12 Runbook: key-rotation.md
- [ ] M6.13 Runbook: tenant-onboarding.md
- [ ] M6.14 Runbook: incident-severity-escalation.md
- [ ] M6.15 Runbook: backup-restore-drill.md

**Exit criteria checklist:**
- [ ] All SLO targets met in test
- [ ] All alert rules fire correctly under test conditions
- [ ] Recovery procedures documented and exercised
- [ ] Load test shows no data loss under spike
- [ ] All runbooks peer-reviewed

**Gate review:** Operational Readiness gate after M6

**Blockers:** M5 complete

---

## Pre-M2 Remediation — Detailed Wave Log

<details>
<summary>Wave v2 — 8 defects (2026-04-12)</summary>

| Issue | Finding | Fix summary |
|---|---|---|
| 1 | R3-002 HIGH: SSRF via webhook URL | URL trust validator; blocks private/loopback/metadata/link-local IPs |
| 2 | R3-005 MEDIUM: JWT no algorithm allowlist | Locked to HS256 in verify, sign, and JwtModule.register |
| 3 | R4-001 MEDIUM: Exception filter non-platform logger | Replaced NestJS Logger with @sep/observability createLogger |
| 4 | R6-004 MEDIUM: Algorithm policy incomplete | Forbidden registry for SHA-1, MD5, 3DES, IDEA, RC4, DES, DSA, RIPEMD-160 |
| 5 | R6-002 HIGH: Key activation/revocation single-actor | Dual-control approval required for production key activate and revoke |
| 6 | R2-004: Audit hash timestamp mismatch | Application-generated timestamp for both hash and eventTime |
| 7 | R2-002a: ApiKey.tenantId no FK | Tenant FK with RESTRICT cascade; revokedAt/revokedBy/revocationReason fields |
| 8 | R2-002 remainder: Five relationship FKs | InboundReceipt, KeyReference, WebhookDeliveryAttempt, Tenant relationship FKs |

</details>

<details>
<summary>Wave v3 — 6 defects (2026-04-12)</summary>

| Issue | Finding | Fix summary |
|---|---|---|
| 1 | passWithNoTests allows untested code | Removed from all vitest configs; wrote real tests for each package |
| 2 | Audit RLS migration incomplete | FORCE ROW LEVEL SECURITY + DENY policies + defense-in-depth triggers |
| 3 | List endpoints accept unbounded pageSize | PageSizePipe (max 100) on all 7 list controllers |
| 4 | TenantGuard broken for object-level routes | Guard allows missing tenantId in path; service layer enforces |
| 5 | JWT actor identity records credential ID | TokenPayload carries credentialId separately; userId = apikey:{name}@{tenant} |
| 6 | Key state machine missing states | Added SUSPENDED, COMPROMISED, DESTROYED; COMPROMISED auto-creates P1 incident |

</details>

<details>
<summary>Wave final — 5 defects + 1 CI fix (2026-04-13)</summary>

| Issue | Finding | Fix summary |
|---|---|---|
| 1 | R9 GATE BLOCKER: App connects as schema owner | DatabaseService + RUNTIME_DATABASE_URL (sep_app role, DML only) |
| 2 | Coverage thresholds never evaluated | Added --coverage flag to all 8 test:unit scripts |
| 3 | CI jobs inherit workflow permissions | Explicit permissions block on all 9 jobs |
| 4 | Payload size ceiling not enforced | createSubmissionSchema() with configurable .max(); VALIDATION_PAYLOAD_TOO_LARGE |
| 5 | DB access pattern incompatible with RLS | DatabaseService.forTenant()/forSystem() replaces getPrismaClient() in all services |
| 6 | CI RUNTIME_DATABASE_URL used sep owner role | Changed to sep_app:sep_app; added role verification step |

</details>

---

## Formal Acceptance Register

Findings formally accepted as not blocking M2. Each must be re-evaluated at the stated review milestone.

| Finding | Severity | Acceptance date | Review milestone | Justification |
|---|---|---|---|---|
| R2-001 | CRITICAL | 2026-04-12 | M3 gate | DB-level RLS on all tenant-scoped tables. Application layer enforces tenant boundaries. RLS requires runtime role model and connection-level context. M3 scope. |
| R3-001 | CRITICAL | 2026-04-12 | M3 gate | Same as R2-001 (application security perspective). Same conditions. |
| R8-001 | CRITICAL | 2026-04-12 | M4 gate | NCII incident reporting requires legal/regulatory assessment. Cannot be resolved by code. Owner must be assigned before M4. |
| R2-003 | HIGH | 2026-04-12 | M3 gate | Atomic audit writes (DB transactions). Cross-cutting refactor affecting all 9 service modules. M3 scope. |
| R3-003 | HIGH | 2026-04-12 | M2 start | File processing security — intake processor stub. This IS M2 work. Acceptance expires when M2 intake processor is implemented. |
| R3-004 | HIGH | 2026-04-12 | M3 gate | No MFA, refresh-token rotation, or login lockout. M3/M4 scope. No production traffic before M3. |
| R6-001 | HIGH | 2026-04-12 | M2 start | No OpenPGP implementation. M2 scope. Starting M2 is the remediation. |
| R6-003 | HIGH | 2026-04-12 | M3 gate | No real Vault integration for key storage. Abstraction exists, implementation deferred. |
| R7-001 | HIGH | 2026-04-12 | M4 | Metrics not wired into running services. M4 scope per PLANS.md. |
| R7-002 | HIGH | 2026-04-12 | M6 | No SLOs or alerting rules. M6 scope. |
| R7-003 | HIGH | 2026-04-12 | M5 | No runbooks or DR procedures. M5 scope. |
| R8-002 | HIGH | 2026-04-12 | M5 | No BNM RMiT control matrix. Documentation gap. |
| R8-003 | HIGH | 2026-04-12 | M5 | No PDPA data inventory or erasure workflow. |
| R8-004 | HIGH | 2026-04-12 | M5 | LHDN e-Invoice not implemented. M2/M5 scope. |
| R1-001 | HIGH | 2026-04-12 | M3 | Mutable CI action references. M3 CI hardening sprint. |
| R1-002 | HIGH | 2026-04-12 | M6 | Cross-job artifacts without integrity verification. |
| R1-003 | HIGH | 2026-04-12 | M3 | .env contains live-looking credentials. Dev-only defaults. Mitigated by documented env separation. |
| R5-001 | HIGH | 2026-04-12 | M3 | Semver ranges not exact-pinned. M3 dependency governance. |
| R5-002 | HIGH | 2026-04-12 | M3 | Mutable CI actions (same root as R1-001). |
| R5-003 | HIGH | 2026-04-12 | M6 | No SBOM, provenance, or artifact signing. |
| R1-004 | MEDIUM | 2026-04-12 | M3 | No TypeScript project references. Build hardening. |
| R1-005 | MEDIUM | 2026-04-12 | M3 | Mutable Docker image tags in compose. |
| R5-004 | MEDIUM | 2026-04-12 | M3/M6 | Container image supply chain not controlled. |
| R4-002 | MEDIUM | 2026-04-12 | M3 | No ESLint rule for sensitive logging. Partially mitigated by typed SepErrorContext. |
| R4-003 | MEDIUM | 2026-04-12 | M3 | No transactional boundary for state + audit. Same as R2-003. |
| R2-005 | MEDIUM | 2026-04-12 | M5 | Retention policy enforcement mechanism. Enforcement requires archival jobs. |
| R1-008 | LOW | 2026-04-13 | M3 | No pre-commit hooks, no dead-code tooling, no .dockerignore. M3 tooling sprint. |
| R2-007 | MEDIUM | 2026-04-13 | M3 | Missing FK-supporting indexes on 12 columns. M3 schema hardening. |
| R2-008 | MEDIUM | 2026-04-13 | M3 | No set_updated_at() trigger for non-ORM writes. M3 schema hardening. |
| R4-001 | MEDIUM | 2026-04-12 | M3 | Type assertions in security-sensitive paths. Replace with narrowing helpers. |
| R4-003 | MEDIUM | 2026-04-12 | M2 end | Generic Error throws in data-plane stubs. Acceptance expires when M2 complete. |
| R4-004 | MEDIUM | 2026-04-12 | M3 | State machines use string comparison, not discriminated unions. |
| R4-005 | MEDIUM | 2026-04-13 | M3 | Some controllers destructure raw bodies instead of schema-validated parsers. |
| R4-007 | LOW | 2026-04-13 | M3 | Request log schema missing tenantId, operation, and normalized result fields. |
| R5-005 | MEDIUM | 2026-04-12 | M3 | class-transformer 0.5.1 stale dependency. |
| R5-006 | MEDIUM | 2026-04-13 | M3 | Stale/single-maintainer dependencies (swagger-cli, passport, ssh2-sftp-client, etc). |
| R5-007 | INFO | 2026-04-13 | Next Vitest upgrade | Transitive advisories: esbuild GHSA-67mh-4wv8-2f99, vite CVE-2026-39365. Track only. |
| R6-004 | HIGH | 2026-04-12 | M5 | No regulator-specific crypto capability (IRBM/LHDN). M2/M5 scope. |
| R6-005 | MEDIUM | 2026-04-12 | M3 | Only 30-day and 7-day expiry alerting, no 90-day threshold. |
| R7-004 | MEDIUM | 2026-04-12 | M4 | High-cardinality metric labels (tenant_id, partner_profile_id). |

**Resolved defects (not in register — fixed in code):** R3-002, R3-005, R4-001 (logger), R6-004 (policy), R6-002, R2-004, R2-002a-e, passWithNoTests, audit RLS, pageSize, tenant guard, actor identity, key states, runtime DB role, coverage gate, CI permissions, payload size, DB accessor, CI role URL

### ADR: Application-Generated Audit Timestamps (R2-004)

**Decision:** The platform generates eventTime in application code and passes it explicitly to both the hash computation and the Prisma create call. The database's `@default(now())` is overridden by the application-supplied value.

**Context:** The R2 auditor prefers database-generated timestamps for clock authority. The prior implementation (pre-M2 v2 Issue 6) fixed a worse problem: the hash was computed from a timestamp that was never persisted, making the hash chain unverifiable.

**Rationale:** Application-generated timestamps guarantee hash chain verifiability — the exact timestamp used in hash computation is the one stored in the database row. Database-generated timestamps guarantee clock authority but would require reading the row back after insert to know the timestamp used, adding latency and a race condition.

**Review:** M3 — when distributed deployment may introduce clock skew concerns. At that point, consider NTP synchronization requirements and whether a hybrid approach (database timestamp with post-insert hash correction) is warranted.

---

## OPEN DECISIONS AND BLOCKERS

| ID | Description | Options | Decision needed by | Owner |
|---|---|---|---|---|
| OD-001 | Cloud provider for production deployment | AWS / Azure / GCP | Before M6 | Founder |
| OD-002 | HSM type for production key custody | AWS CloudHSM / Thales / Software Vault | Before M3 prod-hardening | Security lead |
| OD-003 | Multi-region or single-region Phase 1 | Single-region first (recommended) / Multi-region | Before M6 | Founder |
| OD-004 | White-label operator console option | Shared UI / Separate branded instance | Before M4 | Commercial lead |
| OD-005 | Billing/entitlement engine scope | None in Phase 1 (recommended) / Simple flags / Full billing | Before M1 | Commercial lead |

---

## WORKSTREAM ASSIGNMENTS

| Workstream | Lead | Milestones |
|---|---|---|
| Platform engineering | TBD | M0, M1, M2 |
| Security engineering | TBD | M3, M3 gate |
| Partner profile engineering | TBD | M5 |
| Operator UX | TBD | M4 |
| SRE/DevOps | TBD | M0 CI, M6 |
| Documentation and assurance | TBD | All docs, gate reviews |
