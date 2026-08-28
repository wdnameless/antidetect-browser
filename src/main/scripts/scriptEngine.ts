// Script Engine (Sprint 4.1): sandboxed JS execution over the Local API.
//
// Isolation model:
//   - Each run executes inside a worker_threads Worker (hard kill via
//     terminate() after SCRIPT_TIMEOUT_MS) whose main file creates a
//     node:vm context containing ONLY the `app` facade + standard JS globals.
//   - No require/process/fs/child_process/net in the context: the worker file
//     never passes them into vm.createContext, and the script code cannot
//     reach the worker's own module scope.
//   - app.http.fetch is an http/https wrapper with a per-call timeout and a
//     hard budget of 100 calls per run; it attaches the app's Bearer key.
//   - app.keys.get returns values only into worker memory (preloaded from the
//     encrypted store); key writes are flushed back to main on finish. The
//     engine itself never logs key values — only what the script logs.
//   - One worker per profile run; at most MAX_WORKERS concurrent, extra runs
//     wait in a FIFO queue.
import { randomUUID } from 'crypto';
import { Worker } from 'worker_threads';
import { getDb } from '../db';
import { API_HOST, API_PORT, getApiKey } from '../config';
import { logger } from '../util/logger';
import { listKeys, getKeyValueForScript, setKeyValue } from './keyStore';

export const SCRIPT_TIMEOUT_MS = 60_000;
export const MAX_HTTP_CALLS = 100;
export const MAX_WORKERS = 5;
export const HTTP_CALL_TIMEOUT_MS = 15_000;

export interface ScriptRow {
  id: string;
  name: string;
  code: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  last_status: string | null;
}

export interface ScriptRunRow {
  id: string;
  script_id: string;
  profile_ids: string[];
  status: 'running' | 'done' | 'error' | 'timeout';
  log: string;
  started_at: number;
  finished_at: number | null;
}

interface ActiveRun {
  runId: string;
  worker: Worker;
  timer: ReturnType<typeof setTimeout>;
  profileId: string;
}

const activeRuns = new Map<string, ActiveRun>();
const queue: Array<{ scriptId: string; code: string; runId: string; profileId: string }> = [];

// ---------------------------------------------------------------------------
// Worker source (inline via eval:true; only worker_threads + vm + http/https
// are required INSIDE the worker — the sandbox context never sees them).
// ---------------------------------------------------------------------------

const WORKER_SOURCE = `
const { workerData, parentPort } = require('worker_threads');
const vm = require('node:vm');
const http = require('http');
const https = require('https');

const cfg = workerData; // { code, profileId, apiBase, apiKey, maxHttpCalls, httpTimeoutMs, keyValues }
let httpCalls = 0;
const logs = [];

/** Node http(s) request with a hard timeout; resolves {status, data}. */
function rawRequest(urlStr, opts) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(new Error('invalid url')); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { reject(new Error('only http/https allowed')); return; }
    const mod = u.protocol === 'https:' ? https : http;
    const headers = Object.assign(
      { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
      (opts && opts.headers) || {}
    );
    const req = mod.request(u, { method: (opts && opts.method) || 'GET', headers, timeout: cfg.httpTimeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size <= 262144) chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch (e) { data = text; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('http call timeout')));
    req.on('error', reject);
    if (opts && opts.body != null) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

function api(pathAndQuery, opts) {
  return rawRequest(cfg.apiBase + pathAndQuery, opts);
}

/** app facade — the ONLY surface the script sees. */
const app = {
  profileId: cfg.profileId,
  profiles: {
    list: async (params) => {
      const q = new URLSearchParams(Object.entries(params || {}).map(([k, v]) => [k, String(v)]));
      const r = await api('/api/v1/browser/list?' + q.toString(), { method: 'GET' });
      return r.data;
    },
    get: async (id) => {
      const r = await api('/api/v1/browser-profile/detail?user_id=' + encodeURIComponent(String(id)), { method: 'GET' });
      return r.data;
    },
    start: async (id) => {
      const r = await api('/api/v1/browser/start?user_id=' + encodeURIComponent(String(id)), { method: 'GET' });
      return r.data;
    },
    stop: async (id) => {
      const r = await api('/api/v1/browser/stop?user_id=' + encodeURIComponent(String(id)), { method: 'POST', body: {} });
      return r.data;
    },
  },
  proxy: {
    list: async () => {
      const r = await api('/api/v1/proxy/list', { method: 'GET' });
      return r.data;
    },
  },
  keys: {
    get: (key) => cfg.keyValues[key],
    set: (key, value) => { cfg.keyValues[key] = String(value); },
  },
  http: {
    fetch: async (url, opts) => {
      if (httpCalls >= cfg.maxHttpCalls) throw new Error('http call budget exceeded (' + cfg.maxHttpCalls + ')');
      httpCalls++;
      return rawRequest(String(url), opts || {});
    },
  },
  log: (msg) => { logs.push(String(msg)); },
};

async function main() {
  try {
    const context = vm.createContext({
      app,
      console: { log: app.log, error: app.log, warn: app.log, info: app.log },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 30000)),
      clearTimeout,
      Promise, Date, Math, JSON, Object, Array, String, Number, Boolean,
      Map, Set, WeakMap, WeakSet, RegExp, Error, TypeError, RangeError, SyntaxError,
      encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
      URL, URLSearchParams, isNaN, isFinite, parseInt, parseFloat, BigInt,
    });
    const result = await vm.runInContext(cfg.code, context, { timeout: 55000 });
    let out = null;
    if (result !== undefined) {
      try { out = JSON.parse(JSON.stringify(result)); } catch (e) { out = String(result); }
    }
    parentPort.postMessage({ type: 'done', result: out, logs, keyValues: cfg.keyValues });
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String((e && e.message) || e), logs, keyValues: cfg.keyValues });
  }
}

main();
`;

