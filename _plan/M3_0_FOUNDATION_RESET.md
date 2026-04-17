# M3.0 — Foundation Reset

**Status:** Ready for execution
**Version:** 1.0 (2026-04-17)
**Owner:** Platform engineering
**Est. duration:** 3–5 engineer-days
**Prerequisite:** M2 closed (PLANS.md) and hostile audit artefacts committed
**Next milestone:** M3 — Security & Trust Controls (detailed plan written _after_ M3.0 lands)

---

## 0. Mission statement

**Swap dependencies and replace auth/validation primitives so that M3 executes against a current, well-maintained, finding-reducing stack. Nothing more.**

M3.0 is a _reset_, not a _build_. It does not close security findings that require architectural change (RLS, Vault, audit coupling, MFA). It closes the findings that are purely dependency-shaped: CI pinning, SCA gate, version drift, deprecated-class-warnings, single-maintainer risk, missing pre-commit hygiene.

If during execution a temptation arises to "also fix X while we're here," the answer is **no**. X goes into M3, M3.5, M4, M5, or M6 per the acceptance register. The discipline of a narrow reset is what makes the rest of the plan tractable.

---

## 1. Non-goals (explicit scope guard)

This milestone does **NOT** do any of the following. Each is deferred to its stated milestone:

| Deferred item                                         | Milestone                 | Finding IDs             |
| ----------------------------------------------------- | ------------------------- | ----------------------- |
| Row-level security on tenant-scoped tables            | M3                        | R2-001, R3-001          |
| Vault integration / real key custody                  | M3                        | R6-001                  |
| Audit write transactional coupling                    | M3                        | R2-002                  |
| MFA, refresh-token rotation, lockout                  | M3                        | R3-002, R3-004          |
| 90-day key expiry tier                                | M3                        | R6-003                  |
| Threat scenario test suite (14 scenarios)             | M3                        | CLAUDE.md §M3.7         |
| Real SFTP/HTTPS connector wiring                      | M3.5                      | transport STUB findings |
| Real S3 object storage wiring                         | M3.5                      | storage ABSENT findings |
| Metrics HTTP endpoint exposure                        | M4                        | R7-001                  |
| Runbooks / DR procedures                              | M5                        | R7-003                  |
| Regulatory evidence matrices (BNM/PDPA/LHDN)          | M5                        | R8-002, R8-003, R8-004  |
| Incident reporting workflow (Cyber Security Act 2024) | M4 (needs owner assigned) | R8-001                  |
| SBOM signing + provenance attestation                 | M6                        | R5-003                  |
| SLOs + alert rules                                    | M6                        | R7-002                  |

If any M3.0 task appears to require one of the above, **stop and escalate** — it means scope has leaked.

---

## 2. Findings closed by M3.0 (bookkeeping)

Executing this plan closes or partially closes the following findings:

**Fully closed:**

- R1-001 (CI SHA-pinning)
- R5-001 (exact-pinning production deps)
- R5-002 (working SCA gate)
- R5-006 (single-maintainer passport removed)
- NEW-05 (Zod on approvals body)
- NEW-09 (openpgp version drift)
- NEW-TEST-COUNT (PLANS.md truth correction)

**Partially closed:**

- R1-004 (adds `.dockerignore` + lefthook; credential scrub deferred to M3 if any survive)
- R4-002 (nestjs-zod eliminates body casts at controller boundary; processor casts remain for M3)
- R5-003 (SBOM generation wired; signing + provenance deferred to M6)
- NEW-08 (OTEL installed; full wiring deferred to M3)

**Setup work for M3:**

- Installs (but does not wire) `@aws-sdk/client-s3`, `@aws-sdk/client-kms`, OTEL cluster, `@nestjs/throttler`, `otplib`, `testcontainers`, `msw`, `clamscan`. Each is unused until M3/M3.5 consumes it.

---

## 3. Preflight

Before any dependency change:

```bash
# Verify clean working tree on main
cd /workspaces/exchange
git status                              # must be clean
git pull --ff-only origin main          # must be up to date

# Baseline: capture current state
pnpm install --frozen-lockfile
pnpm run typecheck                      # must pass
pnpm run lint                           # must pass
pnpm run test:unit                      # must pass
pnpm run build                          # must pass

# Record baselines for post-reset comparison
pnpm list --depth=0 > /tmp/m3_0_deps_before.txt
find . -name "*.test.ts" -not -path "*/node_modules/*" | xargs grep -c "^  \(it\|test\)(" 2>/dev/null | awk -F: '{sum+=$2} END {print "test_count_before="sum}' > /tmp/m3_0_baseline.txt

# Create feature branch
git checkout -b m3.0/foundation-reset
```

**Baseline expectations to record** (from forensic report §6.1):

- Test count: 289 (actual, per audit grep — not 330 as PLANS.md claims)
- Test files: 30
- Packages: 8
- Top-level direct deps: documented in `_audit/dependency_report.md` §1

