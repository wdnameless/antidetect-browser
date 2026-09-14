import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { initDb, closeDb, flushDb } from './db';
import { startApi } from './api/server';
import { getApiKey, API_HOST, API_PORT, DATA_DIR } from './config';
import { seedDevices } from './devices/deviceManager';
import { recoverStaleRunning, purgeExpiredTrash, adoptOrphanedProfileDirs } from './profiles/profileManager';
import { startupPurgeSweep, shutdownCleanup } from './profiles/temporaryRegistry';
import { stopAll, startProfile, stopProfile, isRunning } from './launcher/chromium';
import { stopAllSessions } from './syncer/actionSyncer';
import { startScheduler, stopScheduler, onProfileStatusChanged } from './scripts/triggerScheduler';
import { stopAllWorkers } from './scripts/scriptEngine';
import { getTaskQueueCoordinator } from './scripts/taskQueue';
import { getTaskGroup } from './scripts/taskGroups';
import { onProfileStatusChange, getProfile, listProfiles, resolveLaunchConfig } from './profiles/profileManager';
import {
  getTelegramBotInstance,
  resetTelegramBotInstance,
  notifyProfileStarted,
  notifyProfileStopped,
  notifyTaskGroupFinished,
} from './telegram/bot';
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
 * Returns true (our app), false (a different image), or undefined when the
 * probe failed entirely (wmic + powershell unavailable, access denied, ...).
 * A definite false lets the caller treat the lock as stale; an undefined must
 * be handled conservatively by callers (never remove a lock they can't verify).
 */
export function isProcessOurApp(
  pid: number,
  options?: ProcessInspectorOptions
): boolean | undefined {
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
          return undefined; // probe failed on both wmic and powershell
        }
      }

      const normalized = (cmdLine || '').toLowerCase();

      // KEEP: Instance-lock executable name match for single-instance enforcement.
      if (normalized.includes('antidetect browser.exe') || normalized.includes('antidetect browser')) {
        return true;
      }
      // Dev electron app
      if (normalized.includes('electron')) {
        return true;
      }
      // Node running our service or entry point
      // KEEP: Instance-lock process check for antidetect node/electron instances.
      if (
        normalized.includes('node') &&
        (normalized.includes('antidetect') ||
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
        // KEEP: POSIX instance-lock process check for antidetect.
        if (args.includes('antidetect') || args.includes('electron')) return true;
        if (args.includes('node') && (args.includes('main') || args.includes('service'))) return true;
      } catch {
        return undefined; // ps probe failed
      }
      return false;
    }
  } catch {
    return undefined;
  }
}

export function acquireInstanceLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      const stalePid = Number(raw);
      let isRunningApp = false;
      if (Number.isFinite(stalePid) && stalePid > 0 && stalePid !== process.pid) {
        let alive: boolean;
        try {
          process.kill(stalePid, 0); // signal 0 = liveness probe
          alive = true;
        } catch (err) {
          // EPERM: the process EXISTS but runs at higher privilege. Treating
          // it as dead lets a second instance start over it and its debounced
          // persist can then overwrite our database file.
          alive = (err as NodeJS.ErrnoException).code === 'EPERM';
        }

        if (alive) {
          const probed = isProcessOurApp(stalePid);
          if (probed === undefined) {
            // The pid is alive but we cannot verify its image (no wmic, no
            // powershell, access denied). Removing the lock here risks two
            // services writing one database — fail closed instead.
            const msg = `Another process (pid ${stalePid}) holds the instance lock and its image could not be verified. Close it first or remove ${LOCK_FILE} manually.`;
            logger.warn('instance lock held by unverifiable process', { stalePid });
            throw new Error(msg);
          }
          isRunningApp = probed;
        }
      }

      if (isRunningApp) {
        throw new Error(
          `Another instance is already running (pid ${stalePid}). Close it first.`
        );
      }

      // Stale lock: pid dead, own pid, recycled pid of another image, or an
      // unreadable/corrupt lock file. (An alive-but-unverifiable pid throws above.)
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
    resetTelegramBotInstance();
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