// ---------------------------------------------------------------------------
// Scripts CRUD
// ---------------------------------------------------------------------------

export function listScripts(): ScriptRow[] {
  return getDb()
    .prepare('SELECT * FROM scripts ORDER BY updated_at DESC')
    .all() as unknown as ScriptRow[];
}

export function getScript(id: string): ScriptRow | undefined {
  return getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(id) as unknown as ScriptRow | undefined;
}

export function createScript(name: string, code: string): { id: string } {
  const id = 'scr_' + randomUUID();
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO scripts (id, name, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, code, now, now);
  return { id };
}

export function updateScript(id: string, updates: { name?: string; code?: string }): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.code !== undefined) { sets.push('code = ?'); params.push(updates.code); }
  if (sets.length === 0) return false;
  sets.push('updated_at = ?');
  params.push(Date.now(), id);
  return (
    getDb()
      .prepare(`UPDATE scripts SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params).changes > 0
  );
}

export function deleteScript(id: string): boolean {
  const res = getDb().prepare('DELETE FROM scripts WHERE id = ?').run(id);
  if (res.changes > 0) {
    getDb().prepare('DELETE FROM script_runs WHERE script_id = ?').run(id);
    getDb().prepare('DELETE FROM triggers WHERE script_id = ?').run(id);
  }
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function listRuns(scriptId: string): ScriptRunRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM script_runs WHERE script_id = ? ORDER BY started_at DESC LIMIT 50')
    .all(scriptId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    script_id: String(r.script_id),
    profile_ids: safeParseArray(String(r.profile_ids ?? '[]')),
    status: String(r.status) as ScriptRunRow['status'],
    log: String(r.log ?? ''),
    started_at: Number(r.started_at) || 0,
    finished_at: (r.finished_at as number | null) ?? null,
  }));
}

export interface RunHandle {
  run_ids: string[];
  queued: number;
}

/** Preload every global key into worker memory (plaintext never hits logs). */
function preloadKeyValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of listKeys()) {
    const value = getKeyValueForScript(item.key);
    if (value !== undefined) out[item.key] = value;
  }
  return out;
}

/**
 * Start a script run across profiles: one worker per profile, FIFO queue with
 * at most MAX_WORKERS concurrent workers. Returns immediately.
 */
export function runScript(scriptId: string, profileIds: string[]): RunHandle {
  const script = getScript(scriptId);
  if (!script) throw new Error('script not found');
  const runIds: string[] = [];
  let queued = 0;
  for (const pid of profileIds) {
    const runId = 'run_' + randomUUID();
    getDb()
      .prepare('INSERT INTO script_runs (id, script_id, profile_ids, status, log, started_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(runId, scriptId, JSON.stringify([pid]), 'running', '', Date.now());
    runIds.push(runId);
    if (activeRuns.size < MAX_WORKERS) {
      startWorker(scriptId, script.code, runId, pid);
    } else {
      queue.push({ scriptId, code: script.code, runId, profileId: pid });
      queued++;
    }
  }
  getDb()
    .prepare('UPDATE scripts SET last_run_at = ?, last_status = ? WHERE id = ?')
    .run(Date.now(), 'running', scriptId);
  return { run_ids: runIds, queued };
}

function startWorker(scriptId: string, code: string, runId: string, profileId: string): void {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      code,
      profileId,
      apiBase: `http://${API_HOST}:${API_PORT}`,
      apiKey: getApiKey(),
      maxHttpCalls: MAX_HTTP_CALLS,
      httpTimeoutMs: HTTP_CALL_TIMEOUT_MS,
      keyValues: preloadKeyValues(),
    },
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 },
  });

  const timer = setTimeout(() => {
    // Hard stop: infinite loops never yield to the vm statement timeout.
    void worker.terminate();
    finishRun(runId, 'timeout', 'script exceeded 60s timeout');
  }, SCRIPT_TIMEOUT_MS);

  activeRuns.set(runId, { runId, worker, timer, profileId });

  worker.on('message', (msg: { type: string; error?: string; logs?: string[]; keyValues?: Record<string, string> }) => {
    const logs = Array.isArray(msg.logs) ? msg.logs.join('\n') : '';
    if (msg.type === 'done') {
      flushKeyWrites(msg.keyValues);
      finishRun(runId, 'done', logs || 'ok');
    } else {
      finishRun(runId, 'error', [msg.error ?? 'script error', logs].filter(Boolean).join('\n'));
    }
  });

  worker.on('error', (err: Error) => {
    finishRun(runId, 'error', `worker error: ${err.message}`);
  });

  worker.on('exit', (exitCode: number) => {
    if (exitCode !== 0 && activeRuns.has(runId)) {
      finishRun(runId, 'error', `worker exited with code ${exitCode}`);
    }
  });

  logger.info('script run started', { scriptId, runId, profileId });
}

