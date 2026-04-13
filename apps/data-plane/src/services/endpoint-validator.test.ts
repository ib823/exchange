/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@sep/common';
import { validateDeliveryEndpoint } from './endpoint-validator';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('validateDeliveryEndpoint', () => {
  it('allows a valid public IP', () => {
    expect(() => validateDeliveryEndpoint('203.130.45.12')).not.toThrow();
  });

  it('allows a valid hostname', () => {
    expect(() => validateDeliveryEndpoint('partner.bank.com.my')).not.toThrow();
  });

  // RFC1918 private ranges
  it.each([
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.168.255.255',
  ])('blocks private IPv4 %s', (ip) => {
    expect(() => validateDeliveryEndpoint(ip))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });

  // Loopback
  it.each(['127.0.0.1', '127.255.255.255'])('blocks loopback %s', (ip) => {
    expect(() => validateDeliveryEndpoint(ip))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });

  // Cloud metadata
  it('blocks cloud metadata IP 169.254.169.254', () => {
    expect(() => validateDeliveryEndpoint('169.254.169.254'))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });

  it('blocks cloud metadata IP 169.254.170.2', () => {
    expect(() => validateDeliveryEndpoint('169.254.170.2'))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });

  // Blocked hostnames
  it.each(['localhost', 'metadata.google.internal', 'kubernetes.default'])(
    'blocks hostname %s', (host) => {
      expect(() => validateDeliveryEndpoint(host))
        .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
    },
  );

  // IPv6
  it('blocks IPv6 loopback ::1', () => {
    expect(() => validateDeliveryEndpoint('::1'))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });

  it('blocks IPv6 link-local fe80:', () => {
    expect(() => validateDeliveryEndpoint('fe80::1'))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });

  // Link-local
  it('blocks link-local 169.254.x.x', () => {
    expect(() => validateDeliveryEndpoint('169.254.1.1'))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });

  // Multicast
  it('blocks multicast 224.x.x.x', () => {
    expect(() => validateDeliveryEndpoint('224.0.0.1'))
      .toThrow(expect.objectContaining({ code: ErrorCode.DELIVERY_ENDPOINT_BLOCKED }));
  });
});
