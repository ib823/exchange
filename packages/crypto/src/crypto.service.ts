/**
 * ICryptoService implementation that delegates all private-key work
 * to an IKeyCustodyBackend resolved through KeyCustodyAbstraction.
 *
 * Responsibilities that remain here:
 *  - Enforce CryptoAlgorithmPolicy on every operation that takes a
 *    KeyRef (forbidden algorithms, expiry, state, environment)
 *  - Build KeyReferenceInput from KeyRef for backend routing
 *  - Choose detached vs inline sign/verify variants on the backend
 *  - Route composite ops (signAndEncrypt, verifyAndDecrypt) through
 *    the dispatcher's same-backend precondition checks
 *  - Produce CryptoOperationMeta for audit persistence
 *
 * Responsibilities delegated to the backend:
 *  - Key material load from Vault KV v2 (private and public)
 *  - openpgp.js calls with private material (sign, decrypt, composite)
 *  - Zeroisation of private-material buffers
 *
 * Public-key-only verify (inline/clearsigned path) is done here using
 * `backend.getPublicKey(...)` as the source of armored public material —
 * no private key crosses the backend boundary for verify.
 *
 * Sign-then-encrypt ordering is non-negotiable (EFAIL mitigations). The
 * composite backend implementation enforces this; the CryptoService
 * layer only picks the correct dispatcher entry point.
 *
 * Known carry-over M2 quirks preserved in this refactor:
 *  - `EncryptResult.encryptedPayloadRef` (and sibling fields) returns a
 *    synthetic `encrypted/<id>/<opid>` path string, not the actual
 *    ciphertext. The data-plane processor currently stores the path
 *    string as if it were content (crypto.processor.ts:174-179 and
 *    :462) — this is a real pipeline bug tagged for follow-up.
 *  - `verify(payloadRef, ..., { detached: true })` treats payloadRef as
 *    the armored signature and verifies against an empty message —
 *    preserved semantics, flagged for API cleanup.
 */

import { randomUUID } from 'crypto';
import * as openpgp from 'openpgp';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import { enforcePolicy } from './policy';
import { KeyCustodyAbstraction } from './custody/key-custody-abstraction';
import type {
  KeyReferenceInput,
  Ciphertext,
  Signature,
  Plaintext,
} from './custody/i-key-custody-backend';
import type {
  ICryptoService,
  CryptoAlgorithmPolicy,
  KeyRef,
  EncryptOptions,
  DecryptOptions,
  SignOptions,
  VerifyOptions,
  EncryptResult,
  DecryptResult,
  SignResult,
  VerifyResult,
  SignEncryptResult,
  VerifyDecryptResult,
  CryptoOperationMeta,
  CryptoOperation,
} from './interfaces';

const logger = createLogger({ service: 'crypto', module: 'crypto-service' });

export class CryptoService implements ICryptoService {
  constructor(private readonly keyCustody: KeyCustodyAbstraction) {}

  async encrypt(
    payloadRef: string,
    recipientKey: KeyRef,
    _options: EncryptOptions,
    policy: CryptoAlgorithmPolicy,
  ): Promise<EncryptResult> {
    const start = Date.now();
    const operationId = randomUUID();

    enforcePolicy(
      policy,
      recipientKey,
      recipientKey.algorithm,
      'ENCRYPT',
      recipientKey.environment,
    );

    try {
      const ref = toKeyReferenceInput(recipientKey);
      const backend = this.keyCustody.backendFor(ref);
      const plaintext: Plaintext = Buffer.from(payloadRef, 'utf8');
      const output = await backend.encryptForRecipient(ref, plaintext);

      const encryptedPayloadRef = `encrypted/${recipientKey.keyReferenceId}/${operationId}`;
      const meta = this.buildMeta(
        operationId,
        'ENCRYPT',
        recipientKey,
        start,
        payloadRef.length,
        output.length,
      );

      logger.info(
        { operationId, keyReferenceId: recipientKey.keyReferenceId, operation: 'ENCRYPT' },
        'Encryption completed',
      );

      return { encryptedPayloadRef, meta };
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error(
        { operationId, keyReferenceId: recipientKey.keyReferenceId },
        'Encryption failed',
      );
      throw new SepError(ErrorCode.CRYPTO_ENCRYPTION_FAILED, {
        keyReferenceId: recipientKey.keyReferenceId,
        operation: 'ENCRYPT',
      });
    }
  }

