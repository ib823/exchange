# BODY 1 — Claude Code CLI Execution Prompt

# Paste this file path to Claude Code on first session open:

# claude --prompt BODY1_EXECUTION.md

#

# Or open claude and say: "Read BODY1_EXECUTION.md and execute it completely."

#

# This file is the authoritative execution plan for Body 1.

# Every step is mechanically verifiable. Do not skip verification steps.

# Do not proceed past a failing step without resolving it.

---

## CONTEXT

You are building the Malaysia Secure Exchange Platform — a security-sensitive enterprise product.
The repository is in the current working directory. Files may already exist from scaffolding.
Read CLAUDE.md before doing anything else. It contains non-negotiable security and coding rules.

Your task in this session: complete M0 (Repository Bootstrap) to full exit criteria.
Every quality gate must pass before you mark M0 complete.

---

## PHASE 0: PRE-FLIGHT CHECKS

Run these checks first. Stop and report if any fail.

```bash
node --version        # must be >= 20.0.0
docker --version      # must be available
docker compose version # must be available
git --version         # must be available
```

Install pnpm via corepack:

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm --version        # must be >= 9.0.0
```

---

## PHASE 1: GIT INITIALISATION

```bash
git init
git config user.email "platform-build@sep.local"
git config user.name "SEP Build"
echo "node_modules/" >> .gitignore
git add .gitignore
git commit -m "chore: initial commit"
```

---

## PHASE 2: INSTALL ALL DEPENDENCIES

All `package.json` files already exist in the repo. Run:

```bash
pnpm install --frozen-lockfile
```

If `--frozen-lockfile` fails because `pnpm-lock.yaml` does not exist yet, run:

```bash
pnpm install
git add pnpm-lock.yaml
git commit -m "chore: add lockfile"
```

Verify workspace resolution:

```bash
pnpm ls --depth 0
# Must show all 9 packages: @sep/common, @sep/schemas, @sep/crypto,
# @sep/partner-profiles, @sep/observability, @sep/db,
# @sep/control-plane, @sep/data-plane, @sep/operator-console
```

---

## PHASE 3: GENERATE PRISMA CLIENT

```bash
pnpm --filter @sep/db exec prisma generate
# Must complete with: "Generated Prisma Client"
```

---

## PHASE 4: START LOCAL INFRASTRUCTURE

```bash
docker compose up -d
```

Wait for health:

```bash
sleep 8
docker compose ps
# All services must show status: healthy or running (not exited)
```

Verify each service:

```bash
docker exec sep-postgres pg_isready -U sep -d sep_dev
# Output: sep_dev:5432 - accepting connections

docker exec sep-redis redis-cli ping
# Output: PONG

curl -sf http://localhost:9000/minio/health/live && echo "minio ok"
curl -sf http://localhost:8200/v1/sys/health && echo "vault ok"
```

If any service fails: `docker compose logs <service>` and fix before continuing.

---

## PHASE 5: RUN DATABASE MIGRATION

```bash
pnpm --filter @sep/db exec prisma migrate dev --name init
# Must complete: "Your database is now in sync with your schema"

pnpm --filter @sep/db exec prisma migrate status
# All migrations must show: "Applied"
```

Verify tables exist:

```bash
docker exec sep-postgres psql -U sep -d sep_dev -c "\dt"
# Must list: tenants, users, role_assignments, partner_profiles,
# submissions, delivery_attempts, inbound_receipts, key_references,
# audit_events, incidents, approvals, webhooks, api_keys,
# retention_policies, exchange_profiles, source_systems,
# webhook_delivery_attempts
```

Apply audit RLS policy:

```bash
docker exec sep-postgres psql -U sep -d sep_dev \
  -f /docker-entrypoint-initdb.d/rls_audit.sql 2>/dev/null || \
docker exec -i sep-postgres psql -U sep -d sep_dev << 'SQL'
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_only ON audit_events FOR INSERT WITH CHECK (true);
REVOKE UPDATE ON audit_events FROM sep;
REVOKE DELETE ON audit_events FROM sep;
SQL
echo "RLS applied"
```

---

## PHASE 6: SEED DATABASE

```bash
pnpm --filter @sep/db exec prisma db seed
# Must output: "Seed complete" with counts for each entity
```

Verify seed:

```bash
docker exec sep-postgres psql -U sep -d sep_dev \
  -c "SELECT id, name, service_tier FROM tenants;"
# Must show at least 2 tenants: one STANDARD, one DEDICATED

docker exec sep-postgres psql -U sep -d sep_dev \
  -c "SELECT u.email, r.role FROM users u JOIN role_assignments r ON r.user_id = u.id;"
