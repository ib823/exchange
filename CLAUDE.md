# CLAUDE.md — Malaysia Secure Exchange Platform

# Master execution guide for Claude Code CLI in GitHub Codespace

# Version: 1.0 | Status: AUTHORITATIVE — read this before every session

---

## 0. BEFORE ANYTHING ELSE

You are building a **security-sensitive enterprise platform** for Malaysia.
Priority order (non-negotiable):

1. Security and correctness
2. Deterministic, auditable behavior
3. Explicit configuration — no magic defaults
4. Observability built-in from day one
5. Developer ergonomics
6. Speed

**NEVER:**

- Hard-code cryptographic parameters (they belong in partner profiles)
- Log secrets, private keys, plaintext payloads, or bearer tokens
- Bypass tenant boundary checks
- Implement "best effort" crypto — fail closed always
- Invent bank or regulator requirements
- Write to production without an explicit approval flag

---

## 1. REPOSITORY STRUCTURE

```
secure-exchange-platform/
├── CLAUDE.md                   ← this file
├── AGENTS.md                   ← agent rules (from implementation pack)
├── PLANS.md                    ← milestone tracker (update after each milestone)
├── package.json                ← pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json                  ← Turborepo pipeline
├── tsconfig.base.json          ← shared TS config
├── .eslintrc.base.js           ← shared ESLint config
├── .env.example                ← all required env vars documented
├── docker-compose.yml          ← local infra (postgres, redis, minio, vault)
├── docker-compose.test.yml     ← test infra (isolated ports)
│
├── apps/
│   ├── control-plane/          ← NestJS REST API (tenant, profiles, submissions, keys)
│   ├── data-plane/             ← NestJS workers (crypto, transport, retries)
│   └── operator-console/       ← Next.js 14 admin UI
│
├── packages/
│   ├── common/                 ← shared types, errors, constants
│   ├── schemas/                ← Zod schemas shared across all apps
│   ├── crypto/                 ← OpenPGP service boundary (openpgp.js wrapper)
│   ├── partner-profiles/       ← profile loader, validator, registry
│   ├── observability/          ← OpenTelemetry setup, Pino logger factory
│   └── db/                     ← Prisma schema + migrations + client factory
│
├── infra/
│   ├── terraform/              ← cloud-ready IaC modules
│   └── k8s/                    ← Kubernetes manifests (optional Phase 1)
│
├── docs/                       ← all spec docs from implementation pack
├── adr/                        ← Architecture Decision Records
├── api/                        ← OpenAPI specs
└── tests/
    ├── e2e/                    ← end-to-end test suites
    ├── simulators/             ← mock SFTP, HTTPS, bank ack simulators
    └── fixtures/               ← shared test fixtures and golden files
```

---

## 2. TECH STACK DECISIONS (LOCKED)

| Concern                  | Choice                               | Rationale                                |
| ------------------------ | ------------------------------------ | ---------------------------------------- |
| Language                 | TypeScript 5.x                       | Type safety across all boundaries        |
| Monorepo                 | pnpm workspaces + Turborepo          | Fast incremental builds, cache           |
| Control plane framework  | NestJS 10                            | Enterprise patterns, DI, OpenAPI, guards |
| Data plane framework     | NestJS 10 + BullMQ                   | Worker queues, retry, dead-letter        |
| Operator console         | Next.js 14 (App Router) + shadcn/ui  | Server components, role-aware UI         |
| Database ORM             | Prisma + PostgreSQL 16               | Type-safe, migrations, multi-tenant      |
| Queue / cache            | Redis 7 + BullMQ                     | Reliable job queues, delayed retry       |
| Object storage           | MinIO (local) / S3-compatible (prod) | Payload artifacts, encrypted at rest     |
| Cryptography             | openpgp.js (RFC 9580)                | Maintained, auditable, no custom crypto  |
| SFTP transport           | ssh2-sftp-client                     | Mature, supports host verification       |
| Secret management        | HashiCorp Vault (local dev)          | KMS-agnostic abstraction layer           |
| Schema validation        | Zod (shared across all layers)       | Runtime + compile-time safety            |
| Structured logging       | Pino + pino-pretty                   | JSON, fast, redaction support            |
| Tracing                  | OpenTelemetry SDK                    | Vendor-neutral, correlation IDs          |
| Metrics                  | prom-client + Prometheus             | Scrape-ready metrics                     |
| Testing — unit/component | Vitest                               | Fast, TS-native                          |
| Testing — API            | Supertest + @nestjs/testing          | Contract-safe API tests                  |
| Testing — contract       | Pact                                 | Consumer-driven contract testing         |
| Testing — E2E            | Testcontainers + Vitest              | Real infra, isolated                     |
| Auth                     | JWT (access) + API Keys              | Service-to-service + client auth         |
| CI/CD                    | GitHub Actions                       | Codespace-native                         |
| IaC                      | Terraform + Docker Compose           | Local and cloud parity                   |