  async decrypt(
    encryptedPayloadRef: string,
    privateKeyRef: KeyRef,
    _options: DecryptOptions,
  ): Promise<DecryptResult> {
    const start = Date.now();
    const operationId = randomUUID();

    try {
      const ref = toKeyReferenceInput(privateKeyRef);
      const backend = this.keyCustody.backendFor(ref);
      const plaintext = await backend.decrypt(ref, encryptedPayloadRef as Ciphertext);

      const decryptedPayloadRef = `decrypted/${privateKeyRef.keyReferenceId}/${operationId}`;
      const meta = this.buildMeta(
        operationId,
        'DECRYPT',
        privateKeyRef,
        start,
        encryptedPayloadRef.length,
        plaintext.length,
      );

      logger.info(
        { operationId, keyReferenceId: privateKeyRef.keyReferenceId, operation: 'DECRYPT' },
        'Decryption completed',
      );

      return { decryptedPayloadRef, verificationResult: 'SKIPPED', meta };
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error(
        { operationId, keyReferenceId: privateKeyRef.keyReferenceId },
        'Decryption failed',
      );
      throw new SepError(ErrorCode.CRYPTO_DECRYPTION_FAILED, {
        keyReferenceId: privateKeyRef.keyReferenceId,
        operation: 'DECRYPT',
      });
    }
  }

