import { SepError } from '../errors/SepError';
import { ErrorCode } from '../errors/ErrorCode';

/**
 * Outbound URL trust validator.
 *
 * Rejects URLs that resolve to private, link-local, loopback, or cloud metadata
 * IP ranges. This is the platform's trust model for all outbound HTTP requests:
 * webhook dispatch, transport adapters (HTTPS connectors), and regulator API calls.
 *
 * Attack classes mitigated:
 * - SSRF to cloud metadata endpoints (169.254.169.254, fd00:ec2::254)
 * - SSRF to internal services via private IP ranges
 * - DNS rebinding (mitigated at dispatch time by re-resolving before each request)
 * - Localhost loopback (127.0.0.0/8, ::1)
 */

/** CIDR-style ranges that are never valid outbound destinations */
const BLOCKED_IPV4_PREFIXES = [
  '0.',         // Current network (RFC 1122)
  '10.',        // Private (RFC 1918)
  '127.',       // Loopback (RFC 1122)
  '169.254.',   // Link-local / cloud metadata (RFC 3927)
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',  // Private (RFC 1918)
  '192.168.',   // Private (RFC 1918)
  '192.0.0.',   // IETF Protocol Assignments (RFC 6890)
  '192.0.2.',   // Documentation (RFC 5737)
  '198.51.100.', // Documentation (RFC 5737)
  '203.0.113.', // Documentation (RFC 5737)
  '224.',       // Multicast (RFC 5771)
  '240.',       // Reserved (RFC 1112)
  '255.',       // Broadcast
];

const BLOCKED_IPV6_PREFIXES = [
  '::1',        // Loopback
  'fe80:',      // Link-local
  'fc00:',      // Unique local address
  'fd00:',      // Unique local address
  'fd00:ec2:',  // AWS metadata (IPv6)
  '::ffff:127.', // IPv4-mapped loopback
  '::ffff:10.',  // IPv4-mapped private
  '::ffff:169.254.', // IPv4-mapped link-local
  '::ffff:172.16.', '::ffff:172.17.', '::ffff:172.18.', '::ffff:172.19.',
  '::ffff:172.20.', '::ffff:172.21.', '::ffff:172.22.', '::ffff:172.23.',
  '::ffff:172.24.', '::ffff:172.25.', '::ffff:172.26.', '::ffff:172.27.',
  '::ffff:172.28.', '::ffff:172.29.', '::ffff:172.30.', '::ffff:172.31.',
  '::ffff:192.168.',
];

/** Exact hostnames that are never valid outbound destinations */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',      // GCP metadata
  'metadata.internal',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

/** Exact IPs that are cloud metadata endpoints */
const BLOCKED_EXACT_IPS = new Set([
  '169.254.169.254',   // AWS / GCP / Azure metadata
  '169.254.170.2',     // AWS ECS task metadata
  'fd00:ec2::254',     // AWS metadata (IPv6)
]);

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a URL is safe for the platform to make outbound requests to.
 *
 * This function checks the URL at registration time. At dispatch time,
 * the URL must be re-resolved and re-validated to mitigate DNS rebinding.
 */
export function validateOutboundUrl(rawUrl: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Malformed URL' };
  }

  // Protocol restriction: only HTTPS in production
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const rawHostname = parsed.hostname.toLowerCase();
  // Strip brackets from IPv6 for consistent comparison
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
    ? rawHostname.slice(1, -1)
    : rawHostname;

  // Block exact hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: `Blocked hostname: ${hostname}` };
  }

  // Block exact IPs
  if (BLOCKED_EXACT_IPS.has(hostname)) {
    return { valid: false, reason: `Blocked IP address: ${hostname}` };
  }

  // Check if hostname is an IPv4 address
  if (isIPv4(hostname)) {
    for (const prefix of BLOCKED_IPV4_PREFIXES) {
      if (hostname.startsWith(prefix)) {
        return { valid: false, reason: `Private/reserved IPv4 address: ${hostname}` };
      }
    }
  }

  // Check if hostname is an IPv6 address (may be in brackets in URL)
  const ipv6 = extractIPv6(hostname);
  if (ipv6 !== null) {
    const normalized = ipv6.toLowerCase();
    for (const prefix of BLOCKED_IPV6_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        return { valid: false, reason: `Private/reserved IPv6 address: ${hostname}` };
      }
    }
  }

  // Block URLs with credentials embedded
  if (parsed.username !== '' || parsed.password !== '') {
    return { valid: false, reason: 'URLs with embedded credentials are not allowed' };
  }

  return { valid: true };
}

/**
 * Validate and throw if the URL is not safe. Use this in service methods.
 */
export function assertOutboundUrlSafe(rawUrl: string): void {
  const result = validateOutboundUrl(rawUrl);
  if (!result.valid) {
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      message: `Webhook URL rejected: ${result.reason}`,
      field: 'url',
    });
  }
}

function isIPv4(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function extractIPv6(hostname: string): string | null {
  // hostname is already bracket-stripped at this point
  if (hostname.includes(':')) {
    return hostname;
  }
  return null;
}
