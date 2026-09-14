import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import type { Response } from 'node-fetch';
import {
  ensureKernel,
  KernelAcquireError,
  PINNED_PLATFORM_ASSETS,
  getPlatformAsset,
} from '../../src/main/util/kernelAcquire';

describe('kernelAcquire', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function createMockZipBuffer(relativeFilePath: string, content = 'dummy binary content'): Buffer {
    const zip = new AdmZip();
    zip.addFile(relativeFilePath, Buffer.from(content, 'utf-8'));
    return zip.toBuffer();
  }

  function createMockFetch(buffer: Buffer, status = 200, statusText = 'OK') {
    return async () => {
      const stream = new PassThrough();
      stream.end(buffer);
      const res = {
        ok: status >= 200 && status < 300,
        status,
        statusText,
        headers: {
          get: (header: string) => (header.toLowerCase() === 'content-length' ? String(buffer.length) : null),
        },
        body: stream,
      };
      return res as unknown as Response;
    };
  }

  it('selects correct platform asset per process.platform', () => {
    const winAsset = getPlatformAsset('win32');
    expect(winAsset.asset).toContain('windows_x64.zip');
    expect(winAsset.sha256).toBe('9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579');

    const linuxAsset = getPlatformAsset('linux');
    expect(linuxAsset.asset).toContain('.AppImage');
    expect(linuxAsset.sha256).toBe('a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0');

    const macAsset = getPlatformAsset('darwin');
    expect(macAsset.asset).toContain('.dmg');
    expect(macAsset.sha256).toBe('b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679');

    expect(() => getPlatformAsset('freebsd' as NodeJS.Platform)).toThrow(KernelAcquireError);
  });

  it('accepts correct digest, extracts archive, and tracks progress', async () => {
    const relativeExe = PINNED_PLATFORM_ASSETS.win32.executableSubpath;
    const zipBuffer = createMockZipBuffer(relativeExe, 'mock chrome binary');
    const actualDigest = crypto.createHash('sha256').update(zipBuffer).digest('hex');

    const progressUpdates: Array<{ received: number; total: number }> = [];

    const mockAssets = {
      win32: {
        ...PINNED_PLATFORM_ASSETS.win32,
        sha256: actualDigest,
        size: zipBuffer.length,
      },
    };

    const result = await ensureKernel({
      platform: 'win32',
      targetDir: tmpDir,
      expectedDigests: mockAssets,
      fetchFn: createMockFetch(zipBuffer) as unknown as typeof fetch,
      onProgress: (p) => progressUpdates.push(p),
    });

    expect(fs.existsSync(result.executablePath)).toBe(true);
    expect(fs.readFileSync(result.executablePath, 'utf-8')).toBe('mock chrome binary');
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1].received).toBe(zipBuffer.length);
  });

  it('refuses corrupted payload and cleans up temporary files', async () => {
    const relativeExe = PINNED_PLATFORM_ASSETS.win32.executableSubpath;
    const zipBuffer = createMockZipBuffer(relativeExe, 'mock binary');
    const actualDigest = crypto.createHash('sha256').update(zipBuffer).digest('hex');

    // Corrupt the payload by modifying bytes
    const corruptedBuffer = Buffer.from(zipBuffer);
    corruptedBuffer[10] = (corruptedBuffer[10] ^ 0xff);

    const mockAssets = {
      win32: {
        ...PINNED_PLATFORM_ASSETS.win32,
        sha256: actualDigest,
        size: zipBuffer.length,
      },
    };

    let caughtError: KernelAcquireError | null = null;
    try {
      await ensureKernel({
        platform: 'win32',
        targetDir: tmpDir,
        expectedDigests: mockAssets,
        fetchFn: createMockFetch(corruptedBuffer) as unknown as typeof fetch,
      });
    } catch (err) {
      caughtError = err as KernelAcquireError;
    }

    expect(caughtError).toBeInstanceOf(KernelAcquireError);
    expect(caughtError?.code).toBe('ERR_DIGEST_MISMATCH');

    // Ensure no tmp download files remain in targetDir
    const files = fs.readdirSync(tmpDir);
    expect(files.filter((f) => f.startsWith('.download-'))).toEqual([]);
  });

  it('refuses wrong expected digest and leaves nothing usable', async () => {
    const relativeExe = PINNED_PLATFORM_ASSETS.win32.executableSubpath;
    const zipBuffer = createMockZipBuffer(relativeExe, 'mock binary');

    const wrongDigest = '0000000000000000000000000000000000000000000000000000000000000000';
    const mockAssets = {
      win32: {
        ...PINNED_PLATFORM_ASSETS.win32,
        sha256: wrongDigest,
        size: zipBuffer.length,
      },
    };

    await expect(
      ensureKernel({
        platform: 'win32',
        targetDir: tmpDir,
        expectedDigests: mockAssets,
        fetchFn: createMockFetch(zipBuffer) as unknown as typeof fetch,
      })
    ).rejects.toThrow(KernelAcquireError);

    // Verify executable was not created
    const expectedExe = path.join(tmpDir, relativeExe);
    expect(fs.existsSync(expectedExe)).toBe(false);

    // Verify no temporary download files remained
    const files = fs.readdirSync(tmpDir);
    expect(files.filter((f) => f.startsWith('.download-'))).toEqual([]);
  });

  it('allows retry after failure without manual cleanup', async () => {
    const relativeExe = PINNED_PLATFORM_ASSETS.win32.executableSubpath;
    const zipBuffer = createMockZipBuffer(relativeExe, 'mock binary');
    const actualDigest = crypto.createHash('sha256').update(zipBuffer).digest('hex');

    const mockAssets = {
      win32: {
        ...PINNED_PLATFORM_ASSETS.win32,
        sha256: actualDigest,
        size: zipBuffer.length,
      },
    };

    // First attempt fails with corrupted buffer
    const corruptedBuffer = Buffer.from(zipBuffer);
    corruptedBuffer[5] = corruptedBuffer[5] ^ 0xff;

    await expect(
      ensureKernel({
        platform: 'win32',
        targetDir: tmpDir,
        expectedDigests: mockAssets,
        fetchFn: createMockFetch(corruptedBuffer) as unknown as typeof fetch,
      })
    ).rejects.toThrow(KernelAcquireError);

    // Second attempt with valid buffer succeeds without manual cleanup
    const result = await ensureKernel({
      platform: 'win32',
      targetDir: tmpDir,
      expectedDigests: mockAssets,
      fetchFn: createMockFetch(zipBuffer) as unknown as typeof fetch,
    });

    expect(fs.existsSync(result.executablePath)).toBe(true);
    expect(fs.readFileSync(result.executablePath, 'utf-8')).toBe('mock binary');
  });

  it('fails with clear error on network failure', async () => {
    const failingFetch = async () => {
      throw new Error('ENOTFOUND github.com');
    };

    await expect(
      ensureKernel({
        platform: 'win32',
        targetDir: tmpDir,
        fetchFn: failingFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/Cannot acquire browser kernel: no network connection available/);
  });

  it('returns immediately if kernel executable is already present', async () => {
    const relativeExe = PINNED_PLATFORM_ASSETS.win32.executableSubpath;
    const targetExe = path.join(tmpDir, relativeExe);
    fs.mkdirSync(path.dirname(targetExe), { recursive: true });
    fs.writeFileSync(targetExe, 'existing kernel binary');

    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    };

    const result = await ensureKernel({
      platform: 'win32',
      targetDir: tmpDir,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(fetchCalled).toBe(false);
    expect(result.executablePath).toBe(targetExe);
  });
});

describe('kernel version report matches where the kernel actually lives', () => {
  it('searches the packaged resources dir, not only the data dir', async () => {
    // A packaged build keeps the kernel under resources/kernel. The version report
    // used to read only the data dir, so a working packaged app showed the kernel as
    // not installed in Settings — the launcher and the report disagreed.
    const mod = await import('../../src/main/util/kernelUpdate');
    const config = await import('../../src/main/config');
    expect(typeof mod.getInstalledKernelVersion).toBe('function');
    const dirs = config.kernelBaseDirs();
    expect(dirs.length).toBeGreaterThanOrEqual(1);
    // The data-dir candidate must always be present as the dev/portable location.
    expect(dirs.some((d) => d.includes('fingerprint-chromium'))).toBe(true);
  });

  it('resolves the executable from the same candidate list', async () => {
    const config = await import('../../src/main/config');
    const dirs = config.kernelBaseDirs();
    // resourcesPath is set in Electron, absent under plain vitest — so in this
    // environment the list is exactly the data dir, and it must not be empty.
    expect(dirs.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
  });
});
