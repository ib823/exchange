# Phase 2 Implementation Plan — Malaysia Secure Exchange Platform

**Version:** 1.0 (2026-04-17)
**Authoring context:** Written after Phase 1 forensic audit (readiness 58/100, 37 live findings) and dependency review. Planning discipline is **rolling-wave** (see §1.3).
**Supersedes:** Nothing — this is the first Phase 2 plan. Milestone scopes refine those in `CLAUDE.md` §4 with forensic findings baked in.
**Companion documents:**

- `_plan/M3_0_FOUNDATION_RESET.md` — detailed execution plan for M3.0
- `_plan/control_mapping.csv` — finding-to-milestone traceability matrix
- `_audit/FORENSIC_REPORT.md` — Phase 1 forensic evidence base
- `PLANS.md` — milestone tracker and formal acceptance register

---

## 1. Framing

### 1.1 Purpose of this document

This plan answers: _given that the platform is 5 days old, 58/100, and has 37 open findings with a formal acceptance register already committing those findings to M3–M6, how does the team execute the next four months without drift, silent scope-creep, or re-litigation of settled architectural decisions?_

It does **not** replace `CLAUDE.md` (which remains the implementation-scope reference) or `PLANS.md` (which remains the live milestone tracker). It refines both with the forensic evidence and names the decision points that must be resolved at each milestone boundary.

### 1.2 Authority hierarchy

When the following documents disagree, the resolution order is:

1. **This document** (Phase 2 Implementation Plan) — for decisions made 2026-04-17 onward
2. **Architectural Decision Records** (`docs/adr/*.md`) — for individual decisions captured at execution time
3. **`CLAUDE.md`** — for milestone intent, security checklist, quality gates, coding conventions
4. **`PLANS.md`** — for current execution state and the formal acceptance register
5. **`_audit/FORENSIC_REPORT.md`** — for forensic evidence and reconciliation of prior-audit findings
6. **`CLAUDE_CODE_PROMPT.md`, `BODY1_EXECUTION.md`** — historical execution notes; not authoritative for future work

The hostile audit (`audit/2026-04-16-hostile-audit-m2.md`) is treated as **evidence**, not governance. Its FAIL verdict is resolved by the acceptance register, which binds each critical/high finding to a specific remediation milestone.

### 1.3 Rolling-wave discipline

Each milestone has two documents at different levels of detail:

- **Roadmap-mode** (in this document, §3): goals, scope, exit criteria, known decisions, est. effort, risk flags. Sufficient for portfolio reasoning; insufficient for execution.
- **Execution-mode** (separate `_plan/Mx_EXECUTION_PLAN.md` per milestone): task IDs, acceptance criteria per task, test fixtures, specific file paths. Written **at the milestone boundary**, informed by the preceding milestone's handoff.

The pattern is: **detailed plan with short horizon, outline plan with long horizon, convert outline → detail at each boundary.** The risk this avoids: writing a 200-page plan for work that is 4 months away, and discovering at M3 that the plan is fiction.

M3.0 is the exception — it has a complete execution-mode plan today (`_plan/M3_0_FOUNDATION_RESET.md`) because it must execute before architectural decisions can be refined.

---

## 2. Target architecture

The architecture inherits from `CLAUDE.md` §2. This section records refinements introduced by Phase 2 planning, and the rationale.

### 2.1 Service decomposition

```
┌─────────────────────────────────────────────────────────────────┐
│                        External surfaces                         │
│  Customer API (REST)   Operator Console (Next.js)   Callbacks   │
└──────────┬────────────────────┬────────────────────────┬────────┘
           │                    │                        │
┌──────────▼─────────┐  ┌──────▼─────────┐    ┌─────────▼────────┐
│   control-plane    │  │   Next.js app  │    │  callback receiver│
│  (NestJS+Fastify)  │  │ (apps/operator-│    │   (M3.5 — route   │
│  - Tenant mgmt     │  │     console)   │    │   on control-plane│
│  - Submissions API │  │                │    │    or data-plane) │
│  - Approvals       │  │                │    │                   │
│  - Partner profile │  │                │    │                   │
│  - Key references  │  │                │    │                   │
└──────────┬─────────┘  └────────┬───────┘    └─────────┬────────┘
           │ enqueue              │ reads               │ enqueue
           ▼                      ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Redis (BullMQ queues)                      │
│   intake   │   crypto   │   delivery   │   inbound   │   dlq    │
└──────────┬───────────────────────────────────────────────────────┘
           │ consume
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    data-plane (NestJS context, no HTTP today    │
│                     — gains /metrics endpoint in M4)             │
│  Intake → Crypto → Delivery → Inbound → Webhook                 │
└───┬──────────────┬──────────────┬──────────────┬──────────┬────┘
    │              │              │              │          │
    ▼              ▼              ▼              ▼          ▼
┌─────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────┐
│Object   │  │   KMS    │  │ SFTP /    │  │ Partner  │  │ SIEM │
│Storage  │  │(Vault /  │  │ HTTPS     │  │ endpoints│  │(M6)  │
│(S3/Mini │  │ AWS KMS) │  │ connectors│  │          │  │      │
│O)       │  │          │  │ (M3.5)    │  │          │  │      │
└─────────┘  └──────────┘  └───────────┘  └──────────┘  └──────┘
     │                            │
     └──── Postgres ──────────────┘
          (18 Prisma models,
           RLS on all tenant-
           scoped tables from M3)
```

### 2.2 Tenancy model

Three tiers, all served from the same codebase:

| Tier                  | Isolation                                                                                                                                                                                                       | Backing infra                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **STANDARD** (shared) | Logical — same DB, same Redis, same Vault. **FORCE ROW LEVEL SECURITY** on every tenant-scoped table. `DatabaseService.forTenant()` opens a transaction and `SET LOCAL app.current_tenant_id` before any query. | One cluster                           |
| **DEDICATED**         | Namespace — separate Vault namespace, separate Redis logical DB, separate Postgres schema (or separate DB instance for larger tenants). RLS still enforced as defence-in-depth.                                 | Shared cluster, per-tenant namespaces |
| **PRIVATE**           | Physical — separate cluster. Customer-operated or Anthropic-operated-on-customer-cloud. No shared infrastructure with other tenants.                                                                            | Separate cluster per tenant           |

