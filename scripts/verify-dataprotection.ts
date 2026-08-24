// Verify data-protection hardening (v0.2.16):
//  1. Atomic debounced persist (no .tmp left, file updated after debounce)
//  2. Daily rotating backups on startup
//  3. Crash recovery (hard-killed service -> stale "running" -> "closed")
//  4. Single-instance lock (second instance refuses to start)
//  5. Host header validation (DNS-rebinding protection)
//  6. Auth still enforced (401 without key)
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; npx tsx scripts/verify-dataprotection.ts
import { spawn, execFile, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const ROOT = 'D:\\WORK\\antidetect browser';
const DATA = path.join(ROOT, 'data');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const PORT = 50341;
const BASE = `http://127.0.0.1:${PORT}`;

function spawnService(): ChildProcess {
  const child = spawn(
    process.execPath,
    [TSX, path.join(ROOT, 'src', 'main', 'index.ts')],
    {
      cwd: ROOT,
      env: { ...process.env, ANTIDETECT_DATA_DIR: DATA, API_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  child.stderr?.on('data', (d) => process.stdout.write('[svc] ' + d));
  return child;
}

function waitReady(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`${BASE}/status`);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error('service did not become ready'));
      setTimeout(tick, 400);
    };
    void tick();
  });
}

function requestRaw(hostHeader: string, reqPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE}${reqPath}`,
      { headers: { Host: hostHeader } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function taskkill(pid: number, tree = false): void {
  const args = tree ? ['/pid', String(pid), '/T', '/F'] : ['/pid', String(pid), '/F'];
  execFile('taskkill', args, () => {});
}

async function main(): Promise<void> {
  const results: string[] = [];
  const ok = (name: string, pass: boolean, extra = ''): void => {
    results.push(`${name}: ${pass ? 'PASS' : 'FAIL'}${extra ? ' (' + extra + ')' : ''}`);
  };

  // ---- Phase 1: single instance + host check + auth + persist/backup ----
  const svc = spawnService();
  await waitReady();

  // 4) single-instance lock
  const svc2 = spawnService();
  const lockFailed = await new Promise<boolean>((resolve) => {
    let buf = '';
    const timer = setTimeout(() => resolve(false), 15000);
    svc2.stderr?.on('data', (d) => {
      buf += String(d);
      if (buf.includes('already running')) {
        clearTimeout(timer);
        resolve(true);
      }
    });
    svc2.on('exit', (code) => {
      if (String(code) !== '0') {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
  ok('SINGLE-INSTANCE LOCK', lockFailed);
  try { svc2.kill(); } catch { /* ignore */ }

  // 5) Host header validation
  const evil = await requestRaw('evil-rebind.example.com', '/status');
  ok('HOST CHECK (rebind blocked)', evil.status === 403, `status=${evil.status}`);
  const good = await requestRaw('127.0.0.1:50341', '/status');
  ok('HOST CHECK (loopback allowed)', good.status === 200, `status=${good.status}`);

  // 6) auth enforced
  const noAuth = await fetch(`${BASE}/api/v1/browser/list`);
  ok('AUTH ENFORCED (401 without key)', noAuth.status === 401, `status=${noAuth.status}`);

  // 1) debounced atomic persist: create profile, wait > debounce, check file
  const apiKey = fs.readFileSync(path.join(DATA, 'api_key'), 'utf8').trim();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const created = await fetch(`${BASE}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'dp-persist-test' }),
  }).then((r) => r.json());
  const pid1: string = created?.data?.user_id;
  await new Promise((r) => setTimeout(r, 500)); // > debounce window
  const dbPath = path.join(DATA, 'antidetect.db');
  const tmpLeft = fs.existsSync(dbPath + '.tmp');
  ok('ATOMIC PERSIST (no .tmp left)', !tmpLeft);
  const dbMtime = fs.statSync(dbPath).mtimeMs;
  ok('PERSIST WROTE FILE (mtime fresh)', Date.now() - dbMtime < 10000);

  // 2) backups created on startup (fresh stamp => backup on first init)
  const backupDir = path.join(DATA, 'backups');
  const hasBackup = fs.existsSync(backupDir) &&
    fs.readdirSync(backupDir).some((f) => f.startsWith('antidetect-') && f.endsWith('.db'));
  ok('BACKUP CREATED', hasBackup);

  // ---- Phase 2: crash recovery ----
  // start profile -> status running
  const started = await fetch(`${BASE}/api/v1/browser/start?user_id=${pid1}`, { headers }).then((r) => r.json());
  const browserPid: number | undefined = started?.data?.pid;
  if (started?.code !== 0) throw new Error('profile start failed: ' + JSON.stringify(started));

  const list1 = await fetch(`${BASE}/api/v1/browser/list`, { headers }).then((r) => r.json());
  const runningRow = list1.data.list.find((p: { user_id: string }) => p.user_id === pid1);
  ok('PROFILE RUNNING BEFORE CRASH', runningRow?.status === 'running', `status=${runningRow?.status}`);

  // hard-kill the service (simulates a crash; no graceful shutdown runs)
  const svcPid = svc.pid;
  taskkill(svcPid as number);
  await new Promise((r) => setTimeout(r, 2000));

  // restart the service on the same data dir
  const svc3 = spawnService();
  await waitReady();

  const list2 = await fetch(`${BASE}/api/v1/browser/list`, { headers }).then((r) => r.json());
  const recRow = list2.data.list.find((p: { user_id: string }) => p.user_id === pid1);
  ok('CRASH RECOVERY (stale running -> closed)', recRow?.status === 'closed', `status=${recRow?.status}`);

  // cleanup: stop orphan browser, delete test profiles, stop service
  if (browserPid) taskkill(browserPid, true);
  await fetch(`${BASE}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: pid1 }) });
  taskkill(svc3.pid as number, true);
  await new Promise((r) => setTimeout(r, 1500));

  console.log(results.join('\n'));
  const allPass = results.every((r) => r.endsWith('PASS') || r.includes(': PASS'));
  console.log(allPass ? 'ALL DATA-PROTECTION CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
