import * as fs from 'fs';
import * as path from 'path';
import { initDb, closeDb, flushDb } from './db';
import { startApi } from './api/server';
import { getApiKey, API_HOST, API_PORT, DATA_DIR } from './config';
import { seedDevices } from './devices/deviceManager';
import { recoverStaleRunning } from './profiles/profileManager';
import { stopAll } from './launcher/chromium';

// ---------------------------------------------------------------------------
// Single-instance lock: two service instances would race on the DB file.
// ---------------------------------------------------------------------------
const LOCK_FILE = path.join(DATA_DIR, 'service.lock');

function acquireInstanceLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      const stalePid = Number(raw);
      let alive = false;
      if (Number.isFinite(stalePid) && stalePid > 0 && stalePid !== process.pid) {
        try {
          process.kill(stalePid, 0); // signal 0 = liveness probe
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (alive) {
        throw new Error(
          `another Antidetect service instance is already running (pid ${stalePid}). Close it first.`
        );
      }
      // stale lock from a crashed session — remove it
      fs.rmSync(LOCK_FILE, { force: true });
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  } catch (err) {
    if ((err as Error).message.includes('already running')) throw err;
    // lock file issues must never prevent startup
    console.error('[antidetect] instance lock warning:', (err as Error).message);
  }
}

function releaseInstanceLock(): void {
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

export function shutdown(reason: string, code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[antidetect] ${reason} received — shutting down...`);
  try {
    stopAll();
  } catch {
    // ignore
  }
  try {
    flushDb();
    closeDb();
  } catch {
    // ignore
  }
  releaseInstanceLock();
  process.exit(code);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export async function startService(): Promise<void> {
  acquireInstanceLock();
  await initDb();
  seedDevices();

  // Crash recovery: profiles stuck in "running" from a previous session.
  const recovered = recoverStaleRunning();
  if (recovered > 0) {
    console.log(`[antidetect] crash recovery: ${recovered} stale running profile(s) marked closed`);
  }

  await startApi();
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