The `ServiceTier` enum in `packages/db/prisma/schema.prisma` already encodes these three tiers. The runtime differentiation is **M3 scope**, not present today.

**Authoritative reference:** This is my decision as of 2026-04-17 (Q4 in forensic report §8). Flip this decision by writing `docs/adr/0006-tenancy-model.md` before M3 begins.

### 2.3 Key custody abstraction

Three backends, one interface:

```typescript
// packages/crypto/src/key-custody.interface.ts (target shape for M3)
interface KeyCustodyBackend {
  readonly backendType: 'vault' | 'aws-kms' | 'azure-kv';
  retrieve(keyRef: KeyReference): Promise<CryptoKey>;
  store(material: KeyMaterial, metadata: KeyMetadata): Promise<KeyReference>;
  sign?(keyRef: KeyReference, payload: Uint8Array): Promise<Signature>; // transit-style
  verify?(keyRef: KeyReference, payload: Uint8Array, sig: Signature): Promise<boolean>;
  rotate(keyRef: KeyReference): Promise<KeyReference>;
}
```

**Vault backend (M3):** Thin custom HTTP client on `undici`, ~200 LOC. Supports `kv/data/*` for armored material and `transit/sign` + `transit/verify` for HSM-like no-export flows. Per ADR-0004 in `M3_0_FOUNDATION_RESET.md`.

**AWS KMS backend (M3 or M3.5):** Via `@aws-sdk/client-kms`. For tenants on AWS-native deployments.

**Azure Key Vault backend (post-Phase-1):** Stub interface only in M3; implementation deferred.

**Selection:** Per-tenant, recorded on the `Tenant` table. Default = Vault. Selection cannot change after a tenant has active keys (would require re-wrapping all material).

**OD-002 resolution:** This decision supersedes the open OD-002 in `PLANS.md` ("HSM type for production key custody"). The three-backend abstraction eliminates the binary choice. Customer choice at onboarding time.

### 2.4 Object storage

S3-compatible access via `@aws-sdk/client-s3`:

- **Dev:** MinIO (already in `docker-compose.yml`)
- **Test:** MinIO via testcontainers (M3.5)
- **Production:** AWS S3 (or provider-equivalent: Cloudflare R2, Backblaze B2, etc.)

Pre-signed URLs via `@aws-sdk/s3-request-presigner` for the currently-ABSENT large-file upload path (forensic report §3.5, capability "Metadata + pre-signed upload").

**Residency:** `STORAGE_REGION` config per tenant. Q12 (MY residency) resolved by adding a `myResidency: boolean` tenant flag in M3.0 (§10.3 of M3.0 plan). When true, the region is pinned to an MY-hosted bucket and cross-border replication is disabled. When false, default = `ap-southeast-1` (Singapore). PDPA cross-border transfer guideline 03/2025 compliance documented in M5 regulatory evidence matrix.

### 2.5 Queue and orchestration

**BullMQ + Redis 7** stays for Phase 1. Sufficient for:

- Single-tenant job sequencing (intake → crypto → delivery → inbound)
- Exponential backoff with jitter (NEW-02 remediation in M3)
- Dead-letter queue handling
- Per-tenant concurrency limits

**Temporal** deferred to M5 evaluation gate. Adoption trigger: when partner exchanges require orchestration that survives worker restart for hours (e.g. bank H2H file submission → ack poll with 4-hour window). If M5 partner profiles don't need it, defer permanently.

### 2.6 Observability stack

Three complementary layers, installed in M3.0, wired progressively through M3/M4/M6:

| Layer              | Tool                                             | Installed | Wired                       |
| ------------------ | ------------------------------------------------ | --------- | --------------------------- |
| Structured logs    | Pino 9 + 90-path redaction                       | M3.0      | M3 (refinement)             |
| Metrics            | prom-client + OTEL metrics bridge                | M3.0      | M4 (HTTP endpoint)          |
| Distributed traces | OTEL SDK + auto-instrumentations + OTLP exporter | M3.0      | M3 (tracer init in main.ts) |
| Alerting + SLOs    | Prometheus + Alertmanager                        | —         | M6                          |
| Dashboards         | Grafana (in compose)                             | —         | M6                          |
| SIEM forwarding    | TBD                                              | —         | M6                          |

**Correlation ID propagation** through all three layers from M3 onward. The `x-correlation-id` header flows control-plane → BullMQ job → data-plane processor → outbound SFTP/HTTPS headers → inbound callback. This is the forensic thread when exchange-level incident triage is needed.

### 2.7 What has NOT changed from CLAUDE.md

To avoid re-litigation: NestJS 11 + Fastify 5 + Prisma + BullMQ + Redis 7 + PostgreSQL 16 + openpgp.js 5 + Next.js 14 + Turborepo 2 + pnpm 9 + TypeScript strict + Zod — all locked per CLAUDE.md §2 and remain so. M3.0 refreshes versions; architecture is unchanged.

---

## 3. Milestone roadmap

### 3.1 At-a-glance

| Milestone                         | Status                     | Est. duration  | Primary exit criterion                                                            | Depends on                               |
| --------------------------------- | -------------------------- | -------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| **M3.0** Foundation Reset         | Ready                      | 3–5 eng-days   | Refreshed stack, CI green, no regression in test count                            | M2 closed ✓                              |
| **M3** Security & Trust           | Blocked on M3.0            | 15–20 eng-days | All 3 CRITICAL + 7 HIGH findings closed; 14 threat tests pass                     | M3.0                                     |
| **M3.5** Data Plane Reality       | Blocked on M3              | 10–15 eng-days | One real SFTP + one real HTTPS round-trip, both in CI, payload bytes from real S3 | M3                                       |
| **M4** Operator Console           | Parallel to M3.5 from M3.4 | 15–20 eng-days | Dashboards + approvals + audit views live; metrics HTTP endpoint exposed          | M3 (for auth); can start while M3.5 runs |
| **M5** Partner Packs + Regulatory | Blocked on M3.5            | 20–25 eng-days | 3 generic profiles E2E + BNM/PDPA/LHDN control matrices delivered                 | M3.5                                     |
| **M6** Operational Hardening      | Blocked on M5              | 15–20 eng-days | SLOs + alerting + runbooks + DR drill + SBOM signing                              | M5                                       |