/** Persist key writes made by the script (app.keys.set). */
function flushKeyWrites(keyValues: Record<string, string> | undefined): void {
  if (!keyValues) return;
  for (const [key, value] of Object.entries(keyValues)) {
    if (getKeyValueForScript(key) !== value) {
      setKeyValue(key, value);
    }
  }
}

function finishRun(runId: string, status: 'done' | 'error' | 'timeout', log: string): void {
  const run = activeRuns.get(runId);
  if (!run) return;
  clearTimeout(run.timer);
  try {
    void run.worker.terminate();
  } catch {
    // already gone
  }
  activeRuns.delete(runId);
  getDb()
    .prepare('UPDATE script_runs SET status = ?, log = ?, finished_at = ? WHERE id = ?')
    .run(status, log.slice(0, 65536), Date.now(), runId);

  const scriptId = (
    getDb().prepare('SELECT script_id FROM script_runs WHERE id = ?').get(runId) as
      | { script_id: string }
      | undefined
  )?.script_id;
  if (scriptId) {
    getDb()
      .prepare('UPDATE scripts SET last_status = ? WHERE id = ?')
      .run(status, scriptId);
  }

  logger.info('script run finished', { runId, status });

  // Pull the next queued run.
  const next = queue.shift();
  if (next) startWorker(next.scriptId, next.code, next.runId, next.profileId);
}

/** Stop every active worker (service shutdown). */
export function stopAllWorkers(): void {
  for (const run of Array.from(activeRuns.values())) {
    clearTimeout(run.timer);
    try {
      void run.worker.terminate();
    } catch {
      // ignore
    }
  }
  activeRuns.clear();
  queue.length = 0;
}

export function activeWorkerCount(): number {
  return activeRuns.size;
}

export function queuedRunCount(): number {
  return queue.length;
}