If any of the preflight commands fail, **stop**. The reset presumes a green baseline.

---

## 4. Dependency surgery — Phase 1: removals

Remove packages that are being replaced. Do not touch source code yet; compile errors are expected and will be resolved in §7.

```bash
# From repo root — affects all workspaces via pnpm filter
pnpm remove -r passport passport-jwt passport-local @types/passport @types/passport-jwt @types/passport-local
pnpm remove -r class-transformer class-validator
pnpm remove -r bcrypt @types/bcrypt

# Optional: remove if present
pnpm remove -r swagger-cli 2>/dev/null || true
```

**Verify removal** (should return no matches in any `package.json` except this plan file):

```bash
grep -r '"passport"\|"class-transformer"\|"class-validator"\|"bcrypt"' \
  --include=package.json --exclude-dir=node_modules .
```

---

## 5. Dependency surgery — Phase 2: upgrades

Upgrade pinned-old packages. Pin to **exact** versions (not caret ranges) for production deps.

**Resolution policy:** At execution time, run `pnpm view <pkg> version` to get the latest stable, then pin that exact version. Do not hallucinate versions from this document — the numbers below are floor-constraints, not targets.

| Package               | Current         | Target (floor)                                                | Rationale                                                                                |
| --------------------- | --------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `vitest`              | 1.6.1           | `>=3.0.0`                                                     | Closes dev-only CVE bundle; 2× faster; blocks advisory closure today                     |
| `@vitest/coverage-v8` | 1.6.1           | match vitest                                                  | —                                                                                        |
| `prisma`              | 5.11.0          | `>=5.22.0` (stay on 5.x)                                      | Fixes `$transaction` timeout handling needed for R2-002 in M3; 6.x defer to post-Phase-1 |
| `@prisma/client`      | 5.11.0          | match prisma                                                  | —                                                                                        |
| `pino`                | 8.19.0          | `>=9.0.0`                                                     | Current major; redaction semantics unchanged                                             |
| `zod`                 | 3.22.4          | `>=3.23.0` (or 4.x if team is comfortable — see §15 gotcha 3) | Stabilises out-of-preview types; reduces `as unknown as` at boundaries                   |
| `typescript`          | 5.4.x           | `>=5.6.0`                                                     | Inference improvements; no breaking changes expected for this codebase                   |
| `openpgp`             | 5.11.0 / 5.11.3 | align to one exact `5.11.3`                                   | Close NEW-09 drift; do not jump to 6.x in M3.0                                           |
| `fastify`             | 5.8.4           | exact-pin at installed version                                | Already current — exact-pin only                                                         |
| `@fastify/helmet`     | 13.0.2          | exact-pin                                                     | —                                                                                        |
| `ssh2-sftp-client`    | 9.1.0           | exact-pin                                                     | Will be consumed in M3.5; pin now                                                        |

```bash
# Example execution pattern — DO NOT COPY VERSIONS LITERALLY
# Run `pnpm view <pkg> version` first, substitute into the command, then run:

pnpm add -w -E vitest@<latest-3.x>
pnpm add -w -E @vitest/coverage-v8@<matching>
pnpm add -w -E -F @sep/db prisma@<latest-5.22+> @prisma/client@<latest-5.22+>
pnpm add -w -E -F @sep/observability pino@<latest-9.x>
pnpm add -w -E zod@<latest-3.23+>   # add to every workspace using zod
pnpm add -w -D -E typescript@<latest-5.6+>

# Align openpgp across crypto + data-plane packages
pnpm add -E -F @sep/crypto openpgp@5.11.3
pnpm add -E -F @sep/data-plane openpgp@5.11.3
```

**Verify upgrades** after each block:

```bash
pnpm list --depth=0 -r | grep -E 'vitest|prisma|pino|zod|typescript|openpgp|fastify'
```

---

## 6. Dependency surgery — Phase 3: additions

### 6.1 Forced-wire additions (must replace removed packages to make the build compile)

```bash
# Zod at NestJS boundary (replaces class-validator/class-transformer)
pnpm add -E -F @sep/control-plane nestjs-zod

# Argon2id password/API-key hashing (replaces bcrypt)
pnpm add -E -F @sep/control-plane @node-rs/argon2

# @nestjs/jwt already installed; no change needed beyond guard rewrite (see §7C)
```

### 6.2 Install-only additions (installed now, wired in M3/M3.5/M4/M6)