**Total from M3.0 start to M6 close:** 78–105 engineer-days (≈ 3.5–5 months, single contributor; ≈ 2 months with 2 contributors on non-conflicting tracks).

**First commercial-credible milestone:** End of M5. The platform can demonstrate end-to-end Malaysian bank H2H, ERP outbound, and regulator exchange flows against real simulators, with regulatory evidence packs per customer. M6 is what makes it _production-ready_, not _demo-ready_.

### 3.2 M3 — Security and Trust Controls

**Goal:** Close every finding in the acceptance register that was deferred to M3 gate. Remove "application-layer isolation" as a compensating control — it becomes defence-in-depth, with the structural control living in Postgres RLS and Vault custody.

**Scope (in):**

- DB-RLS on every tenant-scoped table (18 models, ~12 need RLS now). Closes R2-001, R3-001.
- Real Vault custody via custom `undici`-based client + AWS KMS backend stub. Closes R6-001.
- Audit writes in transactions with state changes (`$transaction` wrapping). Closes R2-002, R4-003.
- MFA (TOTP), refresh-token rotation, login lockout. Closes R3-002, R3-004.
- 90-day key expiry tier alongside existing 30/7-day. Closes R6-003.
- Rate limiting (`@nestjs/throttler` + `@fastify/rate-limit`). Closes OWASP API4 requirement.
- Error sanitization — strip sensitive fields from client responses. Closes CLAUDE.md §M3.7 requirement.
- Immutable audit chain hardening (append-only DB trigger on `audit_events`). Partial R2-004.
- All 14 threat-scenario tests (CLAUDE.md §M3.7). Blocking exit criterion.
- OTEL tracer initialization in both `main.ts` files. Closes part of NEW-08.
- URI-based API versioning (`/api/v1/*`). Closes NEW-06.
- Partner config Zod validation at profile load (NEW-04).
- Per-operation crypto timeouts (NEW-03).
- Retry jitter (NEW-02).
- SSRF validator DNS-rebinding hardening (NEW-01) — pin IP on socket or re-resolve immediately pre-connect.

**Scope (out — explicit):**

- Real SFTP/HTTPS transport (M3.5)
- Real object storage (M3.5)
- Metrics HTTP endpoint exposure (M4)
- Runbooks (M5)
- Regulatory control matrices (M5)

**Exit criteria:**

- Hostile-audit role R2 (database), R3 (application security), R6 (cryptographic implementation) all move from FAIL → PASS under re-audit.
- 14/14 threat scenario tests pass; each explicitly mapped to a CWE and a remediation.
- Zero `as unknown as` casts in controller and service runtime code (processor-layer remains).
- Cross-tenant negative test: when `.forTenant()` is intentionally omitted from a query, the database returns zero rows (not cross-tenant data).
- Key rotation E2E: rotate key, old ciphertext still decrypts (dual-key overlap window), new ciphertext uses new key, all audited.
- MFA required for all Platform Super Admin and Security Admin actions. Configurable for other roles at tenant level.

**Decision points to resolve at M3 start** (convert outline → detailed plan at this boundary):

- D-M3-1: Vault HA topology for production — single leader vs Raft cluster (default: Raft, 3-node, Consul-less)
- D-M3-2: RLS policy model — strict `USING` + `WITH CHECK` on every table, or simpler `USING`-only with app-layer insert validation
- D-M3-3: Refresh token storage — Redis (fast, lossy-on-restart) vs Postgres (durable, slower)
- D-M3-4: MFA secret storage — encrypted at rest with AES-GCM using per-tenant KEK, or stored in Vault transit
- D-M3-5: Lockout thresholds — 5 failed attempts / 15-min window / 30-min lockout? (OWASP baseline; confirm)

**Findings closed:** R2-001, R2-002, R3-001, R3-002, R3-004, R4-001, R4-002 (full), R4-003, R4-008, R6-001, R6-003, NEW-01, NEW-02, NEW-03, NEW-04, NEW-06, NEW-07 (gating), partial NEW-08.

**Risk flags:**

- RLS rollout is irreversible without data migration. Dry-run on staging first.
- Vault integration has a blast radius — a Vault outage in M3+ stops all crypto operations. Document failure modes before go-live (M6 runbook).
- MFA rollout for existing users requires enrollment flow; no existing users in Phase 1 so clean enrollment on first login.

### 3.3 M3.5 — Data Plane Reality (NEW — inserted into roadmap)

**Goal:** Unstub the three STUB capabilities that PLANS.md does not explicitly schedule but that M5's E2E tests silently depend on: SFTP transport, HTTPS transport, object storage. **Without M3.5, M5 passes against the same stubs it passes against today.**

**Scope (in):**

- Real `ssh2-sftp-client` wiring in `SftpConnector`. Host key verification. Credential rotation hook. Timeout per operation. Connection pool with idle eviction.
- Real HTTPS client in `HttpsConnector` using `undici`. mTLS support. Redirect limit = 0 (prevent SSRF via redirect chain). TLS ≥ 1.2 enforced. Custom root CA support for partner-issued certs.
- `@aws-sdk/client-s3` wired in `ObjectStorageService`. `InMemoryObjectStorageService` retained for unit tests only. Pre-signed URL generation for large-file inbound.
- MinIO test fixture via testcontainers for integration tests.
- Mock SFTP server via testcontainers (`atmoz/sftp` or similar) for CI.
- Mock HTTPS partner via MSW.
- End-to-end roundtrip test: submit → encrypt → SFTP-send → partner-ack → inbound decrypt → customer webhook. All with real binaries, not stubs.
- Callback receive endpoint added to control-plane routing (HTTP). Closes capability "Callback receive / fetch" ABSENT in forensic coverage matrix.
- Metadata + pre-signed upload API endpoint. Closes same-named ABSENT capability.
- API versioning (URI-prefix) applied consistently — if deferred from M3 per sequencing decision.

