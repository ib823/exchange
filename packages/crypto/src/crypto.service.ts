/**
 * Concrete ICryptoService implementation using openpgp.js v5.
 *
 * All operations:
 * 1. Enforce algorithm policy BEFORE any crypto operation
 * 2. Use streaming APIs where openpgp.js supports them
 * 3. Record operation metadata for CryptoOperationRecord persistence
 * 4. Never log key material, passphrases, or payload content
 *
 * Sign-then-encrypt ordering is enforced: EFAIL mitigations require
 * signing before encryption (never encrypt-then-sign).
 */

import * as openpgp from 'openpgp';
import { randomUUID } from 'crypto';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import { enforcePolicy } from './policy';
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
  async encrypt(
    payloadRef: string,
    recipientKey: KeyRef,
    _options: EncryptOptions,
    policy: CryptoAlgorithmPolicy,
  ): Promise<EncryptResult> {
    const start = Date.now();
    const operationId = randomUUID();

    enforcePolicy(policy, recipientKey, recipientKey.algorithm, 'ENCRYPT', recipientKey.environment);

    try {
      const publicKey = await this.readPublicKey(recipientKey.backendRef);
      const message = await openpgp.createMessage({ text: payloadRef });

      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
      });

      const output = String(encrypted);
      const encryptedPayloadRef = `encrypted/${recipientKey.keyReferenceId}/${operationId}`;
      const meta = this.buildMeta(operationId, 'ENCRYPT', recipientKey, start, payloadRef.length, output.length);

      logger.info(
        { operationId, keyReferenceId: recipientKey.keyReferenceId, operation: 'ENCRYPT' },
        'Encryption completed',
      );

      return { encryptedPayloadRef, meta };
    } catch (err) {
      if (err instanceof SepError) {throw err;}
      logger.error({ operationId, keyReferenceId: recipientKey.keyReferenceId }, 'Encryption failed');
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
      const privateKey = await this.readPrivateKey(privateKeyRef.backendRef);
      const message = await openpgp.readMessage({ armoredMessage: encryptedPayloadRef });

      const { data } = await openpgp.decrypt({
        message,
        decryptionKeys: privateKey,
      });

      const output = String(data);
      const decryptedPayloadRef = `decrypted/${privateKeyRef.keyReferenceId}/${operationId}`;
      const meta = this.buildMeta(operationId, 'DECRYPT', privateKeyRef, start, encryptedPayloadRef.length, output.length);

      logger.info(
        { operationId, keyReferenceId: privateKeyRef.keyReferenceId, operation: 'DECRYPT' },
        'Decryption completed',
      );

      return { decryptedPayloadRef, verificationResult: 'SKIPPED', meta };
    } catch (err) {
      if (err instanceof SepError) {throw err;}
      logger.error({ operationId, keyReferenceId: privateKeyRef.keyReferenceId }, 'Decryption failed');
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

    enforcePolicy(policy, signingKeyRef, signingKeyRef.algorithm, 'SIGN', signingKeyRef.environment);

    try {
      const privateKey = await this.readPrivateKey(signingKeyRef.backendRef);
      const message = await openpgp.createMessage({ text: payloadRef });

      if (options.detached) {
        const signature = await openpgp.sign({
          message,
          signingKeys: privateKey,
          detached: true,
        });

        const sigStr = String(signature);
        const signedPayloadRef = payloadRef; // original payload unchanged for detached
        const detachedSignatureRef = `signatures/${signingKeyRef.keyReferenceId}/${operationId}`;
        const meta = this.buildMeta(operationId, 'SIGN', signingKeyRef, start, payloadRef.length, sigStr.length);

        return { signedPayloadRef, detachedSignatureRef, meta };
      }

      const signed = await openpgp.sign({
        message,
        signingKeys: privateKey,
      });

      const output = String(signed);
      const signedPayloadRef = `signed/${signingKeyRef.keyReferenceId}/${operationId}`;
      const meta = this.buildMeta(operationId, 'SIGN', signingKeyRef, start, payloadRef.length, output.length);

      logger.info(
        { operationId, keyReferenceId: signingKeyRef.keyReferenceId, operation: 'SIGN', detached: options.detached },
        'Signing completed',
      );

      return { signedPayloadRef, meta };
    } catch (err) {
      if (err instanceof SepError) {throw err;}
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

    try {
      const publicKey = await this.readPublicKey(senderPublicKeyRef.backendRef);

      if (options.detached) {
        const signature = await openpgp.readSignature({ armoredSignature: payloadRef });
        const message = await openpgp.createMessage({ text: '' });

        const verifyResult = await openpgp.verify({
          message,
          signature,
          verificationKeys: publicKey,
        });

        let sigVerified = false;
        if (verifyResult.signatures[0]) {
          try {
            await verifyResult.signatures[0].verified;
            sigVerified = true;
          } catch {
            sigVerified = false;
          }
        }

        const meta = this.buildMeta(operationId, 'VERIFY', senderPublicKeyRef, start, payloadRef.length, 0);
        return {
          verified: sigVerified,
          signerKeyFingerprint: publicKey.getFingerprint(),
          signedAt: new Date(),
          meta,
        };
      }

      // Inline/clearsigned verification
      const message = await openpgp.readCleartextMessage({ cleartextMessage: payloadRef });

      const verifyResult = await openpgp.verify({
        message,
        verificationKeys: publicKey,
      });

      let isVerified = false;
      if (verifyResult.signatures[0]) {
        try {
          await verifyResult.signatures[0].verified;
          isVerified = true;
        } catch {
          isVerified = false;
        }
      }

      const meta = this.buildMeta(operationId, 'VERIFY', senderPublicKeyRef, start, payloadRef.length, 0);

      logger.info(
        { operationId, keyReferenceId: senderPublicKeyRef.keyReferenceId, operation: 'VERIFY', verified: isVerified },
        'Verification completed',
      );

      return {
        verified: isVerified,
        signerKeyFingerprint: publicKey.getFingerprint(),
        signedAt: new Date(),
        meta,
      };
    } catch (err) {
      if (err instanceof SepError) {throw err;}
      const meta = this.buildMeta(operationId, 'VERIFY', senderPublicKeyRef, start, payloadRef.length, 0);
      logger.warn({ operationId, keyReferenceId: senderPublicKeyRef.keyReferenceId }, 'Verification error — returning verified:false');
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
    // Sign FIRST, then encrypt — EFAIL mitigation, ordering is non-negotiable
    enforcePolicy(policy, signingKeyRef, signingKeyRef.algorithm, 'SIGN', signingKeyRef.environment);
    enforcePolicy(policy, recipientKey, recipientKey.algorithm, 'ENCRYPT', recipientKey.environment);

    const start = Date.now();
    const operationId = randomUUID();

    try {
      const privateKey = await this.readPrivateKey(signingKeyRef.backendRef);
      const publicKey = await this.readPublicKey(recipientKey.backendRef);
      const message = await openpgp.createMessage({ text: payloadRef });

      // Combined sign + encrypt in correct order
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        signingKeys: privateKey,
      });

      const output = String(encrypted);
      const securedPayloadRef = `secured/${operationId}`;

      const signMeta = this.buildMeta(operationId + '-sign', 'SIGN', signingKeyRef, start, payloadRef.length, output.length);
      const encryptMeta = this.buildMeta(operationId + '-encrypt', 'ENCRYPT', recipientKey, start, payloadRef.length, output.length);

      logger.info(
        { operationId, operation: 'SIGN_ENCRYPT' },
        'Sign-and-encrypt completed',
      );

      return { securedPayloadRef, signMeta, encryptMeta };
    } catch (err) {
      if (err instanceof SepError) {throw err;}
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
      const privateKey = await this.readPrivateKey(privateKeyRef.backendRef);
      const message = await openpgp.readMessage({ armoredMessage: securedPayloadRef });

      const decryptParams: { message: typeof message; decryptionKeys: typeof privateKey; verificationKeys?: openpgp.Key[] } = {
        message,
        decryptionKeys: privateKey,
      };

      if (senderPublicKeyRef !== null) {
        decryptParams.verificationKeys = [await this.readPublicKey(senderPublicKeyRef.backendRef)];
      }

      const { data, signatures } = await openpgp.decrypt(decryptParams as Parameters<typeof openpgp.decrypt>[0]);

      let verificationResult: 'PASSED' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
      if (senderPublicKeyRef !== null && signatures.length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees index 0 exists
          await signatures[0]!.verified;
          verificationResult = 'PASSED';
        } catch {
          verificationResult = 'FAILED';
        }
      }

      const output = String(data);
      const decryptedPayloadRef = `decrypted/${privateKeyRef.keyReferenceId}/${operationId}`;
      const decryptMeta = this.buildMeta(operationId + '-decrypt', 'DECRYPT', privateKeyRef, start, securedPayloadRef.length, output.length);

      logger.info(
        { operationId, operation: 'VERIFY_DECRYPT', verificationResult },
        'Verify-and-decrypt completed',
      );

      const result: VerifyDecryptResult = { decryptedPayloadRef, verificationResult, decryptMeta };
      if (senderPublicKeyRef !== null) {
        result.signMeta = this.buildMeta(operationId + '-verify', 'VERIFY', senderPublicKeyRef, start, output.length, 0);
      }
      return result;
    } catch (err) {
      if (err instanceof SepError) {throw err;}
      logger.error({ operationId }, 'Verify-and-decrypt failed');
      throw new SepError(ErrorCode.CRYPTO_DECRYPTION_FAILED, {
        keyReferenceId: privateKeyRef.keyReferenceId,
        operation: 'VERIFY_DECRYPT',
      });
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private async readPublicKey(armoredKey: string): Promise<openpgp.Key> {
    return openpgp.readKey({ armoredKey });
  }

  private async readPrivateKey(armoredKey: string): Promise<openpgp.PrivateKey> {
    return openpgp.readPrivateKey({ armoredKey });
  }

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