```bash
# Object storage — wired in M3.5
pnpm add -E -F @sep/data-plane @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Key custody — wired in M3
pnpm add -E -F @sep/crypto @aws-sdk/client-kms
# Note on Vault client: do NOT add node-vault (single-maintainer, stale).
# M3 will add a thin custom HTTP wrapper around Vault REST API (decision locked at M3 start).

# OpenTelemetry — wired in M3
pnpm add -E -F @sep/observability \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/exporter-metrics-otlp-proto \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions

# Rate limiting — wired in M3
pnpm add -E -F @sep/control-plane @nestjs/throttler @fastify/rate-limit

# TOTP MFA — wired in M3
pnpm add -E -F @sep/control-plane otplib qrcode
pnpm add -E -D -F @sep/control-plane @types/qrcode

# Testcontainers for real E2E — wired in M3.5
pnpm add -E -D -w testcontainers @testcontainers/postgresql @testcontainers/redis

# MSW for partner endpoint simulation — wired in M3.5
pnpm add -E -D -w msw

# ClamAV malware scan — wired in M3
pnpm add -E -F @sep/data-plane clamscan

# Undici — promote from override to direct dep
pnpm add -E -F @sep/data-plane undici

# SBOM generation — wired in CI during M3.0 itself (see §8.3)
pnpm add -E -D -w @cyclonedx/cyclonedx-npm

# Pre-commit hooks — wired in §9
pnpm add -E -D -w lefthook
```

### 6.3 Explicit NON-additions (called out so the decision is visible)

These were considered and **deliberately deferred**. Each has an ADR commitment in §13.