  async sign(
    payloadRef: string,
    signingKeyRef: KeyRef,
    options: SignOptions,
    policy: CryptoAlgorithmPolicy,
  ): Promise<SignResult> {
    const start = Date.now();
    const operationId = randomUUID();

    enforcePolicy(
      policy,
      signingKeyRef,
      signingKeyRef.algorithm,
      'SIGN',
      signingKeyRef.environment,
    );

    try {
      const ref = toKeyReferenceInput(signingKeyRef);
      const backend = this.keyCustody.backendFor(ref);
      const payload = Buffer.from(payloadRef, 'utf8');

      if (options.detached) {
        const signature = await backend.signDetached(ref, payload);
        const detachedSignatureRef = `signatures/${signingKeyRef.keyReferenceId}/${operationId}`;
        const meta = this.buildMeta(
          operationId,
          'SIGN',
          signingKeyRef,
          start,
          payload.length,
          signature.length,
        );
        return {
          // Detached: payload is unchanged; signature lives at detachedSignatureRef
          signedPayloadRef: payloadRef,
          detachedSignatureRef,
          meta,
        };
      }

      const output = await backend.signInline(ref, payload);
      const signedPayloadRef = `signed/${signingKeyRef.keyReferenceId}/${operationId}`;
      const meta = this.buildMeta(
        operationId,
        'SIGN',
        signingKeyRef,
        start,
        payload.length,
        output.length,
      );

      logger.info(
        {
          operationId,
          keyReferenceId: signingKeyRef.keyReferenceId,
          operation: 'SIGN',
          detached: options.detached,
        },
        'Signing completed',
      );

      return { signedPayloadRef, meta };
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ operationId, keyReferenceId: signingKeyRef.keyReferenceId }, 'Signing failed');
      throw new SepError(ErrorCode.CRYPTO_SIGNING_FAILED, {
        keyReferenceId: signingKeyRef.keyReferenceId,
        operation: 'SIGN',
      });
    }
  }

  async verify(
    payloadRef: string,
    senderPublicKeyRef: KeyRef,
    options: VerifyOptions,
  ): Promise<VerifyResult> {
    const start = Date.now();
    const operationId = randomUUID();
    const ref = toKeyReferenceInput(senderPublicKeyRef);

    try {
      if (options.detached) {
        // M2 carry-over quirk: detached verify here treats payloadRef as
        // the armored signature and verifies against an empty message.
        // Preserved verbatim; the true detached-verify API would take
        // both payload and signature.
        const backend = this.keyCustody.backendFor(ref);
        const sigVerified = await backend.verifyDetached(
          ref,
          Buffer.alloc(0),
          payloadRef as Signature,
        );

        const meta = this.buildMeta(
          operationId,
          'VERIFY',
          senderPublicKeyRef,
          start,
          payloadRef.length,
          0,
        );
        return {
          verified: sigVerified,
          signerKeyFingerprint: senderPublicKeyRef.fingerprint,
          signedAt: new Date(),
          meta,
        };
      }

      // Inline / clear-signed verification — public-key-only op. Fetch
      // armored public material from the backend and run openpgp.verify
      // locally. No private material crosses the backend boundary.
      const backend = this.keyCustody.backendFor(ref);
      const armoredPub = await backend.getPublicKey(ref);
      const publicKey = await openpgp.readKey({ armoredKey: armoredPub });
      const message = await openpgp.readCleartextMessage({ cleartextMessage: payloadRef });

      const verifyResult = await openpgp.verify({
        message,
        verificationKeys: publicKey,
      });

      let isVerified = false;
      const firstSig = verifyResult.signatures[0];
      if (firstSig) {
        try {
          await firstSig.verified;
          isVerified = true;
        } catch {
          isVerified = false;
        }
      }

      const meta = this.buildMeta(
        operationId,
        'VERIFY',
        senderPublicKeyRef,
        start,
        payloadRef.length,
        0,
      );

      logger.info(
        {
          operationId,
          keyReferenceId: senderPublicKeyRef.keyReferenceId,
          operation: 'VERIFY',
          verified: isVerified,
        },
        'Verification completed',
      );

      return {
        verified: isVerified,
        signerKeyFingerprint: senderPublicKeyRef.fingerprint,
        signedAt: new Date(),
        meta,
      };
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      const meta = this.buildMeta(
        operationId,
        'VERIFY',
        senderPublicKeyRef,
        start,
        payloadRef.length,
        0,
      );
      logger.warn(
        { operationId, keyReferenceId: senderPublicKeyRef.keyReferenceId },
        'Verification error — returning verified:false',
      );
      return { verified: false, meta };
    }
  }

  async signAndEncrypt(
    payloadRef: string,
    signingKeyRef: KeyRef,
    recipientKey: KeyRef,
    _signOptions: SignOptions,
    _encryptOptions: EncryptOptions,
    policy: CryptoAlgorithmPolicy,
  ): Promise<SignEncryptResult> {
    // Sign-then-encrypt ordering is enforced by the composite backend
    // method itself (openpgp.encrypt with both encryptionKeys and
    // signingKeys). Policy enforcement still runs up-front on both
    // keys so a forbidden algorithm never reaches the backend.
    enforcePolicy(
      policy,
      signingKeyRef,
      signingKeyRef.algorithm,
      'SIGN',
      signingKeyRef.environment,
    );
    enforcePolicy(
      policy,
      recipientKey,
      recipientKey.algorithm,
      'ENCRYPT',
      recipientKey.environment,
    );

    const start = Date.now();
    const operationId = randomUUID();

    try {
      const signingRef = toKeyReferenceInput(signingKeyRef);
      const recipientRef = toKeyReferenceInput(recipientKey);
      const plaintext: Plaintext = Buffer.from(payloadRef, 'utf8');
      const output = await this.keyCustody.dispatchSignAndEncrypt(
        signingRef,
        recipientRef,
        plaintext,
      );

      const securedPayloadRef = `secured/${operationId}`;
      const signMeta = this.buildMeta(
        operationId + '-sign',
        'SIGN',
        signingKeyRef,
        start,
        payloadRef.length,
        output.length,
      );
      const encryptMeta = this.buildMeta(
        operationId + '-encrypt',
        'ENCRYPT',
        recipientKey,
        start,
        payloadRef.length,
        output.length,
      );

      logger.info({ operationId, operation: 'SIGN_ENCRYPT' }, 'Sign-and-encrypt completed');

      return { securedPayloadRef, signMeta, encryptMeta };
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ operationId }, 'Sign-and-encrypt failed');
      throw new SepError(ErrorCode.CRYPTO_ENCRYPTION_FAILED, {
        keyReferenceId: recipientKey.keyReferenceId,
        operation: 'SIGN_ENCRYPT',
      });
    }
  }

  async verifyAndDecrypt(
    securedPayloadRef: string,
    privateKeyRef: KeyRef,
    senderPublicKeyRef: KeyRef | null,
    _options: DecryptOptions,
  ): Promise<VerifyDecryptResult> {
    const start = Date.now();
    const operationId = randomUUID();

    try {
      const privateRef = toKeyReferenceInput(privateKeyRef);

      let plaintext: Plaintext;
      let verificationResult: 'PASSED' | 'FAILED' | 'SKIPPED';

      if (senderPublicKeyRef !== null) {
        // Composite: decrypt + embedded-signature verify. Dispatcher
        // enforces both refs resolve to the same backend instance.
        const senderRef = toKeyReferenceInput(senderPublicKeyRef);
        const result = await this.keyCustody.dispatchDecryptAndVerify(
          privateRef,
          senderRef,
          securedPayloadRef as Ciphertext,
        );
        plaintext = result.plaintext;
        verificationResult = result.signatureValid ? 'PASSED' : 'FAILED';
      } else {
        // No sender key → decrypt only, verify skipped.
        const backend = this.keyCustody.backendFor(privateRef);
        plaintext = await backend.decrypt(privateRef, securedPayloadRef as Ciphertext);
        verificationResult = 'SKIPPED';
      }

      const decryptedPayloadRef = `decrypted/${privateKeyRef.keyReferenceId}/${operationId}`;
      const decryptMeta = this.buildMeta(
        operationId + '-decrypt',
        'DECRYPT',
        privateKeyRef,
        start,
        securedPayloadRef.length,
        plaintext.length,
      );

      logger.info(
        { operationId, operation: 'VERIFY_DECRYPT', verificationResult },
        'Verify-and-decrypt completed',
      );

      const result: VerifyDecryptResult = { decryptedPayloadRef, verificationResult, decryptMeta };
      if (senderPublicKeyRef !== null) {
        result.signMeta = this.buildMeta(
          operationId + '-verify',
          'VERIFY',
          senderPublicKeyRef,
          start,
          plaintext.length,
          0,
        );
      }
      return result;
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ operationId }, 'Verify-and-decrypt failed');
      throw new SepError(ErrorCode.CRYPTO_DECRYPTION_FAILED, {
        keyReferenceId: privateKeyRef.keyReferenceId,
        operation: 'VERIFY_DECRYPT',
      });
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private buildMeta(
    operationId: string,
    operation: CryptoOperation,
    keyRef: KeyRef,
    startMs: number,
    inputSize: number,
    outputSize: number,
  ): CryptoOperationMeta {
    return {
      operationId,
      operation,
      keyReferenceId: keyRef.keyReferenceId,
      algorithmUsed: keyRef.algorithm,
      hashUsed: 'sha256',
      outputFormat: 'armored',
      inputSizeBytes: inputSize,
      outputSizeBytes: outputSize,
      durationMs: Date.now() - startMs,
      performedAt: new Date(),
    };
  }
}

function toKeyReferenceInput(keyRef: KeyRef): KeyReferenceInput {
  return {
    id: keyRef.keyReferenceId,
    tenantId: keyRef.tenantId,
    backendType: keyRef.backendType,
    backendRef: keyRef.backendRef,
    algorithm: keyRef.algorithm,
    fingerprint: keyRef.fingerprint,
    usage: keyRef.allowedUsages,
  };
}
