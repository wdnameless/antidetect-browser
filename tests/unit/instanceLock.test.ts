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
    /**
     * A fake `execFileSync` that answers per COMMAND, the way the real system does.
     * The probe now consults `tasklist` first (because `wmic` is absent from
     * Windows 11 / Server 2025), so a mock returning one canned string for every
     * command cannot exercise the real decision path.
     */
    function fakeExec(answers: {
      tasklist?: string | Error;
      wmic?: string | Error;
      powershell?: string | Error;
    }) {
      return vi.fn((file: string) => {
        const key = file.startsWith('tasklist') ? 'tasklist' : file.startsWith('powershell') ? 'powershell' : 'wmic';
        const answer = answers[key as keyof typeof answers];
        if (answer === undefined) throw new Error(`${key} not available`);
        if (answer instanceof Error) throw answer;
        return answer;
      });
    }

    it('recognises our node backend when wmic is GONE but tasklist works', () => {
      // The shipped regression: `wmic` was removed from the OS, the PowerShell fallback
      // exceeded its timeout, the probe returned `undefined` for a live pid, and the
      // caller failed closed — the service refused to start and the UI had no backend.
      const exec = fakeExec({
        tasklist: '"node.exe","4242","Console","1","50,388 K"',
        wmic: new Error('wmic not found'),
        powershell: 'node.exe dist/src/main/index.js',
      });
      expect(isProcessOurApp(4242, { execFileSync: exec })).toBe(true);
    });

    it('recognises our node backend from a backslash path too', () => {
      const exec = fakeExec({
        tasklist: '"node.exe","4242","Console","1","50,388 K"',
        wmic: new Error('wmic not found'),
        powershell: 'node.exe C:\\App\\dist\\src\\main\\index.js',
      });
      expect(isProcessOurApp(4242, { execFileSync: exec })).toBe(true);
    });

    it('recognises the packaged executable by image name alone', () => {
      // No command line is needed when the image is unambiguous.
      const exec = fakeExec({ tasklist: '"Antidetect Browser.exe","77","Console","1","10 K"' });
      expect(isProcessOurApp(77, { execFileSync: exec })).toBe(true);
    });

    it('reports a DEAD pid as not-ours without consulting the command line', () => {
      const exec = fakeExec({
        tasklist: 'INFO: No tasks are running which match the specified criteria.',
      });
      expect(isProcessOurApp(999, { execFileSync: exec })).toBe(false);
    });

    it('reports an unrelated image as not-ours', () => {
      const exec = fakeExec({ tasklist: '"chrome.exe","5","Console","1","10 K"' });
      expect(isProcessOurApp(5, { execFileSync: exec })).toBe(false);
    });

    it('does not treat another Node tool as our backend', () => {
      const exec = fakeExec({
        tasklist: '"node.exe","4242","Console","1","50,388 K"',
        wmic: 'CommandLine\nnode.exe C:\\Users\\user\\.npm\\_npx\\ast-grep\\bin.js --scan',
      });
      expect(isProcessOurApp(4242, { execFileSync: exec })).toBe(false);
    });

    it('stays conservative (undefined) when a live node pid cannot be identified', () => {
      // Fail closed: we know the pid exists but cannot prove it is not ours, so the
      // caller must NOT remove the lock and risk two services writing one database.
      const exec = fakeExec({
        tasklist: '"node.exe","4242","Console","1","50,388 K"',
        wmic: new Error('wmic not found'),
        powershell: new Error('powershell timed out'),
      });
      expect(isProcessOurApp(4242, { execFileSync: exec })).toBeUndefined();
    });

    it('returns undefined when every probe fails outright', () => {
      const exec = fakeExec({ tasklist: new Error('probe failed') });
      expect(isProcessOurApp(12345, { execFileSync: exec })).toBeUndefined();
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

    it('an unverifiable live holder STOPS the launch instead of being swallowed', () => {
      // The shipped defect: the catch block only rethrew when the message contained
      // "already running" — an unrelated string. Every other refusal was logged and
      // ignored, so the service continued and died later on the busy port. The operator
      // saw a UI with no backend ("failed to fetch", dead menus) and the reason existed
      // only in a log file. A refusal must propagate so the shell can display it.
      const heldPid = 88888;
      fs.writeFileSync(LOCK_FILE, String(heldPid), 'utf8');

      process.kill = vi.fn().mockImplementation((pid: number, signal?: string | number) => {
        if (pid === heldPid && signal === 0) return true;
        return true;
      }) as never;
      // Every probe fails, so the holder cannot be identified: fail closed.
      setProcessInspectorExec(
        vi.fn().mockImplementation(() => {
          throw new Error('no probe available');
        }) as never
      );

      expect(() => acquireInstanceLock()).toThrow(/could not be verified/i);
      // And the lock must remain untouched — a lock we cannot verify is not ours to remove.
      expect(fs.readFileSync(LOCK_FILE, 'utf8').trim()).toBe(String(heldPid));
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