---

## 3. ENVIRONMENT VARIABLES REQUIRED

Every service reads from typed config objects. Never access `process.env` directly in business logic.

```bash
# Database
DATABASE_URL=postgresql://sep:sep@localhost:5432/sep_dev
DATABASE_TEST_URL=postgresql://sep:sep@localhost:5433/sep_test

# Redis
REDIS_URL=redis://localhost:6379

# MinIO / S3
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET_PAYLOADS=sep-payloads

# Vault
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-root-token

# JWT
JWT_SECRET=change-this-in-production-minimum-32-chars
JWT_EXPIRY=15m
REFRESH_TOKEN_SECRET=change-this-too

# Service auth (control-plane → data-plane)
INTERNAL_SERVICE_TOKEN=internal-service-secret

# Environment
NODE_ENV=development
APP_ENV=dev
LOG_LEVEL=debug

# Operator console
NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## 4. MILESTONE EXECUTION PLAN

### M0: Repository Bootstrap

**Exit criteria:** `pnpm install && pnpm build && pnpm test` all green. Docker Compose infra starts clean.

```bash
# Step M0.1 — Initialize monorepo
corepack enable
corepack prepare pnpm@latest --activate
pnpm init
pnpm add -Dw turbo typescript @types/node tsup

# Step M0.2 — Create workspace config
# Create pnpm-workspace.yaml, turbo.json, tsconfig.base.json

# Step M0.3 — Scaffold all apps and packages
for dir in apps/control-plane apps/data-plane apps/operator-console; do mkdir -p $dir; done
for pkg in packages/common packages/schemas packages/crypto packages/partner-profiles packages/observability packages/db; do mkdir -p $pkg; done

# Step M0.4 — Initialize each package with package.json
# Each package: "name": "@sep/<name>", "main": "dist/index.js", "types": "dist/index.d.ts"

# Step M0.5 — Create Docker Compose infra
# docker-compose.yml: postgres:16, redis:7, minio:latest, vault:dev

# Step M0.6 — GitHub Actions CI
# .github/workflows/ci.yml: install, lint, test, build

# Step M0.7 — ESLint + Prettier baseline
pnpm add -Dw eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier

# Step M0.8 — Start infra and verify
docker compose up -d
pnpm test
```

**Packages to create in M0:**

- `packages/common`: shared error classes, status enums, constants
- `packages/schemas`: Zod schemas for all domain entities (copy from data model spec)
- `packages/observability`: Pino logger factory with redaction, OTEL setup stub
- `packages/db`: Prisma schema, client singleton, migrations folder

---

### M1: Domain and Control Plane Baseline

**Exit criteria:** OpenAPI implemented, contract tests green, DB migrations run, sample data loads.

```bash
# Step M1.1 — Prisma schema (packages/db)
# Implement ALL entities from docs/05_DATA_MODEL.md:
# Tenant, User, RoleAssignment, PartnerProfile, Submission,
# DeliveryAttempt, InboundReceipt, KeyReference, AuditEvent, Incident

# Step M1.2 — Run first migration
cd packages/db
pnpm prisma migrate dev --name init
pnpm prisma generate

# Step M1.3 — NestJS control plane (apps/control-plane)
pnpm create nest apps/control-plane
# Modules to implement:
# - TenantsModule (CRUD, tier management)
# - PartnerProfilesModule (DRAFT → PROD_ACTIVE state machine)
# - SubmissionsModule (create, status, timeline)
# - KeyReferencesModule (inventory, metadata, lifecycle)
# - IncidentsModule (create, triage, resolve)
# - AuthModule (JWT, API key guards, RBAC decorators)
# - AuditModule (append-only event writer, search)
# - WebhooksModule (register, validate, dispatch)
# - HealthModule (liveness, readiness)