**Scope (out):**

- Operator console screens (M4)
- Regulatory-specific encoders (M5)
- Throughput-focused performance tuning (M6)
- AS2 protocol (permanently deferred in Phase 1; may re-enter in Phase 2)

**Exit criteria:**

- One full round-trip test in CI, against real MinIO + mock SFTP + mock HTTPS, decrypting actual payload bytes from object storage (not reference strings). Proves transport stubs are gone.
- Forensic coverage matrix recomputed: zero STUB entries in `transport`, `exchange_engine` (except "Customer-side agent" which remains deferred), and `api` rows.
- Connection-pool leak test: 1000 sequential SFTP sends do not exhaust file descriptors.
- SSRF test: attempt to deliver to `169.254.169.254` (IMDS), private IP, localhost — all blocked by endpoint validator.
- TLS test: attempt TLS 1.0/1.1 connection — refused.

**Decision points:**

- D-M3.5-1: SFTP authentication — password vs key-based vs SSH certificate. Default: key-based, with password path gated by partner profile flag.
- D-M3.5-2: Pre-signed URL expiry — 15 min vs 1 hour. OWASP-leaning: 15 min.
- D-M3.5-3: Partner profile credential storage — inline encrypted vs Vault transit. Default: Vault transit.

**Findings closed:** All transport STUB findings (forensic coverage matrix); "Metadata + pre-signed upload" ABSENT; "Callback receive / fetch" ABSENT; "API versioning" ABSENT (if rolled here).

### 3.4 M4 — Operator Console + Workflow

**Goal:** Ship the Next.js operator console with all 9 screens from `CLAUDE.md` §M4.3. Expose metrics HTTP endpoints on both control-plane and data-plane (closes R7-001 finally).

**Scope (in):**

- Next.js 14 + Tailwind + shadcn/ui per CLAUDE.md M4.1–M4.2
- NextAuth.js with role-aware session
- All 9 screens from CLAUDE.md §M4.3
- Evidence pack export (JSON download from audit view)
- Submission status timeline component
- Dual-control approval UI (no longer API-only)
- Test-vs-production visual distinction (orange banner + tinted chrome in test)
- Metrics endpoint on control-plane (`/metrics` — Fastify native route)
- Metrics endpoint on data-plane (lightweight Fastify/Express alongside the BullMQ worker context, or a dedicated metrics-only entry point)
- Cyber Security Act 2024 incident reporting workflow UI (closes R8-001 non-code portion — requires owner assigned before M4 starts)

**Scope (out):**

- White-label branding (OD-004, deferred — founder/commercial decision)
- Role-based UI customization beyond CLAUDE.md spec
- Mobile app

**Exit criteria:**

- All 9 screens functional end-to-end against M3 + M3.5 backend
- Role enforcement: each role sees only its controls (tested per role × screen matrix)
- Audit/timeline views immutable (no UI path to edit)
- Prometheus scrape targets green for both services
- Incident reporting form captures NCII applicability decision and auto-generates statutory reporting-deadline timer

**Findings closed:** R7-001 (metrics exposed), R8-001 (workflow UI — decision owner still required externally).

### 3.5 M5 — Partner Packs + Regulatory Evidence

**Goal:** Generic (non-production-specific) profiles for bank H2H, regulator/API, and ERP flows. Regulatory evidence matrices for BNM RMiT, PDPA, LHDN e-Invoice, Cyber Security Act 2024.

**Scope (in):**

- Generic bank H2H profile fixture + loader
- Generic regulator/API profile fixture + loader
- Generic ERP source profile fixture + loader
- OpenPGP interop matrix: test against GnuPG, Sequoia-PGP reference implementations (not just self-roundtrip)
- All 4 outbound + 1 inbound E2E scenarios per PLANS.md M5.6–M5.9
- Negative scenario tests per M5.10
- BNM RMiT requirement-to-control-to-evidence matrix (`docs/compliance/bnm-rmit-matrix.md` + CSV)
- PDPA data inventory (every PII-bearing field mapped; erasure workflow defined)
- PDPA cross-border transfer control documentation
- LHDN e-Invoice: digital certificate import support + conformance test OR explicit out-of-scope statement + customer control boundary document (OD-005 equivalent decision)
- Runbooks per PLANS.md M6.9–M6.15 **pulled forward to M5** (forensic report flagged runbooks as M5 scope despite PLANS.md showing M6)

**Scope (out):**

- SLOs (M6)
- Alert rules (M6)
- Load testing (M6)
- Real bank/regulator production onboarding (post-Phase-1 commercial)

**Exit criteria:**

- `docs/compliance/` tree contains: `bnm-rmit-matrix.csv`, `pdpa-data-inventory.csv`, `pdpa-cross-border-controls.md`, `lhdn-einvoice-scope.md`, `csa-2024-incident-reporting.md`
- Every CRITICAL/HIGH control in BNM RMiT matrix has a linked evidence artefact (test ID, log query, dashboard panel, or runbook step)
- OpenPGP interop: encrypt with openpgp.js → decrypt with GnuPG succeeds; same with Sequoia
- All 9 runbooks peer-reviewed and checked into `docs/runbooks/`
- Grep confirms no hard-coded bank/regulator parameters in source (CLAUDE.md M5.11)

**Decision points at M5 start:**

- D-M5-1: LHDN e-Invoice — implement or scope-out? (R8-004 open; customer demand determines)
- D-M5-2: Runbooks — adopt SRE incident severity framework (P1/P2/P3/P4) or BNM RMiT severity classifications or hybrid
- D-M5-3: Evaluate Temporal adoption (decision gate per §2.5)

**Findings closed:** R7-003, R8-002, R8-003, R8-004 (or formally scoped out), R2-004 full.

### 3.6 M6 — Operational Hardening

**Goal:** Production-ready posture. SLOs, alerting, SBOM signing + provenance, DR drill, load-tested.

**Scope (in):**

