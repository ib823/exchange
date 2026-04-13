/**
 * Object storage abstraction for payload read/write.
 *
 * M2 provides an in-memory implementation for tests.
 * M3 wires in real S3/MinIO client via @aws-sdk/client-s3.
 *
 * Implementations MUST:
 * - Never log payload content
 * - Throw SepError(STORAGE_OBJECT_NOT_FOUND) if key does not exist
 * - Throw SepError(STORAGE_DOWNLOAD_FAILED) on transient read errors
 * - Throw SepError(STORAGE_UPLOAD_FAILED) on transient write errors
 */

import { SepError, ErrorCode } from '@sep/common';

export interface IObjectStorageService {
  /** Read an object from storage. Returns the raw bytes. */
  getObject(bucket: string, key: string): Promise<Buffer>;
  /** Write an object to storage. Overwrites if exists. */
  putObject(bucket: string, key: string, data: Buffer): Promise<void>;
  /** Read only the first N bytes of an object (for magic-byte inspection). */
  getObjectHead(bucket: string, key: string, bytes: number): Promise<Buffer>;
}

/**
 * In-memory implementation for M2 tests.
 * NOT for production — all data lost on restart.
 */
export class InMemoryObjectStorageService implements IObjectStorageService {
  private readonly store = new Map<string, Buffer>();

  private makeKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- in-memory, no async needed
  async getObject(bucket: string, key: string): Promise<Buffer> {
    const storeKey = this.makeKey(bucket, key);
    const data = this.store.get(storeKey);
    if (data === undefined) {
      throw new SepError(ErrorCode.STORAGE_OBJECT_NOT_FOUND, {
        message: `Object not found: ${bucket}/${key}`,
      });
    }
    return data;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- in-memory, no async needed
  async putObject(bucket: string, key: string, data: Buffer): Promise<void> {
    const storeKey = this.makeKey(bucket, key);
    this.store.set(storeKey, data);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- in-memory, no async needed
  async getObjectHead(bucket: string, key: string, bytes: number): Promise<Buffer> {
    const storeKey = this.makeKey(bucket, key);
    const data = this.store.get(storeKey);
    if (data === undefined) {
      throw new SepError(ErrorCode.STORAGE_OBJECT_NOT_FOUND, {
        message: `Object not found: ${bucket}/${key}`,
      });
    }
    return data.subarray(0, bytes);
  }

  /** Test helper: clear all stored objects */
  clear(): void {
    this.store.clear();
  }

  /** Test helper: check if an object exists */
  has(bucket: string, key: string): boolean {
    return this.store.has(this.makeKey(bucket, key));
  }
}
