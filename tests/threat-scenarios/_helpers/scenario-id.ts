/**
 * Scenario-ID utilities (M3.A8).
 *
 * Each test file names its scenario via SCENARIO_ID at the top. The
 * helper `scenarioTitle` wraps the describe() title so the
 * scenario-ID appears in every failure log line — the first thing
 * an ops engineer sees when a threat test fails in CI.
 */

/** Scenario IDs match the plan §6 inventory. */
export const SCENARIO_IDS = Object.freeze({
  T1: 'T01_stolen_operator_credential',
  T2: 'T02_mis_routed_payload',
  T3: 'T03_wrong_partner_public_key',
  T4: 'T04_expired_key',
  T5: 'T05_replayed_submission',
  T6: 'T06_tampered_acknowledgement',
  T7: 'T07_secret_in_logs',
  T8: 'T08_cross_tenant_data_exposure',
  T9: 'T09_unauthorised_partner_profile_change',
  T10: 'T10_malicious_connector_ssrf',
  T11: 'T11_key_rotation_mid_flight',
  T12: 'T12_refresh_token_replay',
  T13: 'T13_brute_force_login',
  T14: 'T14_audit_chain_tampering',
});

export type ScenarioKey = keyof typeof SCENARIO_IDS;

export function scenarioTitle(key: ScenarioKey, description: string): string {
  return `[${SCENARIO_IDS[key]}] ${description}`;
}
