import { describe, it, expect } from 'vitest';
import { validatePartnerProfile } from './profile.validator';

describe('validatePartnerProfile', () => {
  const validProfile = {
    tenantId: 'clx2qwertyuiop1234567890',
    name: 'Test Bank Profile',
    partnerType: 'BANK',
    environment: 'TEST',
    transportProtocol: 'SFTP',
    messageSecurityMode: 'SIGN_ENCRYPT',
    config: {
      sftp: {
        host: 'sftp.bank.com',
        port: 22,
        username: 'bankuser',
        hostKeyFingerprint: 'SHA256:abc123def456',
        uploadPath: '/incoming',
        downloadPath: '/outgoing',
      },
    },
  };

  it('accepts a valid SFTP bank profile', () => {
    const result = validatePartnerProfile(validProfile);
    expect(result.name).toBe('Test Bank Profile');
    expect(result.partnerType).toBe('BANK');
    expect(result.transportProtocol).toBe('SFTP');
  });

  it('rejects profile with missing required fields', () => {
    expect(() => validatePartnerProfile({ name: 'Incomplete' }))
      .toThrow('VALIDATION_SCHEMA_FAILED');
  });

  it('rejects SFTP profile without sftp config', () => {
    const noSftpConfig = { ...validProfile, config: {} };
    expect(() => validatePartnerProfile(noSftpConfig))
      .toThrow('VALIDATION_SCHEMA_FAILED');
  });

  it('rejects HTTPS profile without https config', () => {
    const httpsNoConfig = { ...validProfile, transportProtocol: 'HTTPS', config: {} };
    expect(() => validatePartnerProfile(httpsNoConfig))
      .toThrow('VALIDATION_SCHEMA_FAILED');
  });

  it('accepts HTTPS profile with https config', () => {
    const httpsProfile = {
      ...validProfile,
      transportProtocol: 'HTTPS',
      config: { https: { baseUrl: 'https://api.bank.com', authType: 'bearer' } },
    };
    const result = validatePartnerProfile(httpsProfile);
    expect(result.transportProtocol).toBe('HTTPS');
  });

  it('rejects invalid environment', () => {
    const badEnv = { ...validProfile, environment: 'STAGING' };
    expect(() => validatePartnerProfile(badEnv)).toThrow('VALIDATION_SCHEMA_FAILED');
  });

  it('rejects invalid partner type', () => {
    const badType = { ...validProfile, partnerType: 'INVALID' };
    expect(() => validatePartnerProfile(badType)).toThrow('VALIDATION_SCHEMA_FAILED');
  });
});
