// Structured file logger with daily rotation and retention (v0.2.19).
// - Files: <DATA_DIR>/logs/app-YYYY-MM-DD.log
// - Lines are buffered and flushed every second (never blocks request handling).
// - Retention: logs older than KEEP_DAYS are removed on startup.
// - Console mirror is kept so `npm run service` stays readable in a terminal.
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../config';

export const LOG_DIR = path.join(DATA_DIR, 'logs');
const KEEP_DAYS = 14;

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export type LogLevel = 'info' | 'warn' | 'error';

function fileFor(date = new Date()): string {
  return path.join(LOG_DIR, `app-${date.toISOString().slice(0, 10)}.log`);
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushLogs();
  }, 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

/** Write all buffered lines to disk (synchronous, safe on exit). */
export function flushLogs(): void {
  if (queue.length === 0) return;
  const lines = queue;
  queue = [];
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(fileFor(), lines.join('\n') + '\n', 'utf8');
  } catch {
    // logging must never crash the app
  }
}

export function log(level: LogLevel, msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  let line = `${ts} [${level}] ${msg}`;
  if (meta !== undefined) {
    try {
      line += ` ${JSON.stringify(meta)}`;
    } catch {
      // non-serializable meta — skip it
    }
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  queue.push(line);
  scheduleFlush();
}

export const logger = {
  info: (msg: string, meta?: unknown): void => log('info', msg, meta),
  warn: (msg: string, meta?: unknown): void => log('warn', msg, meta),
  error: (msg: string, meta?: unknown): void => log('error', msg, meta),
};

export function initLogger(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = f.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!m) continue;
      if (new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) {
        fs.rmSync(path.join(LOG_DIR, f), { force: true });
      }
    }
  } catch {
    // best-effort
  }
  process.on('exit', flushLogs);
}

export function listLogFiles(): Array<{ name: string; size: number; modified: number }> {
  try {
    return fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
      .sort()
      .reverse()
      .map((f) => {
        const st = fs.statSync(path.join(LOG_DIR, f));
        return { name: f, size: st.size, modified: st.mtimeMs };
      });
  } catch {
    return [];
  }
}

/** Read a log file (by filename), optionally only the last N lines. */
export function readLog(name: string, tail = 500): { ok: boolean; content: string; error?: string } {
  // prevent path traversal — only plain filenames from our naming scheme
  if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) {
    return { ok: false, content: '', error: 'invalid log filename' };
  }
  try {
    const full = path.join(LOG_DIR, name);
    if (!fs.existsSync(full)) return { ok: false, content: '', error: 'log not found' };
    const raw = fs.readFileSync(full, 'utf8');
    const lines = raw.split('\n');
    const content = lines.slice(Math.max(0, lines.length - tail)).join('\n');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, content: '', error: (err as Error).message };
  }
}