- Prometheus metrics instrumentation completeness audit (per CLAUDE.md §4 P1/P2/P3 conditions)
- Grafana dashboards: submission, delivery, crypto, queue, audit, key-lifecycle
- Prometheus alert rules per CLAUDE.md §4 severity matrix
- SLO definitions + error budgets + burn-rate alerts
- Load tests: 100 concurrent, large file (1GB+), spike (10× baseline), soak (24h)
- Postgres backup + restore drill (documented artefact)
- Redis RDB + AOF verification drill
- MinIO/S3 versioning verification
- Remaining runbooks (if any deferred from M5)
- SBOM signing (cosign) + SLSA Level 2+ provenance attestation (closes R5-003 full, R1-002)
- Artefact integrity verification in CI (SHA256SUMS + cosign verify)
- Container image scanning gate (Trivy or Grype)
- Threat model refresh with post-M3.5/M4 surface
- Penetration test scoping document (external engagement recommended before GA)
- Terraform (or chosen IaC) modules for target cloud (OD-001 resolution required before M6)
- Disaster recovery plan — RPO/RTO targets per tier (STANDARD vs DEDICATED vs PRIVATE)

**Exit criteria:**

- All SLO targets met in load test
- All alert rules fire under fault injection
- Recovery procedures exercised end-to-end
- No data loss observed in spike test
- SBOM artefact signed with cosign; provenance attestation verifiable via `cosign verify-attestation`
- Container images digest-pinned in all compose and IaC files
- External pen-test report received and CRITICAL/HIGH findings either closed or on an acceptance register

**Decision points at M6 start:**

- D-M6-1: Cloud provider (OD-001) — AWS vs Azure vs GCP. Required decision.
- D-M6-2: Multi-region (OD-003) — single-region first (recommended) vs multi-region from day one.
- D-M6-3: Pen-test vendor selection.

**Findings closed:** R1-002, R5-003 (full), R7-002, ADR-0005 re-evaluations (Biome, Effect-TS, Temporal).

---

## 4. Cross-cutting specifications

### 4.1 API surface (OpenAPI 3.1, target state at M3.5 close)

**Minimum API set** (from blueprint §12.1, refined):

| Endpoint                            | Method    | Purpose                                     | Introduced                |
| ----------------------------------- | --------- | ------------------------------------------- | ------------------------- |
| `/api/v1/submissions`               | POST      | Submit payload (inline, small)              | M1 (URI version added M3) |
| `/api/v1/submissions/upload-url`    | POST      | Request pre-signed URL for large payload    | M3.5                      |
| `/api/v1/submissions/:id`           | GET       | Status                                      | M1                        |
| `/api/v1/submissions/:id/timeline`  | GET       | Event timeline                              | M1                        |
| `/api/v1/submissions`               | GET       | List (paginated, filtered)                  | M1                        |
| `/api/v1/callbacks/:profileId`      | POST      | Callback receive                            | M3.5                      |
| `/api/v1/partner-profiles`          | CRUD      | Profile management                          | M1 (Zod-swap M3.0)        |
| `/api/v1/key-references`            | CRUD      | Key inventory                               | M1                        |
| `/api/v1/approvals`                 | GET, POST | Dual-control queue + action                 | M1                        |
| `/api/v1/audit-events`              | GET       | Audit search (ComplianceReviewer role)      | M1                        |
| `/api/v1/tenants`                   | CRUD      | Tenant admin (PlatformSuperAdmin)           | M1                        |
| `/api/v1/auth/login`                | POST      | Password + MFA                              | M3 (MFA added)            |
| `/api/v1/auth/refresh`              | POST      | Refresh token                               | M3                        |
| `/api/v1/auth/mfa/enroll`           | POST      | TOTP enrollment                             | M3                        |
| `/api/v1/health`, `/live`, `/ready` | GET       | Liveness / readiness (public)               | M1                        |
| `/metrics`                          | GET       | Prometheus scrape (gated by network policy) | M4                        |

**Design principles:**

- URI-based versioning (`/api/v1/*`). Header-based rejected — harder to cache, harder to observe, harder to deprecate.
- Idempotency: every state-changing request carries `Idempotency-Key` header or a body-level `idempotencyKey` field. Enforced via `@@unique([tenantId, idempotencyKey])` in schema (already present per forensic report §3.3).
- Every response carries `x-correlation-id`. Clients should propagate on follow-up requests.
- Errors are classified per the error taxonomy (§4.5). Never leak Prisma/DB errors.
- Pagination: cursor-based (not offset) for audit and submission lists. Max page size 100 (already enforced).
- Rate limits: per-IP, per-API-key, per-tenant. Headers: `x-ratelimit-remaining`, `x-ratelimit-reset`.

**OpenAPI 3.1 spec generation:** Via `nestjs-zod` + `@nestjs/swagger` (wired in M3.0). Served at `/api/docs` in dev, gated off in prod (use API gateway or external doc portal).

Full `openapi.yaml` will be generated as a build artefact in CI from M3.0 onward. It is not hand-written.

### 4.2 Event schema

CloudEvents 1.0 envelope for all internal events. Three event families:

**Audit events** (persisted to `audit_events`, hash-chained):

```json
{
  "specversion": "1.0",
  "id": "<uuid>",
  "source": "sep.control-plane.submissions",
  "type": "sep.submission.created",
  "subject": "submissions/<id>",
  "time": "2026-04-17T10:00:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "tenantId": "<uuid>",
    "actorId": "<uuid>",
    "actorType": "user|service|system",
    "action": "CREATE",
    "result": "SUCCESS|FAILURE",
    "resourceId": "<id>",
    "resourceType": "submission",
    "metadata": { ... }
  },
  "sep_hash_chain": {
    "previousHash": "<sha256>",
    "currentHash": "<sha256>"
  }
}
```

**Submission lifecycle events** (emitted to internal bus, not audit):

```
sep.submission.received
sep.submission.validated
sep.submission.encrypted
sep.submission.delivered
sep.submission.acknowledged
sep.submission.failed
```

**Key lifecycle events:**

