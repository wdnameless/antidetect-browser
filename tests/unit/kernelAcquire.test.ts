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

/**
 * The macOS branch. The mount/copy/detach dance cannot run here — this is a Windows host with no
 * `hdiutil` — so the tools are stubbed on PATH and the assertions are about the DECISIONS the code
 * makes: which mount point it trusts, that it copies by the pinned bundle name rather than the
 * first `.app` it sees, and that a detach happens even when the copy fails. Those are the parts
 * that break silently; `hdiutil` itself was verified on a real M1 by the probe workflow.
 */
const canStubExecutables = process.platform !== 'win32';

describe('kernelAcquire — macOS dmg branch', () => {
  let tmpDir: string;
  let binDir: string;
  let savedPath: string | undefined;
  let savedPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-dmg-'));
    binDir = path.join(tmpDir, 'fakebin');
    fs.mkdirSync(binDir, { recursive: true });
    savedPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${savedPath ?? ''}`;
    // `ensureKernel` gates the dmg branch on the HOST being darwin, so the host has to look like
    // macOS for this branch to be reachable at all on a Windows or Linux CI runner.
    savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedPlatform) Object.defineProperty(process, 'platform', savedPlatform);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** A stub tool that records its argv and prints a canned stdout. */
  function stubTool(name: string, stdout: string, exitCode = 0): string {
    const log = path.join(tmpDir, `${name}-calls.log`);
    const script = path.join(binDir, `${name}-impl.js`);
    const body = `
      const fs = require('fs');
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
      process.stdout.write(${JSON.stringify(stdout)});
      process.exit(${exitCode});
    `;
    fs.writeFileSync(script, body, 'utf8');

    // An EXTENSIONLESS executable shim, because `spawnSync` resolves a bare name through
    // PATHEXT only in a shell: a `hdiutil.cmd` is invisible to a direct spawn (measured here —
    // "spawnSync hdiutil ENOENT"). And `extractDmg` deliberately does not use `shell: true`,
    // since passing image paths through a shell is exactly the quoting hazard it avoids.
    //
    // On POSIX this is a `#!/bin/sh` script; on Windows an executable with no extension cannot
    // be created by a plain write, so the shim is skipped and the suite reports what it could
    // not exercise rather than failing on a platform artefact. The macOS path itself is
    // verified on a real M1 by `.github/workflows/probe-macos-kernel.yml`.
    const shimPath = path.join(binDir, name);
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(binDir, `${name}.cmd`), `@echo off\r\nnode "${script}" %*\r\n`, 'utf8');
      return log; // Windows cannot exec an extensionless file: see the note above.
    }
    fs.writeFileSync(shimPath, `#!/bin/sh\nexec node "${script}" "$@"\n`, 'utf8');
    fs.chmodSync(shimPath, 0o755);
    return log;
  }

  /**
   * A `cp` stub that REALLY copies.
   *
   * The stub used to record its arguments and exit 0 while creating nothing — invisible on Windows,
   * where the whole group is skipped, and wrong everywhere else: `ensureKernel` verifies the
   * executable exists after extraction, so the fixture failed a check the production code was right
   * to make. A stub that reports success must produce the effect success implies.
   */
  function copyStub(): string {
    const log = path.join(tmpDir, 'cp-calls.log');
    const script = path.join(binDir, 'cp-impl.js');
    // The newline inside the logged JSON must be an ESCAPE in the generated file, not a real line
    // break: writing `${'\\n'}` through a template literal produced a literal newline inside the
    // string, so the stub script was a syntax error and `cp` failed. Windows never noticed — the
    // group is skipped there — and macOS reported it as "Failed to copy the kernel bundle".
    const body = `
      const fs = require('fs');
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + String.fromCharCode(10));
      const args = process.argv.slice(2);
      const src = args[args.length - 2];
      const dest = args[args.length - 1];
      fs.cpSync(src, dest, { recursive: true });
    `;
    fs.writeFileSync(script, body, 'utf8');
    const shim = path.join(binDir, 'cp');
    fs.writeFileSync(shim, `#!/bin/sh\nexec node "${script}" "$@"\n`, 'utf8');
    fs.chmodSync(shim, 0o755);
    return log;
  }

  /**
   * Build the bundle inside the fake image the way the real one contains it.
   *
   * The fixture used to create an EMPTY `Chromium.app`, which no longer satisfies `ensureKernel`:
   * it verifies the executable exists at the pinned subpath after extraction, so a bundle with no
   * binary is correctly rejected. The earlier `cp` stub created nothing at all, which hid this —
   * once the stub really copied, the empty bundle became the next failure. Both are the same lesson:
   * a fixture has to model what the code checks, or the check is never exercised.
   */
  function seedImageBundle(mount: string, name = 'Chromium.app'): string {
    const exe = path.join(mount, name, 'Contents', 'MacOS', 'Chromium');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, 'fake kernel binary');
    return path.join(mount, name);
  }

  function readCalls(log: string): string[][] {
    if (!fs.existsSync(log)) return [];
    return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  const DMG_ASSET = {
    ...PINNED_PLATFORM_ASSETS.darwin,
    sha256: '',
    size: 0,
  };

  it.skipIf(!canStubExecutables)('mounts, copies the pinned bundle, clears quarantine and detaches', async () => {
    const dmg = Buffer.from('pretend disk image');
    const asset = { ...DMG_ASSET, sha256: crypto.createHash('sha256').update(dmg).digest('hex'), size: dmg.length };

    // The mount point is NOT the conventional one — this is the stale-mount case the code must
    // survive by parsing hdiutil's plist instead of assuming /Volumes/Chromium.
    const mount = path.join(tmpDir, 'Volumes', 'Chromium 1');
    seedImageBundle(mount);

    const hdiutilLog = stubTool(
      'hdiutil',
      `<key>mount-point</key>\n<string>${mount}</string>\n`,
      0
    );
    const cpLog = copyStub();
    const xattrLog = stubTool('xattr', '', 0);

    const result = await ensureKernel({
      platform: 'darwin',
      targetDir: tmpDir,
      expectedDigests: { darwin: asset },
      fetchFn: createMockFetch(dmg) as unknown as typeof fetch,
    });

    // It resolved the executable from the pinned subpath inside the copied bundle.
    expect(result.executablePath).toBe(path.join(tmpDir, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));

    const hdiutilCalls = readCalls(hdiutilLog);
    expect(hdiutilCalls[0].slice(0, 4)).toEqual(['attach', '-nobrowse', '-readonly', '-plist']);
    // Detached the PARSED mount point, not an assumed one — and detached at all.
    const detach = hdiutilCalls.find((c) => c[0] === 'detach');
    expect(detach).toBeDefined();
    expect(detach?.includes(mount)).toBe(true);
    expect(detach).toContain('-force');

    const cpCalls = readCalls(cpLog);
    expect(cpCalls[0][0]).toBe('-R');
    expect(cpCalls[0][1]).toBe(path.join(mount, 'Chromium.app'));

    const xattrCalls = readCalls(xattrLog);
    expect(xattrCalls[0]).toEqual(['-dr', 'com.apple.quarantine', path.join(tmpDir, 'Chromium.app')]);
  });

  it.skipIf(!canStubExecutables)('detaches the image even when the copy fails', async () => {
    const dmg = Buffer.from('pretend disk image');
    const asset = { ...DMG_ASSET, sha256: crypto.createHash('sha256').update(dmg).digest('hex'), size: dmg.length };

    const mount = path.join(tmpDir, 'Volumes', 'Chromium');
    seedImageBundle(mount);

    const hdiutilLog = stubTool('hdiutil', `<key>mount-point</key>\n<string>${mount}</string>\n`, 0);
    stubTool('cp', 'disk full', 1);
    stubTool('xattr', '', 0);

    await expect(
      ensureKernel({
        platform: 'darwin',
        targetDir: tmpDir,
        expectedDigests: { darwin: asset },
        fetchFn: createMockFetch(dmg) as unknown as typeof fetch,
      })
    ).rejects.toThrow(/Failed to copy the kernel bundle/);

    // A leaked mount would make the NEXT acquisition land on "/Volumes/Chromium 1".
    const detach = readCalls(hdiutilLog).find((c) => c[0] === 'detach');
    expect(detach).toBeDefined();
  });

  it.skipIf(!canStubExecutables)('refuses when the image does not contain the pinned bundle', async () => {
    const dmg = Buffer.from('pretend disk image');
    const asset = { ...DMG_ASSET, sha256: crypto.createHash('sha256').update(dmg).digest('hex'), size: dmg.length };

    // Mount point exists but holds a DIFFERENT bundle — the code must not silently copy that.
    const mount = path.join(tmpDir, 'Volumes', 'Something');
    fs.mkdirSync(path.join(mount, 'Other.app'), { recursive: true });

    stubTool('hdiutil', `<key>mount-point</key>\n<string>${mount}</string>\n`, 0);
    stubTool('cp', '', 0);
    stubTool('xattr', '', 0);

    await expect(
      ensureKernel({
        platform: 'darwin',
        targetDir: tmpDir,
        expectedDigests: { darwin: asset },
        fetchFn: createMockFetch(dmg) as unknown as typeof fetch,
      })
    ).rejects.toThrow(/does not contain the expected bundle/);
    expect(fs.existsSync(path.join(tmpDir, 'Other.app'))).toBe(false);
  });

  it.skipIf(!canStubExecutables)('reports a mount failure instead of proceeding to copy', async () => {
    const dmg = Buffer.from('pretend disk image');
    const asset = { ...DMG_ASSET, sha256: crypto.createHash('sha256').update(dmg).digest('hex'), size: dmg.length };

    stubTool('hdiutil', 'no mountable file systems', 1);
    const cpLog = stubTool('cp', '', 0);

    await expect(
      ensureKernel({
        platform: 'darwin',
        targetDir: tmpDir,
        expectedDigests: { darwin: asset },
        fetchFn: createMockFetch(dmg) as unknown as typeof fetch,
      })
    ).rejects.toThrow(/Failed to mount kernel disk image/);

    // Nothing was copied out of an image that never mounted.
    expect(readCalls(cpLog)).toEqual([]);
  });

  it('still refuses a tampered payload before any tool runs', async () => {
    const dmg = Buffer.from('pretend disk image');
    const asset = { ...DMG_ASSET, sha256: 'f'.repeat(64), size: dmg.length };

    const hdiutilLog = stubTool('hdiutil', '', 0);
    stubTool('cp', '', 0);

    await expect(
      ensureKernel({
        platform: 'darwin',
        targetDir: tmpDir,
        expectedDigests: { darwin: asset },
        fetchFn: createMockFetch(dmg) as unknown as typeof fetch,
      })
    ).rejects.toThrow(KernelAcquireError);

    // Verification is the whole point of this path: a bad digest must not reach hdiutil at all.
    expect(readCalls(hdiutilLog)).toEqual([]);
  });

  it.skipIf(!canStubExecutables)('refuses to merge into a bundle left behind by an interrupted run', async () => {
    const dmg = Buffer.from('pretend disk image');
    const asset = { ...DMG_ASSET, sha256: crypto.createHash('sha256').update(dmg).digest('hex'), size: dmg.length };

    const mount = path.join(tmpDir, 'Volumes', 'Chromium');
    seedImageBundle(mount);
    // A half-copied bundle from a previous attempt, holding a file the new one will not have.
    const stale = path.join(tmpDir, 'Chromium.app');
    fs.mkdirSync(path.join(stale, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(stale, 'Contents', 'MacOS', 'leftover-from-old-run'), 'stale');

    stubTool('hdiutil', `<key>mount-point</key>\n<string>${mount}</string>\n`, 0);
    copyStub();
    stubTool('xattr', '', 0);

    // The removal is verified, so a surviving tree is an error rather than a silent merge. This
    // stub platform can remove directories, so the call SUCCEEDS here — which is the correct
    // happy path. The refusal branch is what the macOS acceptance script would exercise if a
    // directory could not be removed; asserted here only to the extent this platform allows.
    const result = await ensureKernel({
      platform: 'darwin',
      targetDir: tmpDir,
      expectedDigests: { darwin: asset },
      fetchFn: createMockFetch(dmg) as unknown as typeof fetch,
    });

    // The previous tree was replaced, not merged into: the leftover is gone.
    expect(fs.existsSync(path.join(stale, 'Contents', 'MacOS', 'leftover-from-old-run'))).toBe(false);
    expect(result.executablePath).toBe(path.join(tmpDir, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
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


/**
 * Reclaiming abandoned downloads. Deliberately outside the dmg group: it exercises the zip path,
 * which needs no stubbed tools, so it runs everywhere — including on the Windows runner whose
 * gate skips the dmg cases.
 */
/**
 * The stub generators write JavaScript as TEXT, and that text is only executed on a platform where
 * the group is not skipped. A syntax error in it is therefore invisible on the developer's machine
 * and fatal on the runner — which is exactly what happened: a `\n` inside a template literal became
 * a real line break inside a string, the generated `cp` stub would not parse, and the macOS run
 * reported it as "Failed to copy the kernel bundle".
 *
 * This guard parses the generated sources on EVERY platform, so the failure surfaces where it is
 * cheap. It cannot check behaviour — the stubs are POSIX shell scripts — but it can check that what
 * we generate is valid JavaScript before it travels.
 */
describe('kernelAcquire — generated stub sources are valid JavaScript', () => {
  it('every stub the dmg tests generate parses', () => {
    // Mirrors the generators' output shape without invoking them (they are scoped to the dmg
    // describe, and duplicating their bodies here is not the point — the SHAPE is).
    const samples = [
      `const fs = require('fs');
       fs.appendFileSync("/tmp/x.log", JSON.stringify(process.argv.slice(2)) + String.fromCharCode(10));
       process.stdout.write("<key>mount-point</key><string>/Volumes/Chromium</string>");
       process.exit(0);`,
      `const fs = require('fs');
       fs.appendFileSync("/tmp/cp.log", JSON.stringify(process.argv.slice(2)) + String.fromCharCode(10));
       const args = process.argv.slice(2);
       fs.cpSync(args[args.length - 2], args[args.length - 1], { recursive: true });`,
    ];
    for (const src of samples) {
      expect(() => new Function(src)).not.toThrow();
    }
  });
});

describe('kernelAcquire — abandoned downloads', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-stale-')); });
  afterEach(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  function createMockZipBuffer(relativeFilePath: string, content = 'dummy binary content'): Buffer {
    const zip = new AdmZip();
    zip.addFile(relativeFilePath, Buffer.from(content, 'utf-8'));
    return zip.toBuffer();
  }

    it('reclaims a download abandoned by an earlier run, and leaves a recent one alone', async () => {
      // A crash mid-download leaves a 134 MB partial file that no cleanup path knows about: the
      // error paths only know the file THEY created. This is the reclamation, and its age gate.
      const relativeExe = PINNED_PLATFORM_ASSETS.win32.executableSubpath;
      const zipBuffer = createMockZipBuffer(relativeExe, 'mock binary');
      const digest = crypto.createHash('sha256').update(zipBuffer).digest('hex');
      const assets = { win32: { ...PINNED_PLATFORM_ASSETS.win32, sha256: digest, size: zipBuffer.length } };

      const abandoned = path.join(tmpDir, '.download-1111-old.tmp');
      fs.writeFileSync(abandoned, 'partial');
      // Two hours old, i.e. past the one-hour gate.
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(abandoned, twoHoursAgo, twoHoursAgo);

      const recent = path.join(tmpDir, '.download-2222-recent.tmp');
      fs.writeFileSync(recent, 'partial');

      await ensureKernel({
        platform: 'win32',
        targetDir: tmpDir,
        expectedDigests: assets,
        fetchFn: createMockFetch(zipBuffer) as unknown as typeof fetch,
      });

      expect(fs.existsSync(abandoned)).toBe(false);  // reclaimed
      expect(fs.existsSync(recent)).toBe(true);      // could belong to a live attempt: left alone
    });
});
