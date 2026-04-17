/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorCode } from '@sep/common';
import { InMemoryObjectStorageService } from './object-storage.service';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('InMemoryObjectStorageService', () => {
  let storage: InMemoryObjectStorageService;

  beforeEach(() => {
    storage = new InMemoryObjectStorageService();
  });

  it('stores and retrieves an object', async () => {
    const data = Buffer.from('test payload content');
    await storage.putObject('bucket', 'key/file.txt', data);
    const result = await storage.getObject('bucket', 'key/file.txt');
    expect(result.equals(data)).toBe(true);
  });

  it('throws STORAGE_OBJECT_NOT_FOUND for missing objects', async () => {
    await expect(storage.getObject('bucket', 'nonexistent')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.STORAGE_OBJECT_NOT_FOUND }),
    );
  });

  it('returns first N bytes via getObjectHead', async () => {
    const data = Buffer.from('ABCDEFGHIJKLMNOP');
    await storage.putObject('bucket', 'file.bin', data);
    const head = await storage.getObjectHead('bucket', 'file.bin', 4);
    expect(head.toString()).toBe('ABCD');
  });

  it('getObjectHead throws for missing objects', async () => {
    await expect(storage.getObjectHead('bucket', 'nope', 4)).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.STORAGE_OBJECT_NOT_FOUND }),
    );
  });

  it('overwrites existing objects', async () => {
    await storage.putObject('b', 'k', Buffer.from('v1'));
    await storage.putObject('b', 'k', Buffer.from('v2'));
    const result = await storage.getObject('b', 'k');
    expect(result.toString()).toBe('v2');
  });

  it('clear removes all objects', async () => {
    await storage.putObject('b', 'k1', Buffer.from('data'));
    await storage.putObject('b', 'k2', Buffer.from('data'));
    storage.clear();
    expect(storage.has('b', 'k1')).toBe(false);
    expect(storage.has('b', 'k2')).toBe(false);
  });
});
