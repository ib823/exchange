/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@sep/common';
import {
  parsePartnerProfileConfig,
  PartnerProfileConfigSchema,
} from './partner-profile-config.schema';

const validSftp = {
  host: 'sftp.bank.example',
  port: 22,
  username: 'sep-client',
  hostKeyFingerprint: 'SHA256:abc123',
  uploadPath: '/upload',
  downloadPath: '/download',
};

const validHttps = {
  baseUrl: 'https://api.regulator.example',
  authType: 'bearer',
};

describe('PartnerProfileConfigSchema', () => {
  it('accepts nested SFTP config', () => {
    const result = PartnerProfileConfigSchema.safeParse({ sftp: validSftp });
    expect(result.success).toBe(true);
  });

  it('accepts nested HTTPS config', () => {
    const result = PartnerProfileConfigSchema.safeParse({ https: validHttps });
    expect(result.success).toBe(true);
  });

  it('accepts both sftp and https present (no enforcement at schema level)', () => {
    const result = PartnerProfileConfigSchema.safeParse({ sftp: validSftp, https: validHttps });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (transport-coherence is enforced by the parser, not the schema)', () => {
    const result = PartnerProfileConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('tolerates forward-compatible extra keys (e.g., seed _note)', () => {
    const result = PartnerProfileConfigSchema.safeParse({
      _note: 'Seed only',
      sftp: validSftp,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(PartnerProfileConfigSchema.safeParse(null).success).toBe(false);
    expect(PartnerProfileConfigSchema.safeParse('string').success).toBe(false);
    expect(PartnerProfileConfigSchema.safeParse(42).success).toBe(false);
  });

  it('rejects malformed sftp sub-object (empty host)', () => {
    const result = PartnerProfileConfigSchema.safeParse({
      sftp: { ...validSftp, host: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed sftp sub-object (missing hostKeyFingerprint)', () => {
    const withoutFingerprint: Record<string, unknown> = { ...validSftp };
    delete withoutFingerprint['hostKeyFingerprint'];
    const result = PartnerProfileConfigSchema.safeParse({ sftp: withoutFingerprint });
    expect(result.success).toBe(false);
  });
});

describe('parsePartnerProfileConfig', () => {
  it('SFTP happy path', () => {
    const result = parsePartnerProfileConfig('SFTP', { sftp: validSftp });
    expect(result.sftp?.host).toBe('sftp.bank.example');
  });

  it('HTTPS happy path', () => {
    const result = parsePartnerProfileConfig('HTTPS', { https: validHttps });
    expect(result.https?.baseUrl).toBe('https://api.regulator.example');
  });

  it('AS2 happy path (permissive — any object)', () => {
    const result = parsePartnerProfileConfig('AS2', { as2Id: 'BANK', partnerAs2Id: 'SEP' });
    // Extra keys pass through; no sub-object requirement
    expect(result).toMatchObject({ as2Id: 'BANK' });
  });

  it('AS2 accepts empty object (M3.5 will tighten)', () => {
    const result = parsePartnerProfileConfig('AS2', {});
    expect(result).toEqual({});
  });

  // Transport-coherence — load-bearing for NEW-04
  it('throws PARTNER_CONFIG_INVALID when SFTP profile has no sftp sub-object', () => {
    try {
      parsePartnerProfileConfig('SFTP', { https: validHttps });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.PARTNER_CONFIG_INVALID);
      const ctx = (err as { context?: { issues?: Array<{ path: string }> } }).context;
      expect(ctx?.issues?.[0]?.path).toBe('sftp');
    }
  });

  it('throws PARTNER_CONFIG_INVALID when HTTPS profile has no https sub-object', () => {
    try {
      parsePartnerProfileConfig('HTTPS', { sftp: validSftp });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.PARTNER_CONFIG_INVALID);
      const ctx = (err as { context?: { issues?: Array<{ path: string }> } }).context;
      expect(ctx?.issues?.[0]?.path).toBe('https');
    }
  });

  it('throws PARTNER_CONFIG_INVALID on malformed sftp sub-object (surfaces Zod issues)', () => {
    try {
      parsePartnerProfileConfig('SFTP', { sftp: { ...validSftp, host: '' } });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.PARTNER_CONFIG_INVALID);
      const ctx = (err as { context?: { issues?: Array<{ path: string }> } }).context;
      expect(ctx?.issues?.some((i) => i.path.includes('host'))).toBe(true);
    }
  });

  it('throws PARTNER_CONFIG_INVALID on null config for SFTP', () => {
    try {
      parsePartnerProfileConfig('SFTP', null);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.PARTNER_CONFIG_INVALID);
    }
  });

  it('error context carries transportProtocol for operator debug', () => {
    try {
      parsePartnerProfileConfig('SFTP', { https: validHttps });
      throw new Error('expected throw');
    } catch (err) {
      const ctx = (err as { context?: { transportProtocol?: string } }).context;
      expect(ctx?.transportProtocol).toBe('SFTP');
    }
  });
});
