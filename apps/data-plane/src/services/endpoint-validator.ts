/**
 * Delivery endpoint IP validation.
 *
 * Validates that a resolved IP/hostname is not in any private, loopback,
 * link-local, or cloud metadata range. Used by SFTP and HTTPS connectors
 * before every delivery attempt.
 *
 * This extends the URL validator from packages/common with IP-level checks
 * specifically for transport endpoints.
 */

import { SepError, ErrorCode } from '@sep/common';

const BLOCKED_IPV4_PREFIXES = [
  '0.', '10.', '127.', '169.254.',
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.', '192.0.0.', '192.0.2.',
  '198.51.100.', '203.0.113.',
  '224.', '240.', '255.',
];

const BLOCKED_IPV6_PREFIXES = [
  '::1', 'fe80:', 'fc00:', 'fd00:',
  '::ffff:127.', '::ffff:10.', '::ffff:169.254.',
  '::ffff:192.168.',
];

const BLOCKED_EXACT_IPS = new Set([
  '169.254.169.254', '169.254.170.2', 'fd00:ec2::254',
]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'metadata.google.internal', 'metadata.internal',
  'kubernetes.default', 'kubernetes.default.svc',
]);

export function validateDeliveryEndpoint(host: string): void {
  const normalized = host.toLowerCase().trim();

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    throw new SepError(ErrorCode.DELIVERY_ENDPOINT_BLOCKED, {
      message: `Blocked hostname: ${normalized}`,
    });
  }

  if (BLOCKED_EXACT_IPS.has(normalized)) {
    throw new SepError(ErrorCode.DELIVERY_ENDPOINT_BLOCKED, {
      message: `Blocked IP: ${normalized}`,
    });
  }

  // IPv4 check
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    for (const prefix of BLOCKED_IPV4_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        throw new SepError(ErrorCode.DELIVERY_ENDPOINT_BLOCKED, {
          message: `Private/reserved IPv4: ${normalized}`,
        });
      }
    }
  }

  // IPv6 check
  if (normalized.includes(':')) {
    for (const prefix of BLOCKED_IPV6_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        throw new SepError(ErrorCode.DELIVERY_ENDPOINT_BLOCKED, {
          message: `Private/reserved IPv6: ${normalized}`,
        });
      }
    }
  }
}
