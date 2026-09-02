import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  acquireInstanceLock,
  releaseInstanceLock,
  isProcessOurApp,
  setProcessInspectorExec,
  LOCK_FILE,
} from '../../src/main/index';

describe('instanceLock', () => {
  const originalKill = process.kill;

  beforeEach(() => {
    setProcessInspectorExec(undefined);
    vi.restoreAllMocks();
    if (fs.existsSync(LOCK_FILE)) {
      try {
        fs.rmSync(LOCK_FILE, { force: true });
      } catch {
        // ignore
      }
    }
  });

  afterEach(() => {
    setProcessInspectorExec(undefined);
    process.kill = originalKill;
    vi.restoreAllMocks();
    if (fs.existsSync(LOCK_FILE)) {
      try {
        fs.rmSync(LOCK_FILE, { force: true });
      } catch {
        // ignore
      }
    }
  });

  describe('isProcessOurApp', () => {
    it('returns true when command line contains Antidetect Browser.exe', () => {
      const fakeExec = vi.fn().mockReturnValue(
        'CommandLine\n"C:\\Program Files\\Antidetect Browser\\Antidetect Browser.exe" --profile=default'
      );
      expect(isProcessOurApp(12345, { execFileSync: fakeExec })).toBe(true);
    });

    it('returns true when command line contains electron', () => {
      const fakeExec = vi.fn().mockReturnValue(
        'CommandLine\nelectron.exe . --inspect'
      );
      expect(isProcessOurApp(12345, { execFileSync: fakeExec })).toBe(true);
    });

    it('returns true when command line contains node with our service or entry path', () => {
      const fakeExec = vi.fn().mockReturnValue(
        'CommandLine\nnode.exe dist/src/main/index.js'
      );
      expect(isProcessOurApp(12345, { execFileSync: fakeExec })).toBe(true);
    });

    it('returns false when command line belongs to an unrelated program (e.g. ast-grep node.exe)', () => {
      const fakeExec = vi.fn().mockReturnValue(
        'CommandLine\nnode.exe C:\\Users\\user\\.npm\\_npx\\ast-grep\\bin.js --scan'
      );
      expect(isProcessOurApp(12345, { execFileSync: fakeExec })).toBe(false);
    });

    it('returns false when probe throws or fails', () => {
      const fakeExec = vi.fn().mockImplementation(() => {
        throw new Error('Process not found');
      });
      expect(isProcessOurApp(12345, { execFileSync: fakeExec })).toBe(false);
    });
  });

  describe('acquireInstanceLock', () => {
    it('creates lock when no lock file exists', () => {
      acquireInstanceLock();
      expect(fs.existsSync(LOCK_FILE)).toBe(true);
      expect(fs.readFileSync(LOCK_FILE, 'utf8').trim()).toBe(String(process.pid));
    });

    it('stale lock with non-existent PID -> proceeds, writes new lock', () => {
      // Fake an inactive PID
      const stalePid = 999998;
      fs.writeFileSync(LOCK_FILE, String(stalePid), 'utf8');

      // process.kill(stalePid, 0) throws ESRCH
      process.kill = vi.fn().mockImplementation((pid: number, signal?: string | number) => {
        if (pid === stalePid && signal === 0) {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      }) as any;

      acquireInstanceLock();
      expect(fs.readFileSync(LOCK_FILE, 'utf8').trim()).toBe(String(process.pid));
    });

    it('stale lock with same PID as current process -> proceeds, writes new lock', () => {
      fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
      acquireInstanceLock();
      expect(fs.readFileSync(LOCK_FILE, 'utf8').trim()).toBe(String(process.pid));
    });

    it('stale lock with recycled PID pointing to a different image (e.g. ast-grep node.exe) -> proceeds, removes stale lock, writes new lock', () => {
      const recycledPid = 88888;
      fs.writeFileSync(LOCK_FILE, String(recycledPid), 'utf8');

      // Process is alive
      process.kill = vi.fn().mockImplementation((pid: number, signal?: string | number) => {
        if (pid === recycledPid && signal === 0) return true;
        return true;
      }) as any;

      // Command line is a different image (ast-grep)
      const fakeExec = vi.fn().mockReturnValue(
        'CommandLine\nnode.exe C:\\npm\\ast-grep\\bin.js --scan'
      );
      setProcessInspectorExec(fakeExec as any);

      acquireInstanceLock();
      expect(fs.readFileSync(LOCK_FILE, 'utf8').trim()).toBe(String(process.pid));
    });

    it('valid active lock pointing to our app image -> throws "Another instance is already running"', () => {
      const activePid = 77777;
      fs.writeFileSync(LOCK_FILE, String(activePid), 'utf8');

      // Process is alive
      process.kill = vi.fn().mockImplementation((pid: number, signal?: string | number) => {
        if (pid === activePid && signal === 0) return true;
        return true;
      }) as any;

      const fakeExec = vi.fn().mockReturnValue(
        'CommandLine\n"C:\\Program Files\\Antidetect Browser\\Antidetect Browser.exe"'
      );
      setProcessInspectorExec(fakeExec as any);

      expect(() => acquireInstanceLock()).toThrow(
        /Another instance is already running/i
      );
    });

    it('corrupted lock file -> proceeds, writes new lock', () => {
      fs.writeFileSync(LOCK_FILE, 'not-a-number-corrupted-content', 'utf8');
      acquireInstanceLock();
      expect(fs.readFileSync(LOCK_FILE, 'utf8').trim()).toBe(String(process.pid));
    });
  });

  describe('releaseInstanceLock', () => {
    it('removes lock file if owned by current process', () => {
      fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
      releaseInstanceLock();
      expect(fs.existsSync(LOCK_FILE)).toBe(false);
    });

    it('does not remove lock file if owned by another process', () => {
      const anotherPid = 66666;
      fs.writeFileSync(LOCK_FILE, String(anotherPid), 'utf8');
      releaseInstanceLock();
      expect(fs.existsSync(LOCK_FILE)).toBe(true);
      expect(fs.readFileSync(LOCK_FILE, 'utf8').trim()).toBe(String(anotherPid));
    });
  });
});