| Not adopted                    | Reason                                                                        | Revisit                                    |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------ |
| Effect-TS                      | Steep learning curve; solo-author codebase can't absorb                       | M5+ if orchestration complexity demands    |
| Temporal                       | Operational weight; BullMQ sufficient for M3/M4 patterns                      | M5 Partner Packs                           |
| Drizzle ORM                    | Switching cost > benefit post-M2                                              | Future project                             |
| Biome                          | Custom ESLint rules tuned for security; Biome parity not yet there            | M6                                         |
| `node-vault`                   | Single-maintainer, stale                                                      | Replaced by custom thin Vault client in M3 |
| Pact                           | Wrong tool for external partner contracts (consumer-driven model doesn't fit) | Replaced by MSW                            |
| Zod 4.x (if not adopted above) | Migration edges; team familiarity with 3.x                                    | Post-Phase 1                               |

---

## 7. Code swaps required to make the build compile

The dependency changes in §4–6 break compilation. The following swaps are the **minimum** required to restore green build. Every swap is mechanical — no business-logic change, no new capability.

### 7A. class-validator/class-transformer → nestjs-zod

**Scope:** Every NestJS controller using `@Body(dtoClass)` with a class-validator DTO.

**Inventory command** (run this first to enumerate):

```bash
grep -rn "class-validator\|class-transformer\|IsString\|IsEnum\|IsEmail\|IsUUID\|Transform\b" \
  apps/control-plane/src packages/*/src --include='*.ts' | grep -v node_modules
```

**Pattern — before:**

```typescript
// apps/control-plane/src/modules/submissions/dto/create-submission.dto.ts
import { IsString, IsEnum, IsUUID } from 'class-validator';
export class CreateSubmissionDto {
  @IsUUID() partnerProfileId: string;
  @IsString() idempotencyKey: string;
  // ...
}

// Controller
@Post() create(@Body() dto: CreateSubmissionDto) { ... }
```

**Pattern — after:**

```typescript
// DELETE the DTO class file. Use existing Zod schema from packages/schemas.
// apps/control-plane/src/modules/submissions/submissions.controller.ts
import { createZodDto } from 'nestjs-zod';
import { CreateSubmissionSchema } from '@sep/schemas';

class CreateSubmissionDto extends createZodDto(CreateSubmissionSchema) {}

@Post() create(@Body() dto: CreateSubmissionDto) { ... }
```

**Critical:** Use the **existing** Zod schemas in `packages/schemas/src/*` (already present per CLAUDE_CODE_PROMPT.md §3.1–3.6). Do not re-define schemas at the controller boundary. If a schema is missing for a given endpoint, **stop and flag** — that's an M3 gap, not an M3.0 task.

**Also closes:** NEW-05 (approvals body cast), R3-003 (partner-profiles transition body cast), R4-002 partial (boundary-level casts).

### 7B. bcrypt → argon2id

**Scope:** Every `bcrypt.hash()` / `bcrypt.compare()` callsite.

**Inventory command:**

```bash
grep -rn "bcrypt\.hash\|bcrypt\.compare\|require('bcrypt')\|from 'bcrypt'" \
  apps/ packages/ --include='*.ts' | grep -v node_modules
```

**Pattern — before:**

```typescript
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(plaintext, 12);
const ok = await bcrypt.compare(plaintext, hash);
```

**Pattern — after:**

```typescript
import argon2 from '@node-rs/argon2';
// OWASP-recommended parameters (April 2026): memoryCost=19456 KiB, timeCost=2, parallelism=1
const hash = await argon2.hash(plaintext, {
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
const ok = await argon2.verify(hash, plaintext);
```

**Migration note:** bcrypt and argon2 hashes are **not cross-compatible**. Because Phase 1 has no production users yet:

- Clear all seeded user/API-key records.
- Update `packages/db/prisma/seed.ts` to hash with argon2.
- Re-run `pnpm db:seed` after migration.

If any environment has real credentials (do not assume), **stop** and design a dual-verify transition for M3. For Phase 1 scope this should not apply.

### 7C. passport-jwt → direct `@nestjs/jwt` guard

**Scope:** Remove `PassportModule`, `passport-jwt` strategy, `AuthGuard('jwt')` usages. Replace with a custom guard.

**Inventory command:**

```bash
grep -rn "PassportModule\|passport-jwt\|AuthGuard('jwt')\|AuthGuard(\"jwt\")" \
  apps/control-plane/src --include='*.ts' | grep -v node_modules
```

**Pattern — after** (single custom guard file):

```typescript
// apps/control-plane/src/common/guards/jwt-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();

    const token = auth.slice(7);
    const payload = await this.jwt.verifyAsync(token, {
      algorithms: ['HS256'], // explicit; JWT secret from config
    });

    // Attach claims for downstream guards (tenant.guard, roles.guard)
    (req as unknown as { user: unknown }).user = payload;
    return true;
  }
}
```

**AuthModule change:**

```typescript
// Before
imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({...})]

// After
imports: [JwtModule.register({ secret: config.jwt.secret, signOptions: { algorithm: 'HS256', expiresIn: '15m' }})]
```

**Guard registration** (APP_GUARD):

```typescript
// apps/control-plane/src/app.module.ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard }, // runs first
  { provide: APP_GUARD, useClass: TenantGuard }, // then tenant scoping
  { provide: APP_GUARD, useClass: RolesGuard }, // then RBAC
];
```

**Note:** Refresh-token rotation, lockout, and MFA are **M3**, not M3.0. The above is a like-for-like replacement with no auth-lifecycle improvements.

### 7D. Swagger CLI → nestjs-zod + @nestjs/swagger

If `swagger-cli` exists in scripts or deps, remove it. OpenAPI generation now flows from:

```typescript
// apps/control-plane/src/main.ts — add after app creation, before listen()
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';

patchNestJsSwagger();
const config = new DocumentBuilder()
  .setTitle('SEP Control Plane API')
  .setVersion('v1')
  .addBearerAuth()
  .build();
const doc = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, doc);
```

**Do not** expose `api/docs` in production environment — gate with `if (config.env !== 'production')`.

---

## 8. CI pipeline hardening

### 8.1 SHA-pin all GitHub Actions (closes R1-001)

**Inventory:**

```bash
grep -rn "uses: " .github/workflows/ | grep -v "# pinned" | awk -F"uses: " '{print $2}' | sort -u
```

Expected output: ~32 lines with `@v*` references (one is already SHA-pinned per forensic report §2.2).

**Resolution:** For each action, look up the current SHA for the released tag:

```bash
# Example
gh api repos/actions/checkout/commits/v4 --jq .sha
# Returns something like b4ffde65f46336ab88eb53be808477a3936bae11
```

**Replace pattern — before:**

```yaml
- uses: actions/checkout@v4
```

**After:**

```yaml
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
```

The trailing comment is **mandatory** so humans can read the pin.

**Automation:** Add a Dependabot config entry to keep SHA pins fresh without defeating the security property:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule: { interval: 'weekly' }
    target-branch: 'main'
```

Dependabot natively handles SHA pinning with tag comments.

### 8.2 Replace `pnpm audit` with working SCA tool (closes R5-002)

Current CI runs `pnpm audit --audit-level=high` which returns HTTP 410 for the npm registry path pnpm uses. Replace with `osv-scanner` (Google, OSS, actively maintained, handles the full ecosystem).

**Remove from `.github/workflows/ci.yml`:**

```yaml
# DELETE this step
- name: Dependency audit
  run: pnpm audit --audit-level=high
```

**Add:**

```yaml
- name: Dependency audit (OSV Scanner)
  uses: google/osv-scanner-action@<pin-to-SHA> # see §8.1 for SHA resolution
  with:
    scan-args: |-
      --recursive
      --skip-git
      ./
    # Fail build on HIGH or CRITICAL
    fail-on-vuln: true
```

**Alternative if OSV-Scanner false-positives:** `audit-ci` (supports --allowlist for acknowledged advisories):

```bash
pnpm add -E -D -w audit-ci
# In CI: npx audit-ci --high --package-manager pnpm
```

### 8.3 SBOM generation (partial R5-003 closure)

Add a new CI job that runs on main-branch pushes and release tags:

```yaml
# .github/workflows/ci.yml — new job after build
sbom:
  name: Generate SBOM
  runs-on: ubuntu-latest
  needs: build
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@<SHA>
    - uses: pnpm/action-setup@<SHA>
      with: { version: 9.0.0 }
    - uses: actions/setup-node@<SHA>
      with: { node-version: '20', cache: 'pnpm' }
    - run: pnpm install --frozen-lockfile
    - name: Generate CycloneDX SBOM
      run: pnpm exec cyclonedx-npm --output-file sbom.cdx.json
    - uses: actions/upload-artifact@<SHA>
      with:
        name: sbom
        path: sbom.cdx.json
        retention-days: 90
```

**Signing + provenance attestation (full R5-003 closure) is M6** — do not attempt in M3.0. This step just ensures an SBOM artefact is produced every build.

### 8.4 Keep unchanged

The following CI items stay as-is — they are correct and changing them is out of scope:

- `trufflesecurity/trufflehog` (already SHA-pinned, working)
- Build matrix structure
- Artefact upload/download (integrity verification is M6 scope — R1-002)

---

## 9. Pre-commit hooks (lefthook)

Install and configure lefthook. Closes part of R1-004.

```bash
pnpm exec lefthook install
```

**Create `lefthook.yml` at repo root:**

```yaml
# lefthook.yml
# Fast gates — should complete in < 10s on average commit

pre-commit:
  parallel: true
  commands:
    typecheck-staged:
      glob: '*.{ts,tsx}'
      run: pnpm exec tsc --noEmit -p tsconfig.base.json
      # Project-wide typecheck — alternative: use tsc-files for staged-only
      # Pick one at execution; project-wide is safer, staged is faster

    lint-staged:
      glob: '*.{ts,tsx}'
      run: pnpm exec eslint {staged_files}

    gitleaks:
      run: gitleaks protect --staged --verbose --redact
      # Requires gitleaks binary; CI-only fallback if binary absent:
      # skip: false
      # fail_text: "Install gitleaks: https://github.com/gitleaks/gitleaks"

commit-msg:
  commands:
    lint-commit-message:
      run: |
        head -1 {1} | grep -qE '^(feat|fix|docs|test|chore|refactor|ci|build|perf)(\(.+\))?: .+'
      fail_text: 'Commit message must follow conventional-commits prefix'

pre-push:
  commands:
    test-affected:
      run: pnpm run test:unit
      # Full unit suite on push; acceptable latency tradeoff
```

**Document in `CONTRIBUTING.md`** (create if absent):

```markdown
## Pre-commit hooks

This repo uses [lefthook](https://github.com/evilmartians/lefthook) for pre-commit gates.
After `pnpm install`, hooks are installed automatically via the `prepare` script.
To skip hooks for a specific commit (emergency only): `git commit --no-verify`.
```

**Add to root `package.json`:**

```json
{
  "scripts": {
    "prepare": "lefthook install"
  }
}
```

---

## 10. Environment and developer workflow hygiene

### 10.1 Add `.dockerignore` (closes part of R1-004)

Create `/workspaces/exchange/.dockerignore`:

```gitignore
# .dockerignore
node_modules
**/node_modules
.git
.github
.vscode
.idea
*.log
.env
.env.*
!.env.example
dist
build
coverage
.turbo
.cache
**/test-results
**/*.test.ts
**/*.spec.ts
tests/
_audit/
_plan/
audit/
docs/
*.md
!README.md
```

### 10.2 Scrub `.env.example` placeholders (closes part of R1-004)

**Inventory:** Read current `.env.example` and identify any value that looks resolvable as a real credential (e.g. `VAULT_TOKEN=dev-root-token`, `STORAGE_ACCESS_KEY=minioadmin`).

**Policy:** Replace with unmistakably non-usable placeholders:

```diff
- VAULT_TOKEN=dev-root-token
+ VAULT_TOKEN=<REPLACE_ME_OR_LOAD_FROM_SECRETS_MANAGER>

- STORAGE_ACCESS_KEY=minioadmin
+ STORAGE_ACCESS_KEY=<REPLACE_ME_LOCAL_DEV_ONLY>
- STORAGE_SECRET_KEY=minioadmin
+ STORAGE_SECRET_KEY=<REPLACE_ME_LOCAL_DEV_ONLY>

- JWT_SECRET=change-me-in-production
+ JWT_SECRET=<REPLACE_ME_MIN_32_BYTES>
```

**Also:** Update `docker-compose.yml` dev defaults. The compose file should still work out-of-the-box for developers (`docker compose up`), but the values in the compose file should be obviously-not-real (e.g. `MINIO_ROOT_PASSWORD=devonly_$(openssl rand -hex 8)` generated at first run — or just kept as `minioadmin`/`minioadmin` **with a big comment** saying "DEV ONLY, never deployed").

### 10.3 Add residency config hook (setup for Q12 decision)

In `packages/common/src/config/config.ts`, extend the storage config schema:

```typescript
storage: z.object({
  endpoint: z.string().url(),
  region: z.string().default('ap-southeast-1'),
  myResidency: z.boolean().default(false), // NEW — pins this tenant to MY-region buckets when true
  // ... existing fields
});
```

**Do not yet wire the enforcement** — that's M3 work once RLS and tenant-scoped config resolution are in place. M3.0 only adds the schema field and documents the intent.

---

## 11. Version alignment via `pnpm.overrides`

Close NEW-09 (openpgp drift) and establish single-source-of-truth for cross-package versions.

**Edit root `package.json`:**

```json
{
  "pnpm": {
    "overrides": {
      "openpgp": "5.11.3",
      "undici": ">=5.28.4",
      "@fastify/middie": ">=9.2.0"
    },
    "peerDependencyRules": {
      "ignoreMissing": []
    }
  }
}
```

**Regenerate lockfile:**

```bash
rm -rf node_modules
pnpm install
pnpm list openpgp -r    # should show single version across all packages
```

---

## 12. Correct PLANS.md test-count discrepancy (closes NEW-TEST-COUNT)

**Edit `PLANS.md`:**

Find line 16:

```markdown
| Post-M2 remediation | 🟢 COMPLETE | Yes | 4 gate blockers + 2 coupled defects. 330 tests across 30 files. 2026-04-13. |
```

Replace with (substituting actual post-M3.0 test count):

```markdown
| Post-M2 remediation | 🟢 COMPLETE | Yes | 4 gate blockers + 2 coupled defects. 289 tests across 30 files (corrected 2026-04-17 in M3.0 audit reconciliation; prior "330" figure was a miscount). 2026-04-13. |
```

Find line 183 if present (similar claim) — apply same correction.

**Record in commit message:**

```
chore(m3.0): correct PLANS.md test count claim (330→289)

Forensic audit 2026-04-16 (NEW-TEST-COUNT) identified a 41-test
overstatement. Actual count verified via `grep -c "^  \(it\|test\)("`
across 30 test files. No tests were removed; the "330" figure appears
to be a miscount at the time of the post-M2 closure log entry.
```

---

## 13. Architectural Decision Records

Create `docs/adr/` if absent and add the following ADRs. ADRs are short (< 1 page each) and record _why we didn't do X_ as much as _why we did Y_.

### ADR-0001: Zod-everywhere validation strategy

**Status:** Accepted (M3.0)
**Context:** Phase 1 inherits both class-validator (NestJS default) and Zod (packages/schemas). Two sources of truth.
**Decision:** Use Zod as the single validation mechanism. Delete class-validator DTOs. Adopt nestjs-zod for `@Body()` integration.
**Consequences:** OpenAPI generation via `patchNestJsSwagger`. All schemas live in `packages/schemas`. Controllers import Zod schemas, not DTO classes.

### ADR-0002: Argon2id for password/API-key hashing

**Status:** Accepted (M3.0)
**Context:** bcrypt is 2015-era; 72-byte truncation is a known footgun. OWASP's current (April 2026) recommendation is Argon2id.
**Decision:** `@node-rs/argon2` with OWASP-recommended parameters. Rust-native binding, no C++ toolchain requirement at install.
**Consequences:** No backward-compat with bcrypt hashes; Phase 1 has no prod users yet so clean cutover is safe. Seed data regenerated.

### ADR-0003: Direct `@nestjs/jwt` guard, no Passport

**Status:** Accepted (M3.0)
**Context:** Passport is single-maintainer-risk (R5-006), adds 3 transitive deps, and provides abstraction we won't use (2 strategies in Phase 1, no OAuth/SAML planned).
**Decision:** 40-line custom `JwtAuthGuard` using `JwtService.verifyAsync` directly. Algorithm explicitly pinned to HS256.
**Consequences:** Lose Passport's strategy-swap pattern. If OAuth is ever needed (post-Phase-1), re-evaluate — the guard interface is small enough to replace.

### ADR-0004: Reject `node-vault`, adopt custom thin HTTP client in M3

**Status:** Decided (M3.0), implemented (M3)
**Context:** `node-vault` npm package is effectively single-maintainer; last major release >2 years ago. The Vault HTTP API surface we need is tiny (kv/data/\*, transit/sign, transit/verify).
**Decision:** In M3, build a ~200-line Vault client using `undici` fetch. Pair with `@aws-sdk/client-kms` for AWS-native tenants.
**Consequences:** Own the Vault client code. Less supply-chain exposure. `KeyCustodyAbstraction` retains its 3-backend shape (Vault, AWS KMS, future Azure KV).

### ADR-0005: Deferred — Effect-TS, Temporal, Drizzle, Biome, Zod 4

**Status:** Not adopted in Phase 1
**Context:** Each was considered and rejected for Phase 1, with specific re-evaluation milestones.
**Decision:**

- **Effect-TS** — re-evaluate at M5 if orchestration complexity emerges
- **Temporal** — re-evaluate at M5 when hours-long-ack-poll patterns appear
- **Drizzle** — permanent rejection; 18 Prisma models + migrations sunk cost too high
- **Biome** — re-evaluate at M6; custom ESLint security rules currently have no Biome equivalent
- **Zod 4.x** — re-evaluate after Zod 3.23+ stabilises in production for one milestone
  **Consequences:** This ADR exists so future contributors don't have to re-litigate.

---

## 14. Verification checklist (exit criteria)

M3.0 is **complete** when every item below is checked AND a one-paragraph handoff note is produced (see §15).

### Build health

- [ ] `pnpm install --frozen-lockfile` exits 0
- [ ] `pnpm run typecheck` exits 0 across all workspaces
- [ ] `pnpm run lint` exits 0 (strict ESLint unchanged)
- [ ] `pnpm run build` exits 0 across all workspaces
- [ ] `pnpm run test:unit` exits 0 with test count **≥ 289** (baseline); any test removals explicitly justified in handoff
- [ ] `pnpm prisma migrate deploy` runs cleanly against fresh Postgres (no migration regressions from Prisma upgrade)
- [ ] `docker compose up -d` — all services healthy

### Dependency hygiene

- [ ] `grep -r '"passport"\|"class-transformer"\|"class-validator"\|"bcrypt"' --include=package.json --exclude-dir=node_modules .` returns 0 results
- [ ] `pnpm list openpgp -r` shows single version `5.11.3` across all workspaces
- [ ] No caret (`^`) ranges on production deps (dev deps acceptable) — verify via `grep -E '"\^[0-9]' package.json */package.json` (careful, may have false positives; scope-check manually)
- [ ] `pnpm list --depth=0 -r` shows Vitest 3.x, Prisma 5.22+, Pino 9.x, Zod 3.23+, TypeScript 5.6+
- [ ] `grep -rn "uses: " .github/workflows/` — every line either SHA-pinned or has explicit exemption comment

### CI gates

- [ ] CI job "Dependency audit (OSV Scanner)" runs and returns non-empty JSON (may still be zero findings — that's fine, just verify the job isn't broken)
- [ ] CI job "Generate SBOM" produces `sbom.cdx.json` as an artefact
- [ ] Dependabot config added for `github-actions` ecosystem

### Developer workflow

- [ ] `.dockerignore` present at repo root
- [ ] `lefthook.yml` present at repo root; `pnpm exec lefthook run pre-commit` passes on a test commit
- [ ] `.env.example` contains no resolvable-looking credentials (all placeholders obviously non-usable)
- [ ] `CONTRIBUTING.md` documents pre-commit workflow

### Documentation

- [ ] `docs/adr/0001-zod-everywhere.md` through `docs/adr/0005-deferred-stack-decisions.md` created
- [ ] `PLANS.md` test-count claim corrected
- [ ] `PLANS.md` updated to record M3.0 completion

### Code health

- [ ] No `bcrypt.hash` / `bcrypt.compare` callsites remain
- [ ] No `class-validator` decorators on DTOs
- [ ] No `PassportModule` or `AuthGuard('jwt')` usages
- [ ] OpenAPI generation works: `GET /api/docs` serves a spec in dev mode

### Regression posture

- [ ] No increase in `TODO`/`FIXME`/`HACK`/`XXX` in runtime code (forensic baseline: 0 in apps/+packages/)
- [ ] No new `as unknown as` casts in runtime code (forensic baseline: 9 instances, mostly in data-plane processors)
- [ ] No new plain `throw new Error(...)` callsites in runtime code

---

## 15. Known gotchas

**Gotcha 1 — nestjs-zod + NestJS 11 compatibility.**
Verify `nestjs-zod` supports NestJS 11 at install time (`pnpm view nestjs-zod peerDependencies`). If incompatible, fall back to raw Zod parsing in a custom pipe (~30 LOC). Do not downgrade NestJS.

**Gotcha 2 — Prisma 5.11 → 5.22 migration history.**
Prisma 5.12 introduced a migration-state check that can fail on repos with schema drift. Run `pnpm prisma migrate status` **before** upgrading to confirm clean state. If dirty, resolve migration drift first.

**Gotcha 3 — Zod 3.23 vs 4.x.**
If you choose Zod 4 (braver): breaking changes include `.strict()` semantics on objects, `z.string().datetime()` return-type shift, and deprecated method removals. Estimated 2–3 hour migration for this codebase's schema count. 3.23 is the safe floor; 4.x is fine if the team is comfortable.

**Gotcha 4 — Vitest 1 → 3 config.**
The `test` key in `vitest.config.ts` renamed some options. Specifically: `threads: true` → `poolOptions.threads.singleThread: false`. `tests/helpers/` may need updates. Run `pnpm exec vitest --config path/to/vitest.config.ts run --reporter=verbose` after upgrade to verify.

**Gotcha 5 — argon2 performance in test environments.**
OWASP-recommended parameters (`memoryCost: 19456, timeCost: 2`) take ~200ms per hash on a typical laptop. That's intentional for production; in test suites it slows things down. **Do not lower the params in production code.** Instead, mock the hash function in tests or use a test-only `argon2.Argon2Options` constant with lower cost. Keep the real params in `packages/common/src/config/config.ts`.

**Gotcha 6 — lefthook on Windows.**
If any contributor runs Windows without WSL, gitleaks binary install differs. Document Git Bash + lefthook's Windows support page. Phase 1 has one contributor on Linux per forensic report; re-visit when team grows.

**Gotcha 7 — @fastify/helmet + `patchNestJsSwagger`.**
Helmet's default CSP blocks inline scripts. If `api/docs` Swagger UI fails to load, relax CSP for `/api/docs/*` only. Do not disable helmet globally.

**Gotcha 8 — OpenTelemetry SDK bundle size.**
Installing the full `@opentelemetry/auto-instrumentations-node` adds ~30MB to `node_modules`. Acceptable for Phase 1. If build times become painful, switch to hand-picked instrumentation packages in M3.

**Gotcha 9 — node-rs/argon2 build on Alpine.**
If Docker images use `node:20-alpine`, `@node-rs/argon2` may need the musl build. Use `node:20-bookworm-slim` instead, or add `apk add --no-cache libc6-compat`. Document in Dockerfile when M3.5 adds it.

**Gotcha 10 — Claude Code's own hallucination risk.**
The command examples in this document use placeholder versions (`<latest-3.x>`). **Claude Code must substitute real versions via `pnpm view` at execution time, not fabricate them.** If this instruction is ignored, the reset will install non-existent versions.

---

## 16. Rollback plan

If M3.0 execution encounters a blocker that cannot be resolved within scope:

```bash
# Full rollback — abandon the reset
git reset --hard origin/main
git branch -D m3.0/foundation-reset
rm -rf node_modules pnpm-lock.yaml
pnpm install --frozen-lockfile
```

**Partial rollback** (per-phase) is not supported — the reset is atomic. If Phase 2 upgrades succeed but Phase 3 additions fail, roll back the entire branch and retry with a refined plan.

**Escalation trigger:** If the same step fails twice with different errors, stop and produce a blocker note (§17) rather than attempting a third workaround.

---

## 17. Execution prompt for Claude Code

Hand this prompt to a fresh Claude Code session. It references this document and enforces the discipline.

```
ROLE
You are a senior platform engineer executing M3.0 Foundation Reset for the
Malaysia Secure Exchange Platform. The complete, authoritative plan is at
/_plan/M3_0_FOUNDATION_RESET.md. Read it in full BEFORE taking any action.

EXECUTION RULES
1. This is a RESET, not a BUILD. Do not close findings outside the list in §2.
2. Work on branch `m3.0/foundation-reset` — do not commit to main.
3. Commit after each major phase (§4 removals, §5 upgrades, §6 additions,
   §7A swaps, §7B swaps, §7C swaps, §8 CI, §9 hooks, §10 env, §11 overrides,
   §12 PLANS.md, §13 ADRs). Use conventional-commits prefixes.
4. For version pinning in §5 and §6, ALWAYS run `pnpm view <pkg> version`
   before pinning. Do not fabricate versions from the plan document —
   those are floor-constraints, not targets.
5. If any verification check in §14 fails, STOP and produce a blocker note
   at /_plan/M3_0_BLOCKERS.md before proceeding. Do not silently skip.
6. If ANY step reveals a need to change architecture (not just deps), STOP
   and escalate — that work belongs in M3, not M3.0.
7. On completion, produce a handoff note at /_plan/M3_0_HANDOFF.md with:
   - Final test count
   - Any deviations from the plan and why
   - Any gotchas encountered
   - Any deps that could not be installed at the target version
   - A fresh `pnpm list --depth=0 -r` output
   - Confirmation that every §14 checkbox is satisfied

WORKING STYLE
- Preflight (§3) before anything else.
- One phase at a time. Verify after each.
- Commit hygiene: short subject, detailed body if non-trivial.
- When in doubt, ask. Do not invent versions, hash values, or policies.

Begin now by reading /_plan/M3_0_FOUNDATION_RESET.md completely.
```

---

## 18. Handoff expectations

On M3.0 completion, the platform should be in a state where:

1. **Every finding in §2 "Fully closed" is provably resolved** (CI runs, SHA-pinned actions, Zod at body, argon2 at hash, passport removed, single openpgp, SBOM generated).
2. **Every finding in §2 "Setup work for M3" has the dep installed but unused** — verified by a smoke-test import from each, checked in as a `__smoke__` test file under each package.
3. **No findings outside §2 are touched** — the acceptance register at `PLANS.md` remains authoritative for all other deferrals.
4. **PLANS.md reflects M3.0 as a completed milestone** — add a new row to the CURRENT STATUS table.
5. **A detailed M3 plan (`_plan/M3_EXECUTION_PLAN.md`) is the next artefact** to write — **not** attempted inside M3.0.

If the handoff note (§17) confirms all five, the Phase 2 rolling-wave discipline proceeds to writing `_plan/M3_EXECUTION_PLAN.md` against the refreshed stack.

---

**End of M3.0 Foundation Reset plan.**

**Source evidence:** This plan is grounded in `_audit/FORENSIC_REPORT.md`, `_audit/findings.json`, `_audit/coverage_matrix.csv`, `_audit/dependency_report.md`, `PLANS.md` (Formal Acceptance Register), `CLAUDE.md` (§M3 scope boundary), and the 2026-04-16 hostile audit. Every action in §4–13 traces to a finding ID or an ADR.