```
sep.key.registered
sep.key.activated
sep.key.rotated
sep.key.suspended
sep.key.expired
sep.key.revoked
sep.key.destroyed
```

All event types are strongly typed via Zod schemas in `packages/schemas/src/events/`. Gap today: this directory doesn't exist. Create in M3.

### 4.3 Audit log schema (hash-chain design)

**Already implemented** per forensic report §3.1 and `audit.service.test.ts`. Documenting here for completeness.

Each `audit_events` row carries:

- `immutable_hash` = SHA-256 of (`tenant_id || actor_id || action || result || event_time || previous_hash`)
- `previous_hash` = hash from the prior event for the same tenant (or genesis hash for first event)

Chain integrity verified by walking the chain from genesis. Break in chain indicates tampering.

**Gap (M3 work):** Append-only enforcement at DB level — `REVOKE UPDATE, DELETE ON audit_events FROM sep_app` and a migration preventing ALTER. ADR-accepted in PLANS.md; wire in M3.

### 4.4 Key lifecycle state machine

**Already implemented** (10 states, per forensic report §3.2):

```
DRAFT → PENDING_APPROVAL → ACTIVE → ROTATING → ACTIVE'
                                ↓
                          SUSPENDED → ACTIVE
                                ↓
                          EXPIRED / COMPROMISED / REVOKED → DESTROYED
```

**Gaps (M3 work):**

- 90-day expiry alert tier (currently 30/7 only) — R6-003
- Rotation workflow with dual-key overlap window — PLANS.md M3.2/M3.3 not started
- Scheduled expiry scan job (daily) — PLANS.md M3.4 not started
- Integration with Vault for key storage — PLANS.md M3.1 not started

### 4.5 Error taxonomy

**Already implemented** via `SepError` + `ErrorCode` enum in `packages/common/src/errors/`. Forensic report confirms clean posture (no `throw new Error(...)` in apps/packages code).

Classifications (documented for external API consumers):

| Class                  | HTTP | Retryable               | Examples                                         |
| ---------------------- | ---- | ----------------------- | ------------------------------------------------ |
| `VALIDATION_ERROR`     | 400  | No                      | Zod parse failure                                |
| `AUTHENTICATION_ERROR` | 401  | No                      | Missing/invalid token                            |
| `AUTHORIZATION_ERROR`  | 403  | No                      | RBAC/BOLA denial                                 |
| `NOT_FOUND`            | 404  | No                      | Resource doesn't exist in tenant                 |
| `CONFLICT`             | 409  | No                      | Idempotency key collision with different payload |
| `RATE_LIMITED`         | 429  | Yes (after retry-after) | Throttler triggered                              |
| `PARTNER_ERROR`        | 502  | Yes                     | SFTP timeout, HTTPS 5xx from partner             |
| `TRANSIENT_ERROR`      | 503  | Yes                     | Queue full, Redis unavailable                    |
| `INTERNAL_ERROR`       | 500  | Maybe                   | Uncaught; sanitized in production                |

Client-facing responses never leak internal structure. Error IDs (`errorId`) link responses to detailed server logs for support triage.

### 4.6 Control-to-evidence mapping (portfolio level)

See `_plan/control_mapping.csv` for the full finding × milestone × evidence matrix. Portfolio summary:

| Control theme          | Milestones | Evidence artefact                                                     |
| ---------------------- | ---------- | --------------------------------------------------------------------- |
| Identity & access      | M3         | RBAC matrix test suite, auth integration tests                        |
| Tenant isolation       | M3         | RLS policy test matrix, cross-tenant negative tests                   |
| Key management         | M3         | Vault integration tests, rotation E2E test, expiry scan job log       |
| Transport security     | M3.5       | SFTP host-key tests, mTLS tests, TLS floor tests                      |
| Payload integrity      | M3.5       | SHA-256 verification test, signature verification test                |
| Operational resilience | M6         | Load test report, DR drill log, retry/DLQ tests                       |
| Data protection        | M3 + M5    | Retention job logs, erasure workflow test, residency enforcement test |
| Audit & evidence       | M3 + M4    | Hash chain test, append-only test, evidence pack export test          |
| Regulatory             | M5         | BNM/PDPA/LHDN matrices, incident reporting workflow test              |
| Supply chain           | M3.0 + M6  | SBOM, provenance, signature verification                              |

---

## 5. Test strategy (portfolio level)

### 5.1 Coverage targets (per layer)

| Layer                | Line % | Branch % | Current              | Target by M6 |
| -------------------- | ------ | -------- | -------------------- | ------------ |
| `packages/crypto`    | 80     | 80       | enforced 80/80/50/80 | 90/90/75/90  |
| `packages/db`        | 60     | 60       | enforced 40/60/75/40 | 75/75/75/75  |
| `packages/common`    | 75     | 75       | enforced 50/75/85/50 | 85/85/85/85  |
| `apps/control-plane` | 75     | 70       | enforced 45/55/70/45 | 75/70/85/75  |
| `apps/data-plane`    | 70     | 65       | enforced 20/15/15/20 | 70/65/75/70  |

Current thresholds (per forensic §6.1) are intentionally low-floor; ratcheting up in M3, M3.5, M6 is part of the plan.

### 5.2 Test categories

**Unit tests (Vitest 3):** Already 289 across 30 files. Target 400+ by M6 with no loss of coverage.

**Integration tests (Vitest + testcontainers, M3.5):** Real Postgres + Redis per test group. Replaces `docker-compose.test.yml` shared-instance pattern.

**Contract tests (MSW, M3.5):** External partner endpoints mocked. No Pact — wrong tool for external contracts.

**OpenPGP interop tests (M5):** Encrypt with openpgp.js → decrypt with GnuPG (subprocess). Same with Sequoia-PGP.

**Threat scenario tests (M3, blocking):** All 14 scenarios from CLAUDE.md §M3.7. Each with a CWE mapping, a specific exploit attempt, and a verification that the platform's control blocks it.

**Load tests (M6):** k6 or Artillery. Scenarios: 100 concurrent submissions, 1GB payload, 10× spike, 24h soak.