# Step M1.4 — Implement OpenAPI from api/openapi.yaml
# Use @nestjs/swagger decorators on all controllers
# Generate spec and validate against api/openapi.yaml

# Step M1.5 — RBAC enforcement
# Implement roles from docs/06_RBAC_WORKFLOWS.md:
# PlatformSuperAdmin, TenantAdmin, SecurityAdmin,
# IntegrationEngineer, OperationsAnalyst, ComplianceReviewer

# Step M1.6 — Contract tests
pnpm add -Dw @pact-foundation/pact
# Write consumer contracts for each API endpoint

# Step M1.7 — Seed data
# Create seed.ts: 1 tenant, 1 of each user role, sample partner profile
pnpm prisma db seed
```

**Key implementation rules for M1:**

- Every controller action must verify tenant ownership of every object
- AuditEvent must be written for EVERY state-changing operation
- Partner profile state machine: DRAFT → TEST_READY → TEST_APPROVED → PROD_PENDING_APPROVAL → PROD_ACTIVE → SUSPENDED → RETIRED
- Submission status: RECEIVED → VALIDATED → QUEUED → PROCESSING → SECURED → SENT → ACK_PENDING → ACK_RECEIVED → COMPLETED | FAILED_RETRYABLE | FAILED_FINAL | CANCELLED
- KeyReference state: DRAFT → IMPORTED → VALIDATED → ACTIVE → ROTATING → EXPIRED → REVOKED → RETIRED

---

### M2: Data Plane and Transport Baseline

**Exit criteria:** End-to-end mocked delivery works, evidence chain complete, retry/failure states tested.

```bash
# Step M2.1 — BullMQ queue setup (apps/data-plane)
pnpm add bullmq ioredis

# Queues to implement (from docs/02_ARCHITECTURE_SPEC.md):
# submission.accepted, delivery.requested, delivery.completed,
# delivery.failed, inbound.received, status.normalized,
# incident.created, key.rotation.pending, key.rotation.completed

# Step M2.2 — Intake worker
# - Validate submission against partner profile
# - Apply schema validation
# - Generate normalized_hash (SHA-256 of payload)
# - Check idempotency key against database
# - Emit submission.accepted

# Step M2.3 — Crypto service boundary (packages/crypto)
pnpm add openpgp
# Implement CryptoService with methods:
# - encrypt(payload, recipientPublicKey, options): Promise<EncryptResult>
# - decrypt(ciphertext, privateKey, passphrase): Promise<DecryptResult>
# - sign(payload, signingKey, passphrase): Promise<SignResult>
# - verify(payload, signature, senderPublicKey): Promise<VerifyResult>
# - signAndEncrypt(...): Promise<SignEncryptResult>
# ALL operations: log event metadata, NEVER log key material or payload content

# Step M2.4 — Transport adapters
pnpm add ssh2-sftp-client node-fetch
# SftpConnector: connect, upload, poll, download, disconnect with retry
# HttpsConnector: mTLS, token auth, request/response capture
# ConnectorFactory: returns correct connector from partner profile transportProtocol

# Step M2.5 — Retry engine
# Exponential backoff with jitter
# Max attempts configurable per partner profile
# Dead-letter queue for FAILED_FINAL
# All retry events appended to audit stream

# Step M2.6 — Inbound handler
# Poll or receive from partner SFTP/HTTPS
# Verify signature if required by profile
# Decrypt if required by profile
# Correlate to original submission via correlation_id
# Update submission status
# Emit callback if webhook registered

# Step M2.7 — Simulators (tests/simulators)
# MockSftpServer: accepts connection, stores files, sends ack
# MockHttpsServer: accepts POST, validates headers, returns configurable response
# BankAckSimulator: generates realistic acknowledgement files
```

**Key implementation rules for M2:**

- Crypto failures MUST transition submission to FAILED_FINAL immediately (no retry)
- Transport failures are retryable by default; policy override per profile
- Every delivery attempt writes a DeliveryAttempt record
- Payload content stays in object storage; only refs/hashes in DB
- Worker crashes must not lose in-flight jobs (BullMQ persistent + Redis AOF)

---

### M3: Security and Trust Controls

**Exit criteria:** Threat model reviewed, crypto unit tests green, evidence fully logged.

```bash
# Step M3.1 — Vault integration (packages/crypto)
pnpm add node-vault
# VaultKeyBackend: store/retrieve key material
# Implement KeyCustodyAbstraction: platform-managed | tenant-dedicated | external-KMS
# All key operations go through abstraction — never directly to key material

