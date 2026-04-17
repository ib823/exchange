#!/usr/bin/env node
/**
 * verify-m3-0-findings.mjs
 *
 * Mechanical verification of M3.0's closure claims against the current
 * codebase state. Referenced by _plan/M3_0_FOUNDATION_RESET.md §14.
 *
 * Three outcomes per check:
 *   OK    — closure verified; M3.0 claim matches code
 *   FAIL  — regression of a previously-verified M3.0 closure
 *   BLOCK — M3.0 claim-reality mismatch that must close in M3.A0 before
 *           M3 execution can responsibly start
 *
 * Exit codes:
 *   0 = all checks OK
 *   1 = any FAIL or BLOCK
 *   2 = script-level error (bad path, missing lockfile, etc.)
 *
 * Usage (from repo root):
 *   node _plan/scripts/verify-m3-0-findings.mjs
 *
 * Intentionally zero-dependency (no npm install required).
 *
 * ─── M3-scope checks (NOT part of M3.0 verification) ────────────────
 * The following checks were previously included in this script based on
 * the M3.0 plan's aspirations. The M3.0 handoff note explicitly defers
 * them to M3:
 *   - PRIOR-R6-003 (key expiry 90-day tier)   → M3.A3
 *   - NEW-02 (retry jitter)                    → M3.A7
 *   - NEW-03 (withTimeout helper)              → M3.A7
 *   - NEW-08 (OTEL NodeSDK runtime wiring)     → M3.A9
 * They belong in _plan/scripts/verify-m3-findings.mjs (authored at M3
 * start), not here. Removed to keep this script's scope honest.
 *
 * Documented residual budgets from _plan/M3_0_HANDOFF.md §2 "Regression
 * posture". Count-based checks respect these as ceilings, not "0-or-fail".
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = process.cwd();

const RESIDUAL_BUDGETS = {
  PLAIN_THROW_NEW_ERROR: 2,   // config loader + db service bootstrap-time
  AS_UNKNOWN_AS: 5,           // 5 processor/auth casts deferred to M3.A10
};

// ─── Helpers ────────────────────────────────────────────────────────
function grep(patterns, { includeGlob, excludeDirs = ['node_modules', '.git', 'dist', 'build', '.turbo', '.next'] } = {}) {
  const pat = Array.isArray(patterns) ? patterns.join('|') : patterns;
  try {
    const cmd = [
      'grep -rEn',
      ...(includeGlob ? [`--include='${includeGlob}'`] : []),
      ...excludeDirs.map((d) => `--exclude-dir='${d}'`),
      `-- '${pat}'`,
      REPO_ROOT,
    ].join(' ');
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function readPackageJsonPaths() {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', 'build', '.next', '.turbo'].includes(entry)) continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === 'package.json') out.push(p);
    }
  }
  walk(REPO_ROOT);
  return out;
}

function hasDep(pkgJsonPath, name) {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name]);
}

function depsOnAnyWorkspace(name) {
  return readPackageJsonPaths().some((p) => hasDep(p, name));
}

function fileExists(rel) {
  return existsSync(join(REPO_ROOT, rel));
}

function firstExisting(candidates) {
  for (const c of candidates) {
    if (fileExists(c)) return c;
  }
  return null;
}

// ─── Finding checks ─────────────────────────────────────────────────
const checks = [
  {
    id: 'PRIOR-R1-001',
    description: 'CI SHA-pinning: every `uses:` ref ends in 40-char SHA',
    check: () => {
      const workflowsDir = join(REPO_ROOT, '.github/workflows');
      if (!existsSync(workflowsDir)) return { ok: false, detail: '.github/workflows not found' };
      const workflows = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
      const violations = [];
      for (const w of workflows) {
        const content = readFileSync(join(workflowsDir, w), 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          const noComment = line.split('#')[0];
          const m = noComment.match(/uses:\s*(\S+)/);
          if (!m) return;
          const ref = m[1];
          if (ref.startsWith('./') || ref.startsWith('docker://')) return;
          if (!/@[0-9a-f]{40}$/.test(ref)) violations.push(`${w}:${i + 1}  ${ref}`);
        });
      }
      return violations.length === 0
        ? { ok: true }
        : { ok: false, detail: `${violations.length} unpinned action(s):\n  ` + violations.join('\n  ') };
    },
  },
  {
    id: 'PRIOR-R1-003',
    description: 'TypeScript project references: composite:true on all package tsconfigs',
    blocksM3: true,
    blockReason: 'M3.0 T07 partially executed; composite absent from base and per-package tsconfigs. Must close in M3.A0.',
    check: () => {
      const pkgTsconfigs = [];
      for (const root of ['packages', 'apps']) {
        const rootDir = join(REPO_ROOT, root);
        if (!existsSync(rootDir)) continue;
        for (const dir of readdirSync(rootDir)) {
          const t = join(rootDir, dir, 'tsconfig.json');
          if (existsSync(t)) pkgTsconfigs.push(relative(REPO_ROOT, t));
        }
      }
      const baseHasComposite = (() => {
        const basePath = join(REPO_ROOT, 'tsconfig.base.json');
        if (!existsSync(basePath)) return false;
        return /["']composite["']\s*:\s*true/.test(readFileSync(basePath, 'utf8'));
      })();
      const missing = pkgTsconfigs.filter((t) => {
        const content = readFileSync(join(REPO_ROOT, t), 'utf8');
        if (/["']composite["']\s*:\s*true/.test(content)) return false;
        if (baseHasComposite && /extends.*tsconfig\.base\.json/.test(content)) return false;
        return true;
      });
      return missing.length === 0
        ? { ok: true }
        : { ok: false, detail: `composite:true missing (not inherited from base) in:\n  ${missing.join('\n  ')}` };
    },
  },
  {
    id: 'PRIOR-R1-004-dockerignore',
    description: 'R1-004 (part): .dockerignore exists',
    check: () => fileExists('.dockerignore') ? { ok: true } : { ok: false, detail: '.dockerignore missing' },
  },
  {
    id: 'PRIOR-R1-004-hooks',
    description: 'R1-004 (part): pre-commit hooks configured (lefthook)',
    check: () =>
      fileExists('lefthook.yml') || fileExists('.husky') || fileExists('.lefthook.yml')
        ? { ok: true }
        : { ok: false, detail: 'no lefthook.yml / .husky/ found' },
  },
  {
    id: 'PRIOR-R3-003',
    description: 'R3-003: no `body as {...}` cast pattern in controllers',
    check: () => {
      const hits = grep(['body as \\{ targetStatus', 'body as \\{ notes'], { includeGlob: '*.ts' });
      const runtime = hits.filter((h) => !h.includes('.test.ts') && !h.includes('_plan/') && !h.includes('_audit/'));
      return runtime.length === 0
        ? { ok: true }
        : { ok: false, detail: `${runtime.length} unsafe body casts remain:\n  ${runtime.slice(0, 5).join('\n  ')}` };
    },
  },
  {
    id: 'PRIOR-R4-001',
    description: `R4-001: plain \`throw new Error\` count within documented budget (<=${RESIDUAL_BUDGETS.PLAIN_THROW_NEW_ERROR})`,
    check: () => {
      const hits = grep(['throw new Error\\('], { includeGlob: '*.ts' });
      const runtime = hits.filter(
        (h) => !h.includes('.test.ts') && !h.includes('_plan/') && !h.includes('_audit/')
             && !h.includes('/scripts/') && !h.includes('tests/') && !h.includes('seed.ts'),
      );
      if (runtime.length <= RESIDUAL_BUDGETS.PLAIN_THROW_NEW_ERROR) {
        return runtime.length === 0
          ? { ok: true }
          : { ok: true, detail: `${runtime.length}/${RESIDUAL_BUDGETS.PLAIN_THROW_NEW_ERROR} budget used (deferred to M3; within limit)` };
      }
      return {
        ok: false,
        detail: `${runtime.length} exceeds budget of ${RESIDUAL_BUDGETS.PLAIN_THROW_NEW_ERROR}:\n  ${runtime.slice(0, 6).join('\n  ')}`,
      };
    },
  },
  {
    id: 'PRIOR-R4-002',
    description: `R4-002: \`as unknown as\` count within documented budget (<=${RESIDUAL_BUDGETS.AS_UNKNOWN_AS})`,
    check: () => {
      const hits = grep([' as unknown as '], { includeGlob: '*.ts' });
      const runtime = hits.filter(
        (h) => !h.includes('.test.ts') && !h.includes('_plan/') && !h.includes('_audit/') && !h.includes('tests/'),
      );
      if (runtime.length <= RESIDUAL_BUDGETS.AS_UNKNOWN_AS) {
        return runtime.length === 0
          ? { ok: true }
          : { ok: true, detail: `${runtime.length}/${RESIDUAL_BUDGETS.AS_UNKNOWN_AS} budget used (deferred to M3; within limit)` };
      }
      return {
        ok: false,
        detail: `${runtime.length} exceeds budget of ${RESIDUAL_BUDGETS.AS_UNKNOWN_AS}:\n  ${runtime.slice(0, 6).join('\n  ')}`,
      };
    },
  },
  {
    id: 'PRIOR-R4-003',
    description: 'R4-003: exports `types` condition first (Node16/NodeNext resolves conditions in order)',
    blocksM3: true,
    blockReason: 'M3.0 T21 partially executed; `types` condition appears last in every package exports block. Must close in M3.A0.',
    check: () => {
      const pkgs = readPackageJsonPaths().filter((p) => p.includes('/packages/') || p.includes('/apps/'));
      const bad = [];
      for (const p of pkgs) {
        const pkg = JSON.parse(readFileSync(p, 'utf8'));
        if (!pkg.exports || typeof pkg.exports !== 'object') continue;
        for (const [key, conditions] of Object.entries(pkg.exports)) {
          if (typeof conditions !== 'object' || conditions === null) continue;
          const keys = Object.keys(conditions);
          if (keys.includes('types') && keys[0] !== 'types') {
            bad.push(`${relative(REPO_ROOT, p)}: exports['${key}'] — types is '${keys[keys.indexOf('types')]}' at position ${keys.indexOf('types') + 1}`);
          }
        }
      }
      return bad.length === 0
        ? { ok: true }
        : {
            ok: false,
            detail:
              `\`types\` must appear BEFORE import/require in exports conditions, or TypeScript silently ` +
              `falls back to non-types resolution (effectively ignoring your types entry). ` +
              `Affects ${bad.length} package(s):\n  ${bad.join('\n  ')}`,
          };
    },
  },
  {
    id: 'PRIOR-R5-001',
    description: 'R5-001: no caret ranges on production dependencies (non-root manifests)',
    check: () => {
      const bad = [];
      for (const p of readPackageJsonPaths()) {
        if (p === join(REPO_ROOT, 'package.json')) continue;
        const pkg = JSON.parse(readFileSync(p, 'utf8'));
        for (const [name, range] of Object.entries(pkg.dependencies || {})) {
          if (typeof range !== 'string') continue;
          if (range.startsWith('^') && !range.startsWith('^workspace')) {
            bad.push(`${relative(REPO_ROOT, p)}: ${name} -> ${range}`);
          }
        }
      }
      return bad.length === 0
        ? { ok: true }
        : { ok: false, detail: `${bad.length} caret-ranged production deps:\n  ${bad.slice(0, 8).join('\n  ')}` };
    },
  },
  {
    id: 'PRIOR-R5-002',
    description: 'R5-002: working SCA gate (osv-scanner or audit-ci referenced in CI)',
    check: () => {
      const hits = grep(['osv-scanner|audit-ci'], { includeGlob: '*.yml' });
      const inWorkflow = hits.some((h) => h.includes('.github/workflows/'));
      return inWorkflow
        ? { ok: true }
        : { ok: false, detail: 'no osv-scanner or audit-ci reference in .github/workflows/' };
    },
  },
  // ─── M3-scope checks removed (see file header) ────────────────────
  // Formerly here: PRIOR-R6-003, NEW-02, NEW-03, NEW-08. These belong in
  // _plan/scripts/verify-m3-findings.mjs authored at M3 start.
  {
    id: 'REMOVED-passport',
    description: 'passport stack removed from all manifests',
    check: () => {
      const present = ['passport', 'passport-jwt', 'passport-local', '@nestjs/passport']
        .filter((n) => depsOnAnyWorkspace(n));
      return present.length === 0
        ? { ok: true }
        : { ok: false, detail: `still present: ${present.join(', ')}` };
    },
  },
  {
    id: 'REMOVED-class-validator',
    description: 'class-validator + class-transformer removed',
    check: () => {
      const present = ['class-validator', 'class-transformer'].filter((n) => depsOnAnyWorkspace(n));
      return present.length === 0
        ? { ok: true }
        : { ok: false, detail: `still present: ${present.join(', ')}` };
    },
  },
  {
    id: 'REMOVED-bcrypt',
    description: 'bcrypt removed; @node-rs/argon2 installed',
    check: () => {
      if (depsOnAnyWorkspace('bcrypt')) return { ok: false, detail: 'bcrypt still present' };
      if (!depsOnAnyWorkspace('@node-rs/argon2')) return { ok: false, detail: '@node-rs/argon2 not installed' };
      return { ok: true };
    },
  },
  {
    id: 'ADDED-nestjs-zod',
    description: 'nestjs-zod installed (replaces class-validator at controller boundary)',
    check: () =>
      depsOnAnyWorkspace('nestjs-zod')
        ? { ok: true }
        : { ok: false, detail: 'nestjs-zod not installed' },
  },
  {
    id: 'NEW-05',
    description: 'NEW-05: no `body as { notes...}` cast in approvals controller',
    check: () => {
      const hits = grep(['body as \\{ notes'], { includeGlob: '*.ts' });
      const runtime = hits.filter((h) => !h.includes('.test.ts') && !h.includes('_plan/') && !h.includes('_audit/'));
      return runtime.length === 0
        ? { ok: true }
        : { ok: false, detail: `${runtime.length} unsafe casts remain:\n  ${runtime.join('\n  ')}` };
    },
  },
  {
    id: 'NEW-06',
    description: 'NEW-06: API URI versioning enabled (VersioningType.URI)',
    check: () => {
      const hits = grep(['VersioningType\\.URI'], { includeGlob: '*.ts' });
      return hits.length > 0
        ? { ok: true }
        : { ok: false, detail: 'VersioningType.URI not found (expected in apps/control-plane/src/main.ts)' };
    },
  },
  {
    id: 'NEW-09',
    description: 'NEW-09: single openpgp version across lockfile',
    check: () => {
      const lockPath = join(REPO_ROOT, 'pnpm-lock.yaml');
      if (!existsSync(lockPath)) return { ok: false, detail: 'pnpm-lock.yaml missing' };
      const lock = readFileSync(lockPath, 'utf8');
      const matches = Array.from(lock.matchAll(/openpgp@([\d]+\.[\d]+\.[\d]+)/g)).map((m) => m[1]);
      const unique = new Set(matches);
      if (unique.size === 0) return { ok: false, detail: 'openpgp not found in lockfile' };
      return unique.size === 1
        ? { ok: true, detail: `single version: ${[...unique][0]}` }
        : { ok: false, detail: `multiple openpgp versions: ${[...unique].join(', ')}` };
    },
  },
  {
    id: 'NEW-TEST-COUNT-REFUTED',
    description: 'NEW-TEST-COUNT: refutation recorded in PLANS.md (not remediated)',
    check: () => {
      const plans = join(REPO_ROOT, 'PLANS.md');
      if (!existsSync(plans)) return { ok: false, detail: 'PLANS.md missing' };
      const content = readFileSync(plans, 'utf8');
      const hasCorrectionsSection = /Documentation corrections/i.test(content);
      const referencesRefutation = /(NEW-TEST-COUNT|it\.each|runner|refut)/i.test(content);
      return hasCorrectionsSection && referencesRefutation
        ? { ok: true, detail: 'Documentation-corrections section present with refutation context' }
        : { ok: false, detail: 'expected "Documentation corrections" section referencing the refutation' };
    },
  },
  {
    id: 'ENV-scrubbed',
    description: '.env.example scrubbed of resolvable-looking credentials',
    check: () => {
      const p = join(REPO_ROOT, '.env.example');
      if (!existsSync(p)) return { ok: false, detail: '.env.example missing' };
      const content = readFileSync(p, 'utf8');
      const forbidden = ['minioadmin', 'dev-root-token', 'change-me-in-prod'];
      const present = forbidden.filter((f) => content.includes(f));
      return present.length === 0
        ? { ok: true }
        : { ok: false, detail: `resolvable creds still present: ${present.join(', ')}` };
    },
  },
  {
    id: 'ADR-0001',
    description: 'ADR-0001 exists and is substantive (>=1KB)',
    check: () => {
      const candidates = [
        'docs/adr/0001-zod-everywhere-validation.md',
        'docs/adr/0001-dependency-choices.md',
        'docs/adr/0001-zod-everywhere.md',
      ];
      for (const c of candidates) {
        const p = join(REPO_ROOT, c);
        if (!existsSync(p)) continue;
        const stats = statSync(p);
        if (stats.size >= 1000) return { ok: true, detail: `${c} (${stats.size} bytes)` };
        return { ok: false, detail: `${c} exists but only ${stats.size} bytes` };
      }
      return { ok: false, detail: `no ADR-0001 found; expected one of: ${candidates.join(', ')}` };
    },
  },
  {
    id: 'ADR-SET',
    description: 'ADR-0001..0005 from M3.0 + ADR-0006 from hygiene #11',
    check: () => {
      const adrDir = join(REPO_ROOT, 'docs/adr');
      if (!existsSync(adrDir)) return { ok: false, detail: 'docs/adr/ missing' };
      const files = readdirSync(adrDir);
      const ids = ['0001', '0002', '0003', '0004', '0005', '0006'];
      const missing = ids.filter((id) => !files.some((f) => f.startsWith(`${id}-`) && f.endsWith('.md')));
      return missing.length === 0
        ? { ok: true, detail: 'all 6 ADRs present' }
        : { ok: false, detail: `missing ADR(s): ${missing.join(', ')}` };
    },
  },
  {
    id: 'CODEOWNERS',
    description: 'CODEOWNERS file exists',
    check: () =>
      fileExists('.github/CODEOWNERS') || fileExists('CODEOWNERS') || fileExists('docs/CODEOWNERS')
        ? { ok: true }
        : { ok: false, detail: 'CODEOWNERS missing' },
  },
  // ─── Hygiene PR verification (post-m3.0-baseline) ───────────────────
  {
    id: 'HYGIENE-fastify-override',
    description: 'Hygiene #11: fastify pinned to 5.8.5 in pnpm.overrides',
    check: () => {
      const p = join(REPO_ROOT, 'package.json');
      const pkg = JSON.parse(readFileSync(p, 'utf8'));
      const override = pkg?.pnpm?.overrides?.fastify;
      return override === '5.8.5'
        ? { ok: true }
        : { ok: false, detail: `expected pnpm.overrides.fastify === "5.8.5"; got ${JSON.stringify(override)}` };
    },
  },
  {
    id: 'HYGIENE-osv-config',
    description: 'Hygiene #11: .osv-scanner config has vite+esbuild waivers',
    check: () => {
      const candidates = ['.osv-scanner.toml', 'osv-scanner.toml', '.osv-scanner.yml', '.osv-scanner.yaml'];
      const p = firstExisting(candidates);
      if (!p) return { ok: false, detail: `none of ${candidates.join('/')} present` };
      const content = readFileSync(join(REPO_ROOT, p), 'utf8');
      const hasVite = /GHSA-4w7w-66w2-5vf9/.test(content);
      const hasEsbuild = /GHSA-67mh-4wv8-2f99/.test(content);
      const missing = [];
      if (!hasVite) missing.push('vite GHSA-4w7w-66w2-5vf9');
      if (!hasEsbuild) missing.push('esbuild GHSA-67mh-4wv8-2f99');
      return missing.length === 0
        ? { ok: true, detail: `waivers present in ${p}` }
        : { ok: false, detail: `${p} missing: ${missing.join(', ')}` };
    },
  },
  {
    id: 'HYGIENE-trufflehog-push-guard',
    description: 'Hygiene #14: TruffleHog gated to pull_request events',
    check: () => {
      const ciPath = firstExisting(['.github/workflows/ci.yml', '.github/workflows/ci.yaml']);
      if (!ciPath) return { ok: false, detail: 'ci.yml not found' };
      const content = readFileSync(join(REPO_ROOT, ciPath), 'utf8');
      if (!/trufflehog/i.test(content)) return { ok: true, detail: 'TruffleHog removed entirely (also acceptable)' };
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/trufflehog/i.test(lines[i])) {
          const context = lines.slice(Math.max(0, i - 10), i + 5).join('\n');
          if (/if:\s*.*pull_request/i.test(context)) return { ok: true, detail: 'pull_request guard found near TruffleHog step' };
        }
      }
      return {
        ok: false,
        detail: 'TruffleHog present but no pull_request-scoped `if:` guard visible in its surrounding context',
      };
    },
  },
];

// ─── Run ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let blocked = 0;
let passedWithDetail = 0;

console.log('\nM3.0 Findings Verification (reconciled for post-m3.0-baseline)');
console.log('='.repeat(70));

for (const c of checks) {
  let result;
  try {
    result = c.check();
  } catch (err) {
    result = { ok: false, detail: `check threw: ${err.message}` };
  }
  let status;
  if (result.ok) {
    status = 'OK   ';
    passed++;
    if (result.detail) passedWithDetail++;
  } else if (c.blocksM3) {
    status = 'BLOCK';
    blocked++;
  } else {
    status = 'FAIL ';
    failed++;
  }
  console.log(`${status}  ${c.id.padEnd(32)} ${c.description}`);
  if (!result.ok && c.blocksM3) {
    console.log(`       > M3.A0 blocker: ${c.blockReason}`);
  }
  if (result.detail) {
    const prefix = result.ok ? '       ' : '       !  ';
    console.log(`${prefix}${result.detail}`);
  }
}

console.log('='.repeat(70));
console.log(
  `\n${passed} passed (${passedWithDetail} with notes), ${failed} failed, ` +
  `${blocked} blocked (M3.A0 scope), ${checks.length} total\n`
);

if (failed > 0) {
  console.error('REGRESSION: M3.0 closure claims have broken. Resolve the FAILs above and re-run.\n');
  process.exit(1);
}
if (blocked > 0) {
  console.error('M3 NOT READY: BLOCK items are M3.0 claim-reality mismatches that M3.A0 must close.');
  console.error('These are NOT regressions — they are scope work that M3.0 plan specified but execution left incomplete.');
  console.error('Close them in M3.A0 before the substantive M3 task groups begin.\n');
  process.exit(1);
}
console.log('All M3.0 closures mechanically verified. Safe to proceed with M3 execution.\n');
process.exit(0);
