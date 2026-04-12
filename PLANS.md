# PLANS.md — Milestone Tracker
# Update this file after every session. It is the source of truth for delivery state.

Version: 1.1 | Last updated: 2026-04-12 | M0 COMPLETE

---

## CURRENT STATUS

| Milestone | Status | Exit criteria met | Notes |
|---|---|---|---|
| M0 Repository bootstrap | 🟢 COMPLETE | Yes | Completed 2026-04-12 |
| M1 Domain + control plane | 🔴 NOT STARTED | No | M0 complete, ready to start |
| M2 Data plane + transport | 🔴 NOT STARTED | No | Blocked by M1 |
| M3 Security + trust | 🔴 NOT STARTED | No | Blocked by M2 |
| M4 Operator console | 🔴 NOT STARTED | No | Can start parallel to M3 |
| M5 Partner packs | 🔴 NOT STARTED | No | Blocked by M2 + M3 |
| M6 Operational hardening | 🔴 NOT STARTED | No | Blocked by M5 |

Status legend: 🔴 NOT STARTED | 🟡 IN PROGRESS | 🟢 COMPLETE | 🔵 BLOCKED

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
- [ ] M1.1 Prisma schema — all entities complete with relations and indexes
- [ ] M1.2 Initial migration and seed script
- [ ] M1.3 NestJS control-plane app scaffold
- [ ] M1.4 AuthModule — JWT + API key + RBAC guards + decorators
- [ ] M1.5 TenantsModule — CRUD + tier management
- [ ] M1.6 PartnerProfilesModule — DRAFT→PROD_ACTIVE state machine
- [ ] M1.7 SubmissionsModule — create, status, timeline, list
- [ ] M1.8 KeyReferencesModule — inventory, metadata, lifecycle
- [ ] M1.9 IncidentsModule — create, triage, resolve, P1–P4
- [ ] M1.10 AuditModule — append-only write, search API
- [ ] M1.11 WebhooksModule — register, verify HMAC, dispatch
- [ ] M1.12 HealthModule — /health/live, /health/ready
- [ ] M1.13 OpenAPI spec generated and validated against api/openapi.yaml
- [ ] M1.14 Contract tests for all endpoints (Pact)
- [ ] M1.15 Tenant boundary verification tests
- [ ] M1.16 RBAC enforcement tests (each role's allowed/denied actions)

**Exit criteria checklist:**
- [ ] All OpenAPI endpoints implemented
- [ ] Contract tests green
- [ ] DB migrations clean
- [ ] Sample tenants and profiles seed successfully
- [ ] RBAC denies access correctly for each role
- [ ] Audit events written for all mutations
- [ ] No raw DB errors returned to clients

**Blockers:** M0 complete

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

**Blockers:** M1 complete

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
