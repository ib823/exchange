/**
 * Scaffolding smoke (M3.A8 / PR 1).
 *
 * Not a real threat scenario — asserts the suite's helpers resolve
 * and the vitest config's env-gate semantics work. Keeps PR 1's
 * test-runner invocation from being a no-op while scenario files
 * land in PRs 2-5.
 */

import { describe, it, expect } from 'vitest';
import { SCENARIO_IDS, scenarioTitle } from './_helpers/scenario-id';
import { TENANTS } from './_helpers/tenants';

describe('[T00_scaffolding] smoke', () => {
  it('exposes all 14 scenario IDs (T1 through T14)', () => {
    const keys = Object.keys(SCENARIO_IDS);
    expect(keys).toHaveLength(14);
    expect(keys).toContain('T1');
    expect(keys).toContain('T14');
  });

  it('each scenario ID has a distinct per-scenario tenant cuid', () => {
    const values = Object.values(TENANTS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('scenarioTitle prefixes descriptions with scenario ID', () => {
    expect(scenarioTitle('T1', 'stolen credential flow')).toBe(
      '[T01_stolen_operator_credential] stolen credential flow',
    );
  });
});