# Step M3.2 — Key rotation workflow
# KeyReference state machine: ACTIVE → ROTATING → ACTIVE (new version)
# Dual-key overlap window: old key decrypts, new key encrypts/signs
# Rotation events fully audited
# Expiry alerting: job runs daily, alerts on keys expiring within 30 days

# Step M3.3 — Dual control enforcement
# Implement ApprovalWorkflow for sensitive actions (from docs/06_RBAC_WORKFLOWS.md)
# Actions requiring dual control:
#   - Activate production partner profile
#   - Import/activate signing key
#   - Disable verification requirement
#   - Change production transport endpoint

# Step M3.4 — Secret redaction
# Pino redaction config: redact all key paths matching sensitive field names
# Paths: ['*.privateKey', '*.passphrase', '*.apiKey', '*.token', '*.secret', '*.password']
# Error handler strips sensitive fields before returning to client
# Test: verify no sensitive data appears in log output for any operation

# Step M3.5 — Immutable audit event stream
# AuditEvent.immutable_hash: SHA-256 of (tenant_id + actor_id + action + result + event_time + previous_hash)
# Chain integrity: each event includes hash of previous event (merkle-style)
# Append-only enforcement: no UPDATE or DELETE on audit_events table (Postgres row-level security)

# Step M3.6 — OWASP API Security controls (from docs/03_SECURITY_CRYPTO_SPEC.md)
# Broken Object Level Auth: tenant check on EVERY object access
# Rate limiting: @nestjs/throttler per IP and per API key
# Input validation: Zod on all request bodies + file uploads
# Error sanitization: never return raw Prisma/DB errors to client
# API inventory: keep OpenAPI spec in sync, version all endpoints

# Step M3.7 — Threat scenario tests
# Write specific test cases for all 14 threat scenarios from docs/03_SECURITY_CRYPTO_SPEC.md:
# stolen operator credential, mis-routed payload, wrong partner public key,
# expired key, replayed submission, tampered acknowledgement, secret in logs,
# cross-tenant data exposure, unauthorized profile change, malicious connector config
```

---

### M4: Operator Console and Workflow Layer

**Exit criteria:** All screens match docs/06_RBAC_WORKFLOWS.md workflows, role separation enforced.

```bash
# Step M4.1 — Next.js 14 setup (apps/operator-console)
pnpm create next-app apps/operator-console --typescript --tailwind --app
pnpm add -w shadcn-ui @radix-ui/react-* lucide-react

# Step M4.2 — Auth layer
# NextAuth.js with JWT strategy
# Role-aware session: session.user.role, session.user.tenantId
# Middleware: protect all /dashboard/* routes

# Step M4.3 — Screens to implement:
# /dashboard/submissions        - list, filter by status/partner/date, search by ID
# /dashboard/submissions/[id]   - detail, timeline, retry button (OperationsAnalyst)
# /dashboard/partner-profiles   - list, create, state machine UI
# /dashboard/partner-profiles/[id]/activate - dual-control approval flow
# /dashboard/keys               - key references, expiry warnings, rotation
# /dashboard/incidents          - list, triage, assign, resolve
# /dashboard/audit              - immutable audit log search (ComplianceReviewer)
# /dashboard/tenants            - tenant admin (PlatformSuperAdmin only)
# /dashboard/approvals          - pending approval queue

# Step M4.4 — UI rules
# Production vs test environment: visual distinction (orange banner in test)
# Sensitive actions: confirmation modal with before/after diff
# Approval screens: show full diff + approver identity
# Audit/timeline: immutable, read-only, no edit controls
# Role enforcement: hide/disable controls based on session.user.role

# Step M4.5 — Submission status timeline component
# Chronological event display
# Crypto event markers (signed, encrypted, verified, decrypted)
# Delivery attempt timeline with retry counts
# Operator action annotations
# Export to JSON button (evidence pack)
```

---

### M5: Partner Packs

**Exit criteria:** Generic profiles pass outbound/inbound scenarios, no production assumptions in code.

```bash
# Step M5.1 — Generic bank H2H profile (tests/fixtures/profiles)
# Profile: bank-h2h-generic.json
# Transport: SFTP
# Security: sign-then-encrypt (OpenPGP)
# Ack: file-based, inbound polling
# Retry: 3 attempts, exponential backoff

