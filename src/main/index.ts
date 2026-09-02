import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { initDb, closeDb, flushDb } from './db';
import { startApi } from './api/server';
import { getApiKey, API_HOST, API_PORT, DATA_DIR } from './config';
import { seedDevices } from './devices/deviceManager';
import { recoverStaleRunning, purgeExpiredTrash } from './profiles/profileManager';
import { startupPurgeSweep, shutdownCleanup } from './profiles/temporaryRegistry';
import { stopAll } from './launcher/chromium';
import { stopAllSessions } from './syncer/actionSyncer';
import { startScheduler, stopScheduler, onProfileStatusChanged } from './scripts/triggerScheduler';
import { stopAllWorkers } from './scripts/scriptEngine';
import { onProfileStatusChange } from './profiles/profileManager';
import { logger, initLogger, flushLogs } from './util/logger';

// ---------------------------------------------------------------------------
// Single-instance lock: two service instances would race on the DB file.
// ---------------------------------------------------------------------------
export const LOCK_FILE = path.join(DATA_DIR, 'service.lock');
export interface ProcessInspectorOptions {
  execFileSync?: (file: string, args: string[], options?: child_process.ExecFileSyncOptions) => string | Buffer;
}

let defaultExecFileSync = child_process.execFileSync;

export function setProcessInspectorExec(fn: typeof child_process.execFileSync | undefined): void {
  defaultExecFileSync = fn || child_process.execFileSync;
}

/**
 * Inspects the process command line / image name.
 * Allows 'Antidetect Browser.exe', 'electron', or 'node' running our service/entry script.
 * If probe fails, throws, or process is something else, returns false.
 */
export function isProcessOurApp(pid: number, options?: ProcessInspectorOptions): boolean {
  const runner = options?.execFileSync || defaultExecFileSync;
  try {
    if (process.platform === 'win32') {
      let cmdLine = '';
      try {
        const raw = runner(
          'wmic',
          ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine'],
          { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }
        );
        cmdLine = typeof raw === 'string' ? raw : raw ? raw.toString('utf8') : '';
      } catch {
        // Fallback to powershell Get-CimInstance if wmic is missing or fails
        try {
          const raw = runner(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`
            ],
            { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }
          );
          cmdLine = typeof raw === 'string' ? raw : raw ? raw.toString('utf8') : '';
        } catch {
          return false;
        }
      }

      const normalized = (cmdLine || '').toLowerCase();

      // Packaged app
      if (normalized.includes('antidetect browser.exe') || normalized.includes('antidetect browser')) {
        return true;
      }
      // Dev electron app
      if (normalized.includes('electron')) {
        return true;
      }
      // Node running our service or entry point
      if (
        normalized.includes('node') &&
        (normalized.includes('antidetect') ||
          normalized.includes('src/main') ||
          normalized.includes('src\\main') ||
          normalized.includes('dist/electron') ||
          normalized.includes('dist\\electron') ||
          normalized.includes('dist/src/main') ||
          normalized.includes('dist\\src\\main'))
      ) {
        return true;
      }

      return false;
    } else {
      // POSIX fallback: check /proc/<pid>/cmdline or ps -p <pid> -o args=
      try {
        const args = child_process.execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['pipe', 'pipe', 'ignore']
        }).toLowerCase();
        if (!args.trim()) return false;
        if (args.includes('antidetect') || args.includes('electron')) return true;
        if (args.includes('node') && (args.includes('main') || args.includes('service'))) return true;
      } catch {
        return false;
      }
      return false;
    }
  } catch {
    return false;
  }
}

export function acquireInstanceLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      const stalePid = Number(raw);
      let isRunningApp = false;
      if (Number.isFinite(stalePid) && stalePid > 0 && stalePid !== process.pid) {
        let alive = false;
        try {
          process.kill(stalePid, 0); // signal 0 = liveness probe
          alive = true;
        } catch {
          alive = false;
        }

        if (alive) {
          isRunningApp = isProcessOurApp(stalePid);
        }
      }

      if (isRunningApp) {
        throw new Error(
          `Another instance is already running (pid ${stalePid}). Close it first.`
        );
      }

      // Stale lock: either non-existent pid, own pid, process died, or recycled PID belonging to another process
      logger.warn('stale instance lock removed', { stalePid, ownPid: process.pid });
      fs.rmSync(LOCK_FILE, { force: true });
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  } catch (err) {
    if ((err as Error).message.includes('already running')) throw err;
    // lock file issues must never prevent startup
    logger.warn('instance lock warning', { error: (err as Error).message });
    console.error('[antidetect] instance lock warning:', (err as Error).message);
  }
}

export function releaseInstanceLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      if (raw === String(process.pid)) fs.rmSync(LOCK_FILE, { force: true });
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown: stop browsers, flush DB, release the lock, exit.
// ---------------------------------------------------------------------------
let shuttingDown = false;

export async function shutdown(reason: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown', { reason });
  console.log(`[antidetect] ${reason} received — shutting down...`);
  try {
    await stopAll();
  } catch {
    // ignore
  }
  try {
    await shutdownCleanup();
  } catch {
    // ignore
  }
  try {
    await stopAllSessions();
  } catch {
    // ignore
  }
  try {
    stopScheduler();
    stopAllWorkers();
  } catch {
    // ignore
  }
  try {
    flushDb();
    closeDb();
  } catch {
    // ignore
  }
  flushLogs();
  releaseInstanceLock();
  process.exit(code);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export async function startService(): Promise<void> {
  initLogger();
  logger.info('service starting', { pid: process.pid, dataDir: DATA_DIR, port: API_PORT });
  acquireInstanceLock();
  await initDb();
  seedDevices();

  // Crash recovery: profiles stuck in "running" from a previous session.
  const recovered = recoverStaleRunning();
  if (recovered > 0) {
    logger.warn('crash recovery applied', { recovered });
    console.log(`[antidetect] crash recovery: ${recovered} stale running profile(s) marked closed`);
  }

  // Trash sweep (Sprint 2.4): permanently delete soft-deleted profiles older
  // than 30 days on every service start.
  const purged = purgeExpiredTrash();
  if (purged > 0) {
    logger.info('trash purge applied', { purged });
    console.log(`[antidetect] trash purge: ${purged} profile(s) older than 30 days removed`);
  }

  // Disposable profiles sweep: purge orphaned temporary profiles from prior sessions.
  try {
    const tempPurged = await startupPurgeSweep();
    if (tempPurged.purged.length > 0) {
      logger.info('temporary profiles startup sweep applied', { count: tempPurged.purged.length });
      console.log(`[antidetect] temporary profiles sweep: ${tempPurged.purged.length} orphaned dir(s) removed`);
    }
  } catch (err) {
    logger.warn('temporary profiles startup sweep failed', { error: String(err) });
  }

  // Script triggers (Sprint 4.3): scheduler tick + event hooks on status changes.
  startScheduler();
  onProfileStatusChange(onProfileStatusChanged);

  await startApi();
  logger.info('service ready', { apiKey: getApiKey() });
  console.log(`[antidetect] ready. API key: ${getApiKey()}`);
  console.log(`[antidetect] try: curl http://${API_HOST}:${API_PORT}/status`);
}

// Allow running the backend standalone (without Electron): `npm run service`
if (require.main === module) {
  startService().catch((err) => {
    console.error('[antidetect] fatal', err);
    process.exit(1);
  });
}