**Chaos/fault-injection (M6):** Key expiry mid-flow, SFTP timeout, partial upload, duplicate submission, callback replay, Vault outage, Redis outage, Postgres primary failover.

**Security test gates in CI (from M3.0):**

- OSV Scanner (SCA)
- TruffleHog (secret scan)
- gitleaks (local pre-commit)
- Trivy (container images, M6)
- SAST: consider `semgrep` ruleset — evaluated at M3 (decision not yet made)

### 5.3 Specific tests that are ABSENT today and MUST exist by their milestone

Per forensic §6.2:

| Test                                    | Milestone | Blocking exit?    |
| --------------------------------------- | --------- | ----------------- |
| OpenPGP interop against GnuPG/Sequoia   | M5        | Yes               |
| RBAC role × endpoint matrix             | M3        | Yes               |
| Retry/DLQ backoff curve assertion       | M3        | Yes (adds jitter) |
| Contract tests (MSW)                    | M3.5      | Yes               |
| E2E with testcontainers                 | M3.5      | Yes               |
| Mock SFTP / HTTPS / Bank ack simulators | M3.5      | Yes               |
| Load / k6 / chaos                       | M6        | Yes               |
| Threat scenario tests (14)              | M3        | Yes               |

---

## 6. Deployment & environments

### 6.1 Environment matrix

| Environment | Purpose                 | Tenancy                     | Data                                    |
| ----------- | ----------------------- | --------------------------- | --------------------------------------- |
| `dev`       | Local developer laptops | Single-tenant ephemeral     | Seed fixtures                           |
| `test`      | CI test runs            | Per-test via testcontainers | Generated per test                      |
| `cert`      | Partner certification   | Real partner sandbox creds  | Synthetic customer data                 |
| `staging`   | Pre-prod, prod-parity   | Multi-tenant                | Shadowed prod structure, synthetic data |
| `prod`      | Customer-facing         | Per tenant-tier config      | Real                                    |

### 6.2 IaC

**Terraform** is the default choice (M6 scope). Modules:

- `modules/postgres` — primary + replicas, extensions (RLS is native)
- `modules/redis` — AOF + RDB
- `modules/s3` — versioning, lifecycle, residency bucket config
- `modules/vault` — HA cluster, auto-unseal, auth-method config
- `modules/k8s-control-plane`, `modules/k8s-data-plane` — workload deployment
- `modules/observability` — Prometheus, Grafana, Alertmanager, OTEL Collector
- `modules/network` — VPC, subnets, SG, VPN / PrivateLink for partner endpoints

**Alternative:** Pulumi (TypeScript-native, fits the monorepo) — evaluated at M6 vs Terraform maturity.

### 6.3 Release strategy

- **Trunk-based** with feature flags for risky changes. No long-lived release branches.
- **Semantic versioning** on public API. Every breaking change bumps major.
- **Canary rollout** for STANDARD tier: 5% → 25% → 100% over 24h.
- **Blue/green** for DEDICATED tier per customer preference.
- **Rollback: one command.** If a release bricks a tenant, revert the deployment, re-run the Postgres migration rollback if needed, incident runbook covers this path.

### 6.4 DR and RPO/RTO

Placeholder targets (finalise at M6):

| Tier      | RPO              | RTO              |
| --------- | ---------------- | ---------------- |
| STANDARD  | 1h               | 4h               |
| DEDICATED | 15min            | 1h               |
| PRIVATE   | per-customer SLA | per-customer SLA |

Backup cadence, replication topology, and failover drills designed at M6.

---

## 7. Open decisions

### 7.1 Closed by this plan (2026-04-17)

| ID  | Question                             | Resolution                                                             |
| --- | ------------------------------------ | ---------------------------------------------------------------------- |
| Q2  | Blueprint precedence                 | §1.2 authority hierarchy                                               |
| Q3  | Acceptance register vs hostile audit | §1.2 — acceptance register governs; audit is evidence                  |
| Q4  | Tenancy model                        | §2.2 — three tiers from one codebase                                   |
| Q6  | Object storage                       | §2.4 — `@aws-sdk/client-s3`, MinIO in dev, S3 in prod                  |
| Q7  | Transport scope                      | §3.3 — M3.5 milestone inserted specifically for this                   |
| Q10 | Test-count discrepancy               | M3.0 §12 — corrected in PLANS.md                                       |
| Q11 | CI pinning policy                    | M3.0 §8.1 — SHA-pin + Dependabot                                       |
| Q12 | Data residency                       | §2.4 + M3.0 §10.3 — `myResidency` tenant flag, default SG, MY when set |

### 7.2 Still open (must resolve at named milestone)

| ID                       | Question                                | Decide by                                                           | Owner                      |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| OD-001                   | Cloud provider                          | M6 start                                                            | Founder                    |
| OD-002                   | Key custody backend selection (refined) | Now superseded by §2.3 three-backend abstraction; per-tenant choice |
| OD-003                   | Multi-region                            | M6 start                                                            | Founder                    |
| OD-004                   | White-label operator console            | M4 start                                                            | Commercial lead            |
| OD-005                   | Billing/entitlement engine              | Post-Phase-1                                                        | Commercial lead            |
| D-M3-1..5                | M3 execution detail                     | M3 start                                                            | Security + platform leads  |
| D-M3.5-1..3              | M3.5 execution detail                   | M3.5 start                                                          | Platform lead              |
| D-M5-1..3                | M5 execution detail                     | M5 start                                                            | Product + compliance leads |
| D-M6-1..3                | M6 execution detail                     | M6 start                                                            | Platform lead + founder    |
| **Regulatory ownership** | Who owns R8-001..004 non-code work      | **Before M4**                                                       | **Founder** (must assign)  |

**Regulatory ownership is the current blocker.** R8-001 (Cyber Security Act 2024 incident reporting) cannot be addressed by code alone. Someone — named human, with title — must be accountable for the statutory reporting-deadline workflow, NCII applicability decisions, and the legal/compliance review of the BNM/PDPA/LHDN matrices. Without this assignment, M4 ships a UI against nobody, and M5 delivers matrices that nobody signed.