# Step M5.2 — Generic regulator/API profile
# Profile: regulator-api-generic.json
# Transport: HTTPS/REST
# Security: sign (API payload signing)
# Ack: synchronous response + async callback
# Auth: mTLS + API key

# Step M5.3 — Generic ERP source profile
# Profile: erp-source-generic.json
# Transport: HTTPS upload or watched drop-zone
# Security: encrypt outbound, no inbound signing required
# Ack: webhook callback

# Step M5.4 — Outbound scenario tests
# For each profile: submit → validate → encrypt/sign → deliver → receive ack
# Use simulators from M2.7
# Assert: immutable audit chain complete, delivery attempt recorded, status COMPLETED

# Step M5.5 — Inbound scenario tests
# For each profile: receive → verify/decrypt → correlate → status update → callback
# Assert: verification pass/fail correctly handled, status updated, webhook fired

# Step M5.6 — Negative scenario tests (mandatory)
# Wrong key → FAILED_FINAL, audit logged, no retry
# Expired key → FAILED_FINAL with EXPIRED_KEY error code
# Signature mismatch → FAILED_FINAL, security alert
# Duplicate submission → 409, original submission unaffected
# Cross-tenant profile access → 403
# Malformed partner profile → validation error before queue entry
```

---

### M6: Operational Hardening

**Exit criteria:** Reliability targets met in test, recovery documented and exercised.

```bash
# Step M6.1 — Dashboards (Grafana + Prometheus)
# Metrics from docs/08_DEVOPS_ENVIRONMENTS.md:
# submission_throughput, delivery_success_rate by partner profile,
# retry_count, queue_depth, crypto_failure_count,
# rbac_denied_actions, webhook_success_rate

# Step M6.2 — Alert rules
# Stuck job: submission in PROCESSING > 10 min → P2
# Repeated crypto failure: > 3 in 5 min → P1
# Key expiry: < 30 days → P3, < 7 days → P2
# Dead-letter queue depth > 0 → P2
# Partner endpoint consecutive failures → P2

# Step M6.3 — SLO instrumentation
# submission_acceptance_availability (target: 99.9%)
# delivery_processing_latency_p99 (target: < 60s)
# status_query_availability (target: 99.9%)
# incident_detection_latency (target: < 5 min for P1)

# Step M6.4 — Load tests
pnpm add -Dw k6
# Scenarios: 100 concurrent submissions, large file (50MB), spike test

# Step M6.5 — Backup and restore
# Postgres: continuous WAL archiving to object storage
# Redis: RDB snapshots every 15 min + AOF
# MinIO: versioning enabled on payload bucket
# Document restore drill procedure in docs/runbooks/

# Step M6.6 — Runbooks (docs/runbooks/)
# submission-backlog.md
# crypto-failure-triage.md
# partner-endpoint-failure.md
# key-rotation.md
# tenant-onboarding.md
# incident-severity-escalation.md
# backup-restore-drill.md
```

---

## 5. CODING CONVENTIONS

### TypeScript rules

```typescript
// Config — never raw process.env in business logic
import { config } from '@sep/common/config';
const dbUrl = config.database.url; // typed, validated at startup

// Errors — always structured
import { SepError, ErrorCode } from '@sep/common/errors';
throw new SepError(ErrorCode.CRYPTO_KEY_EXPIRED, { keyId, expiredAt });

// Logging — always redact, always structured
import { createLogger } from '@sep/observability';
const logger = createLogger({ service: 'control-plane', module: 'submissions' });
logger.info({ submissionId, tenantId, status }, 'Submission accepted');
// NEVER: logger.info({ payload }) or logger.debug({ privateKey })

// Audit events — always via AuditService, never inline
await this.auditService.record({
  tenantId, actorType, actorId,
  objectType: 'Submission', objectId: submissionId,
  action: 'SUBMISSION_ACCEPTED', result: 'SUCCESS',
  correlationId,
});

// Tenant boundary — ALWAYS verify
async getSubmission(tenantId: string, submissionId: string) {
  const sub = await this.db.submission.findUnique({ where: { id: submissionId } });
  if (!sub || sub.tenantId !== tenantId) throw new ForbiddenException();
  return sub;
}
```

### API response shape

```typescript
// Success
{ data: T, meta?: { page, total, correlationId } }