# Must show 6 users — one per role
```

---

## PHASE 7: BUILD ALL PACKAGES

```bash
pnpm build
# All packages must build with zero errors and zero TypeScript errors
```

If any package fails:

1. Run `pnpm --filter @sep/<failing-package> build` to isolate
2. Fix the error
3. Re-run full build

---

## PHASE 8: LINT

```bash
pnpm lint
# Must exit 0 with zero errors and zero warnings
```

```bash
pnpm format:check
# Must exit 0
```

---

## PHASE 9: TYPE CHECK

```bash
pnpm typecheck
# Must exit 0. Zero type errors across all packages.
```

---

## PHASE 10: UNIT TESTS

```bash
pnpm test:unit
# All test suites must pass.
# Coverage thresholds must be met (see vitest.workspace.ts).
```

Key test suites that must pass:

- `packages/common` — SepError construction, ErrorCode completeness, config validation
- `packages/schemas` — Zod schema parse/reject for every entity
- `packages/crypto` — Interface contract, policy validation, fail-closed behaviour
- `packages/observability` — Redaction of all sensitive field paths
- `packages/db` — Client singleton, seed idempotency

---

## PHASE 11: SECURITY GATE

Run the secret scanner:

```bash
grep -rn \
  --include="*.ts" --include="*.js" --include="*.json" --include="*.yaml" \
  -E "(privateKey|passphrase|VAULT_TOKEN|JWT_SECRET|password\s*=\s*['\"][^'\"]{4})" \
  . \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude="*.example" \
  --exclude="seed*.ts"
# Must return zero matches
```

Verify no `process.env` direct access in business logic:

```bash
grep -rn "process\.env\." \
  apps/ packages/ \
  --include="*.ts" \
  --exclude-dir=node_modules \
  | grep -v "\.config\." \
  | grep -v "config\.ts" \
  | grep -v "main\.ts"
# Must return zero matches
```

Verify audit events are append-only:

```bash
docker exec sep-postgres psql -U sep -d sep_dev \
  -c "SELECT * FROM pg_policies WHERE tablename = 'audit_events';"
# Must show the insert-only policy
```

---

## PHASE 12: CONTRACT TEST BASELINE

```bash
pnpm test:contract
# All Pact contracts must be generated cleanly.
# No provider verification needed yet — consumers generate contracts in M0.
```

---

## PHASE 13: CI PIPELINE VALIDATION

```bash
# Validate CI YAML syntax
docker run --rm -v $(pwd):/repo \
  python:3.11-slim \
  python -c "import yaml; yaml.safe_load(open('/repo/.github/workflows/ci.yml'))"
echo "CI YAML valid"
```

---

## PHASE 14: COMMIT M0

When all phases pass:

```bash
git add -A
git commit -m "feat: M0 complete — repository bootstrap

- pnpm workspace with 6 packages and 3 apps
- Prisma schema with all domain entities and fixed relations
- Docker Compose infra: postgres, redis, minio, vault, prometheus, grafana
- Full TypeScript strict mode across all packages
- Vitest with coverage thresholds
- ESLint zero-warning policy
- Audit event RLS (append-only)
- Database seeded with all 6 roles
- All quality gates pass"
```

Update PLANS.md:

- Set M0 status to COMPLETE
- Record actual completion date
- Note any open decisions discovered during execution

---

## M0 EXIT CRITERIA CHECKLIST

Before marking M0 complete, verify every item:

- [ ] `pnpm install` exits 0
- [ ] `pnpm build` exits 0 across all 9 packages/apps
- [ ] `pnpm lint` exits 0 with zero warnings
- [ ] `pnpm typecheck` exits 0 with zero errors
- [ ] `pnpm test:unit` exits 0, all suites pass
- [ ] `docker compose up -d` all services healthy
- [ ] `prisma migrate dev` applied cleanly
- [ ] All 17 tables exist in database
- [ ] Audit RLS append-only policy applied
- [ ] Seed runs idempotently (run twice, same result)
- [ ] Zero secrets in source files
- [ ] Zero direct `process.env` access outside config layer
- [ ] CI YAML valid
- [ ] PLANS.md updated

---

## IF BLOCKED

If you cannot complete a step:

1. Run `pnpm --filter @sep/<package> build 2>&1 | head -50` to see the first errors
2. Fix only the specific error shown — do not refactor surrounding code
3. Record the blocker in PLANS.md under M0 with tag [BLOCKED]
4. Do not silently choose a different approach for security-affecting code
5. Report what decision is needed and propose 2-3 bounded options

Do not proceed to M1 until M0 exit criteria are all checked.

---

## NEXT SESSION

When M0 is complete, the next Claude Code session prompt is:
"Read CLAUDE.md. M0 is complete per PLANS.md. Execute M1: Domain and Control Plane Baseline."
