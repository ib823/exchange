/**
 * Thin HashiCorp Vault HTTP client (M3.A5-T02).
 *
 * Per ADR-0004 we do not use `node-vault`. This client covers the
 * small Vault surface the platform needs:
 *
 *   - KV v2:   GET/POST under `<mount>/data/<path>` (material storage)
 *   - Transit: POST to `<mount>/sign/:name`, `<mount>/verify/:name`,
 *              `<mount>/encrypt/:name`, `<mount>/decrypt/:name`
 *              (reserved for non-PGP uses; see ADR-0007)
 *
 * Constructor-injected via a typed config object; every call is
 * typed, with 5xx retries (exponential backoff + jitter) and a hard
 * per-request timeout.
 *
 * SECURITY: Vault token is passed through the `X-Vault-Token`
 * header. The token itself is NEVER logged, serialised, or placed in
 * error context. 5xx responses are logged with status + request-id
 * only; 403 responses are logged as a security event without the
 * token.
 */

import { request } from 'undici';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';

const logger = createLogger({ service: 'crypto', module: 'vault-client' });

export interface VaultClientConfig {
  readonly addr: string;
  readonly token: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly initialBackoffMs: number;
  readonly namespace?: string | undefined;
}

export const DEFAULT_VAULT_CLIENT_CONFIG: Omit<VaultClientConfig, 'addr' | 'token'> = {
  requestTimeoutMs: 5_000,
  maxRetries: 3,
  initialBackoffMs: 100,
};

export interface VaultKvV2WriteResponse {
  readonly data: { readonly version: number; readonly created_time: string };
}

export interface VaultKvV2ReadResponse<T> {
  readonly data: { readonly data: T; readonly metadata: { readonly version: number } };
}

export interface VaultTransitSignResponse {
  readonly data: { readonly signature: string; readonly key_version: number };
}

export interface VaultTransitVerifyResponse {
  readonly data: { readonly valid: boolean };
}

export interface VaultTransitEncryptResponse {
  readonly data: { readonly ciphertext: string; readonly key_version: number };
}

export interface VaultTransitDecryptResponse {
  readonly data: { readonly plaintext: string };
}

type VaultMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export class VaultClient {
  constructor(private readonly config: VaultClientConfig) {
    if (typeof config.addr !== 'string' || !config.addr.startsWith('http')) {
      throw new SepError(ErrorCode.CONFIGURATION_ERROR, {
        reason: 'VAULT_ADDR must be a full http(s) URL',
      });
    }
    if (!config.token || config.token.length === 0) {
      throw new SepError(ErrorCode.CONFIGURATION_ERROR, {
        reason: 'VAULT_TOKEN must be a non-empty string',
      });
    }
  }

  // ── KV v2 ─────────────────────────────────────────────────────

  async kvWrite<T extends object>(
    mount: string,
    path: string,
    data: T,
  ): Promise<VaultKvV2WriteResponse> {
    const body = await this.send<VaultKvV2WriteResponse>('POST', `${mount}/data/${path}`, { data });
    return body;
  }

  async kvRead<T>(mount: string, path: string): Promise<T> {
    const body = await this.send<VaultKvV2ReadResponse<T>>('GET', `${mount}/data/${path}`);
    return body.data.data;
  }

  async kvDestroyAllVersions(mount: string, path: string): Promise<void> {
    await this.send<unknown>('DELETE', `${mount}/metadata/${path}`);
  }

  // ── Transit (reserved for non-PGP per ADR-0007) ───────────────

  async transitSign(
    mount: string,
    keyName: string,
    base64Payload: string,
  ): Promise<VaultTransitSignResponse> {
    return this.send<VaultTransitSignResponse>('POST', `${mount}/sign/${keyName}`, {
      input: base64Payload,
    });
  }

  async transitVerify(
    mount: string,
    keyName: string,
    base64Payload: string,
    signature: string,
  ): Promise<VaultTransitVerifyResponse> {
    return this.send<VaultTransitVerifyResponse>('POST', `${mount}/verify/${keyName}`, {
      input: base64Payload,
      signature,
    });
  }

  async transitEncrypt(
    mount: string,
    keyName: string,
    base64Plaintext: string,
  ): Promise<VaultTransitEncryptResponse> {
    return this.send<VaultTransitEncryptResponse>('POST', `${mount}/encrypt/${keyName}`, {
      plaintext: base64Plaintext,
    });
  }

  async transitDecrypt(
    mount: string,
    keyName: string,
    ciphertext: string,
  ): Promise<VaultTransitDecryptResponse> {
    return this.send<VaultTransitDecryptResponse>('POST', `${mount}/decrypt/${keyName}`, {
      ciphertext,
    });
  }

  async transitRotate(mount: string, keyName: string): Promise<void> {
    await this.send<unknown>('POST', `${mount}/keys/${keyName}/rotate`, {});
  }

  // ── Core request ──────────────────────────────────────────────

  private async send<T>(method: VaultMethod, pathRaw: string, body?: unknown): Promise<T> {
    const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
    const url = `${this.config.addr.replace(/\/+$/, '')}/v1${path}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'X-Vault-Token': this.config.token,
          'content-type': 'application/json',
        };
        if (this.config.namespace !== undefined && this.config.namespace.length > 0) {
          headers['X-Vault-Namespace'] = this.config.namespace;
        }

        const requestOptions: Parameters<typeof request>[1] = {
          method,
          headers,
          bodyTimeout: this.config.requestTimeoutMs,
          headersTimeout: this.config.requestTimeoutMs,
        };
        if (body !== undefined) {
          requestOptions.body = JSON.stringify(body);
        }

        const res = await request(url, requestOptions);

        if (res.statusCode >= 500) {
          lastError = new Error(`Vault 5xx status=${res.statusCode}`);
          // Drain body so the socket is reusable.
          await res.body.text();
          await this.sleepWithJitter(attempt);
          continue;
        }

        if (res.statusCode === 403 || res.statusCode === 401) {
          const detail = await res.body.text();
          logger.warn(
            { status: res.statusCode, path, requestId: res.headers['x-vault-request-id'] },
            'Vault authentication failed',
          );
          throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
            reason: `Vault auth failed status=${res.statusCode}`,
            // deliberately no token / no body content
            ...(typeof detail === 'string' && detail.length < 256 ? {} : {}),
          });
        }

        if (res.statusCode === 404) {
          throw new SepError(ErrorCode.CRYPTO_KEY_NOT_FOUND, {
            reason: `Vault 404 on ${path}`,
          });
        }

        if (res.statusCode >= 400) {
          const detail = await res.body.text();
          logger.warn(
            { status: res.statusCode, path, requestId: res.headers['x-vault-request-id'] },
            'Vault client error',
          );
          throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
            reason: `Vault ${res.statusCode}: ${detail.substring(0, 128)}`,
          });
        }

        if (res.statusCode === 204) {
          return undefined as T;
        }

        const text = await res.body.text();
        return text.length === 0 ? (undefined as T) : (JSON.parse(text) as T);
      } catch (err) {
        if (err instanceof SepError) {
          throw err;
        }
        lastError = err;
        if (attempt < this.config.maxRetries) {
          await this.sleepWithJitter(attempt);
          continue;
        }
      }
    }

    logger.error({ path, method }, 'Vault request failed after retries');
    throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
      reason: `Vault unreachable after ${this.config.maxRetries + 1} attempts`,
      operation: method,
      ...(lastError instanceof Error ? { message: lastError.message.substring(0, 128) } : {}),
    });
  }

  private async sleepWithJitter(attempt: number): Promise<void> {
    const base = this.config.initialBackoffMs * 2 ** attempt;
    const jitter = Math.floor(Math.random() * base);
    await new Promise((resolve) => setTimeout(resolve, base + jitter));
  }

  /** No-op; retained for API stability so callers can `await client.close()`. */
  async close(): Promise<void> {
    // undici's global dispatcher is shared; no per-client resources to release.
  }
}