// Error
{ error: { code: string, message: string, correlationId: string, details?: unknown } }

// Never expose: stack traces, DB errors, internal IDs beyond what's needed
```

### Queue job shape

```typescript
interface SubmissionJob {
  jobId: string; // BullMQ job ID
  correlationId: string; // trace ID
  tenantId: string;
  submissionId: string;
  partnerProfileId: string;
  attempt: number;
  enqueuedAt: string; // ISO 8601
}
// Payload content is NEVER in the job — only references to object storage
```

---

## 6. SECURITY CHECKLIST (run before marking any milestone complete)

- [ ] No secrets or tokens in any source file or test fixture
- [ ] All private key material goes through Vault abstraction only
- [ ] Pino redaction covers all sensitive field names
- [ ] Every API endpoint has tenant ownership verification
- [ ] Audit events written for all state changes
- [ ] AuditEvent.immutable_hash chain is valid
- [ ] RBAC guards present on all sensitive endpoints
- [ ] Rate limiting applied to all public-facing endpoints
- [ ] No raw DB/ORM errors returned to API clients
- [ ] Test and production environments strictly separated
- [ ] Crypto library: openpgp.js only, no custom primitives
- [ ] All crypto failures result in FAILED_FINAL (no silent fallback)
- [ ] Dual-control checks present for high-risk actions

---

## 7. QUALITY GATES (must pass before milestone is marked complete)

```bash
pnpm lint              # zero warnings policy
pnpm typecheck         # strict mode, zero errors
pnpm test:unit         # all pass
pnpm test:contract     # all consumer contracts satisfied
pnpm test:security     # threat scenario tests pass
pnpm build             # all packages build cleanly
pnpm audit             # no critical vulnerabilities
```

---

## 8. DOCUMENTATION DISCIPLINE

After each milestone:

1. Update `PLANS.md` milestone status
2. Update any impacted doc under `docs/`
3. Write an ADR if architecture changed
4. Update `CLAUDE.md` if execution plan changed

---

## 9. IF BLOCKED

When a required decision cannot be made safely:

1. Record the blocker in `PLANS.md` under the milestone
2. State what cannot proceed without the decision
3. Propose 2–3 bounded options
4. Do NOT silently choose one for production-affecting logic
5. Tag the blocker with `[BLOCKED]` in code comments

---

## 10. RUNNING IN CODESPACE

```bash
# First time setup
git clone <repo>
cd secure-exchange-platform
corepack enable
pnpm install
cp .env.example .env
docker compose up -d
pnpm -r run db:migrate
pnpm -r run db:seed

# Development (runs all apps in watch mode)
pnpm dev

# Individual app
pnpm --filter @sep/control-plane dev
pnpm --filter @sep/data-plane dev
pnpm --filter @sep/operator-console dev

# Full test suite
pnpm test

# Generate OpenAPI spec
pnpm --filter @sep/control-plane openapi:generate

# Run specific milestone checks
pnpm run milestone:m0
pnpm run milestone:m1
```

---

## APPENDIX: QUICK REFERENCE — STATUS CODES

| Code                         | Meaning                                          |
| ---------------------------- | ------------------------------------------------ |
| CRYPTO_KEY_EXPIRED           | Key referenced by profile is past expiry         |
| CRYPTO_VERIFICATION_FAILED   | Signature verification failed                    |
| CRYPTO_UNSUPPORTED_ALGORITHM | Algorithm not in approved policy                 |
| TRANSPORT_CONNECTION_FAILED  | Could not connect to partner endpoint            |
| TRANSPORT_AUTH_FAILED        | Partner rejected credentials                     |
| PARTNER_REJECTION            | Partner accepted connection but rejected payload |
| VALIDATION_SCHEMA_FAILED     | Payload did not match declared schema            |
| VALIDATION_DUPLICATE         | Idempotency key already processed                |
| POLICY_ENVIRONMENT_MISMATCH  | Test profile used against production endpoint    |
| RBAC_INSUFFICIENT_ROLE       | Caller role does not permit this action          |
| TENANT_BOUNDARY_VIOLATION    | Object does not belong to caller's tenant        |
| APPROVAL_REQUIRED            | Action requires dual-control approval            |
| KEY_ROTATION_CONFLICT        | Rotation already in progress for this key        |

---

_Confidential — working implementation document — not legal advice — not a substitute for security review or bank onboarding specifications_