---

## 8. Risk register

| #   | Risk                                                                       | Likelihood | Impact                     | Mitigation                                                                                                                                | Owner                | Active in |
| --- | -------------------------------------------------------------------------- | ---------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- |
| 1   | RLS rollout introduces data-access regression                              | Medium     | High                       | Dry-run on staging; cross-tenant negative test suite must pass before enabling in prod                                                    | Platform             | M3        |
| 2   | Vault outage blocks all crypto operations                                  | Medium     | Critical                   | HA topology (Raft 3-node); documented failure mode; cached key material with short TTL                                                    | Security             | M3+       |
| 3   | Solo-author continues through M3 without code review                       | High       | High                       | Establish CODEOWNERS + branch protection before M3 starts; hire or peer-contract a second engineer                                        | Founder              | Now       |
| 4   | Regulatory work deferred indefinitely due to unassigned owner              | High       | Critical (customer-facing) | Assign before M4 or formally scope-out with contract language                                                                             | Founder              | Now       |
| 5   | Dependency upgrades in M3.0 break existing tests                           | Medium     | Medium                     | M3.0 §14 verification checklist; rollback plan in §16                                                                                     | Platform             | M3.0      |
| 6   | M5 E2E tests silently pass against M3.5 stubs that weren't fully unstubbed | Medium     | High                       | M3.5 §3.3 exit criterion requires real round-trip in CI                                                                                   | Platform             | M3.5      |
| 7   | Operator console scope creeps into M4, delays M5                           | Medium     | Medium                     | CLAUDE.md §M4.3 is canonical; new screens require explicit ADR                                                                            | Product              | M4        |
| 8   | Pen-test (M6) surfaces criticals that force re-architecting                | Low        | High                       | Scope pen-test at M5 close, not M6 close; allow M6 schedule buffer                                                                        | Security             | M6        |
| 9   | Commercial timeline pressure forces skipping M5 regulatory work            | Medium     | Critical                   | Regulatory matrices are a contractual deliverable, not a nice-to-have; refuse to sign customer contracts that assume them before M5 close | Founder + commercial | M5        |
| 10  | Cloud provider decision (OD-001) slips past M6 start                       | Medium     | High                       | Force decision at M5 close gate                                                                                                           | Founder              | M5 close  |
| 11  | Vitest 3 migration breaks test discovery, causing silent pass              | Low        | High                       | M3.0 verification: test count must be ≥ 289 baseline                                                                                      | Platform             | M3.0      |
| 12  | AI-assisted development introduces silent regressions not caught by tests  | Medium     | Medium                     | Require CODEOWNERS review for all security-critical paths (`packages/crypto`, `*/guards/*`, `*/audit*`, RLS migrations)                   | Platform             | Always    |

---

## 9. Execution prompts for future Claude Code sessions

### 9.1 M3.0 execution (ready now)

```
Read /_plan/M3_0_FOUNDATION_RESET.md in full.
Execute it per §17 "Execution prompt for Claude Code" in that document.
Produce /_plan/M3_0_HANDOFF.md on completion.
```

### 9.2 M3 detailed-planning (run after M3.0 handoff)

```
M3.0 is complete. Handoff note is at /_plan/M3_0_HANDOFF.md.
Your task: produce /_plan/M3_EXECUTION_PLAN.md.

Inputs:
- /_plan/IMPLEMENTATION_PLAN.md §3.2 (M3 roadmap-mode)
- /_plan/M3_0_HANDOFF.md (what actually landed)
- /_audit/findings.json (findings to close in M3, filtered by milestone='M3 gate')
- /_audit/control_mapping.csv (finding → evidence linkage)
- CLAUDE.md §M3 (milestone intent)
- PLANS.md Formal Acceptance Register rows targeted at M3

Output shape: match the depth and structure of /_plan/M3_0_FOUNDATION_RESET.md.
Every task must have:
  - Task ID (M3-Tnn)
  - Affected paths (new or existing)
  - Acceptance criteria (testable bullets)
  - Test strategy (unit/integration/interop/e2e/threat)
  - Security mapping (OWASP API Top 10 2023 category + CWE)
  - Evidence artefact produced
  - Effort estimate (S/M/L/XL in eng-days)

Decision points D-M3-1..5 must be resolved before the plan is finalised. If any
cannot be resolved, document why and flag it for founder decision.

Do NOT begin M3 execution. This is a planning artefact only.
```

### 9.3 M3 execution (after §9.2 produces the execution plan)

```
Read /_plan/M3_EXECUTION_PLAN.md. Execute per its §X (execution prompt).
Branch: m3/security-and-trust.
Commits: per task (M3-T01, M3-T02, ...).
Produce /_plan/M3_HANDOFF.md on completion.
```

### 9.4 Subsequent milestones

Repeat the §9.2 + §9.3 pattern for M3.5, M4, M5, M6. Each milestone produces:

- `_plan/Mx_EXECUTION_PLAN.md` before execution
- `_plan/Mx_HANDOFF.md` after execution

The roadmap in §3 is refined at each boundary if reality diverges from the plan.

---

## 10. Living document policy

This plan is version-controlled at `_plan/IMPLEMENTATION_PLAN.md`. Updates:

- **Minor updates** (typo, link fix, finding status): direct edit, commit prefix `docs(plan):`
- **Scope refinement** (move a task between milestones, add a decision): ADR first, then plan edit referencing the ADR
- **Authority override** (change §1.2 hierarchy, change §2 architecture): requires written rationale; propose as a PR, not a direct edit

Each milestone boundary produces a plan revision (`v1.1`, `v1.2`, ...) recorded in the version line at the top. Rollback to a prior version is always possible via git.

---

**End of Phase 2 Implementation Plan v1.0.**

**Authoring note:** This plan is written against evidence in the forensic audit (2026-04-16) and the user's declared intent to "proceed with complete rigor." It is **not** a contract. Deviations at execution time are expected and managed via the rolling-wave discipline in §1.3. The risk register (§8) is the honest accounting of what could go wrong; the plan's job is not to eliminate those risks but to name them and assign them to owners who can respond.