// ---------------------------------------------------------------------------
// Telegram bot wiring (umbrella 2.8): construct the singleton, bind command
// handlers, subscribe to profile status changes and task-group completion.
// All helpers no-op when the bot is disabled (no token / enabled flag).
// ---------------------------------------------------------------------------
const PROFILE_LIST_CAP = 20;

/** Wire the telegram singleton, command handlers and event hooks (exported for integration tests). */
export function wireTelegramBot(): void {
  const bot = getTelegramBotInstance();

  bot.setCommandHandlers({
    start: async (id) => {
      if (!id) return 'Usage: /start <profile id>';
      try {
        const cfg = resolveLaunchConfig(id);
        if (cfg.browserType === 'firefox') {
          return 'This profile uses Firefox (Camoufox) — start it from the app, not via Telegram.';
        }
        const result = await startProfile(cfg);
        return result && result.pid ? `Profile ${id} started (pid ${result.pid}).` : `Profile ${id} start failed.`;
      } catch (err) {
        return `Profile ${id} start failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    stop: async (id) => {
      if (!id) return 'Usage: /stop <profile id>';
      try {
        await stopProfile(id);
        return `Profile ${id} stopped.`;
      } catch (err) {
        return `Profile ${id} stop failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    status: async () => {
      // The handler contract passes no id: report live + stored state globally.
      const page = listProfiles(1, PROFILE_LIST_CAP);
      const running = page.list.filter((p) => isRunning(p.user_id));
      const storedRunning = page.list.filter((p) => !isRunning(p.user_id) && p.status === 'running');
      const closed = page.list.length - running.length - storedRunning.length;
      let text = `Profiles: ${page.total} total\nRunning: ${running.length}\nClosed: ${closed}`;
      if (storedRunning.length > 0) {
        text += `\nStale "running" ${storedRunning.length} (crash recovery will close them)`;
      }
      return text;
    },
    list: async () => {
      const page = listProfiles(1, PROFILE_LIST_CAP);
      const rows = page.list.map((p) => `• ${p.name || p.user_id} — ${isRunning(p.user_id) ? 'running' : 'closed'}`);
      const omitted = page.total - rows.length;
      let text = rows.length ? rows.join('\n') : 'No profiles.';
      if (omitted > 0) text += `\n… and ${omitted} more omitted.`;
      return text;
    },
  });

  // Profile status notifications (second subscription beside the scheduler's).
  onProfileStatusChange((profileId, status) => {
    const name = getProfile(profileId)?.name ?? undefined;
    if (status === 'running') {
      notifyProfileStarted(profileId, name);
    } else if (status === 'closed' || status === 'error') {
      notifyProfileStopped(profileId, name);
    }
  });

  // Task-group completion notifications: the coordinator's 'group-finished'
  // event is fired from its tick; nobody else subscribes today.
  getTaskQueueCoordinator().on('group-finished', (groupId, finalStatus) => {
    const group = typeof groupId === 'string' || typeof groupId === 'number' ? getTaskGroup(String(groupId)) : undefined;
    notifyTaskGroupFinished(groupId, String(finalStatus), group?.name);
  });
}

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

  // Orphan adoption: re-register profile directories whose DB row was lost
  // (e.g. metadata DB restored from an older backup after a crash).
  try {
    const adopted = adoptOrphanedProfileDirs();
    if (adopted > 0) {
      console.log(`[antidetect] orphan adoption: ${adopted} profile dir(s) re-registered`);
    }
  } catch (err) {
    logger.warn('orphan adoption failed', { error: String(err) });
    console.error('[antidetect] orphan adoption failed:', (err as Error).message);
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

  // Telegram bot (umbrella 2.8): construct singleton, bind commands and hooks.
  wireTelegramBot();

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
