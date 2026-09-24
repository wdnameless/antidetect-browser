import { invalidateTransportCache } from './transportPolicy';
// Proxy manager: CRUD, connectivity check (http/https/socks5/ssh) and
// automatic timezone detection from the proxy's egress IP.
import { randomUUID } from 'crypto';
import * as dns from 'node:dns/promises';
import * as http from 'http';
import { getDb } from '../db';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';
import { createSshTunnel, SshTunnel } from './sshTunnel';
import { protectSecret, revealSecret } from '../util/secretStore';
import { isPrivateOrLocal } from '../util/ipInfo';

export type ProxyType = 'http' | 'https' | 'socks5' | 'ssh';

export interface ProxyInput {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  privateKey?: string;
}

export interface ProxyRow {
  id: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  private_key: string | null;
  country: string | null;
  city: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  created_at: number;
}

export interface ProxyCheckResult {
  ok: boolean;
  ip?: string;
  country?: string;
  city?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  latencyMs?: number;
  error?: string;
}

const CHECK_URL = 'http://ip-api.com/json/?fields=status,query,country,city,timezone,lat,lon';

function toProxyRow(row: unknown): ProxyRow {
  return row as ProxyRow;
}

export function createProxy(input: ProxyInput): string {
  const db = getDb();
  const id = 'x_' + randomUUID();
  db.prepare(
    `INSERT INTO proxies (id, type, host, port, username, password, private_key, country, city, timezone, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.type,
    input.host,
    input.port,
    input.username ?? null,
    protectSecret(input.password),
    protectSecret(input.privateKey),
    null,
    null,
    null,
    'unknown',
    Date.now()
  );
  return id;
}

export function getProxy(id: string): ProxyRow | undefined {
  return toProxyRow(getDb().prepare('SELECT * FROM proxies WHERE id = ?').get(id));
}

export function listProxies(): ProxyRow[] {
  return getDb()
    .prepare('SELECT * FROM proxies ORDER BY created_at DESC')
    .all() as ProxyRow[];
}

export function updateProxy(id: string, input: Partial<ProxyInput>): boolean {
  const db = getDb();
  const existing = getProxy(id);
  if (!existing) return false;
  db.prepare(
    `UPDATE proxies SET type = ?, host = ?, port = ?, username = ?, password = ?, private_key = ? WHERE id = ?`
  ).run(
    input.type ?? existing.type,
    input.host ?? existing.host,
    input.port ?? existing.port,
    input.username !== undefined ? input.username ?? null : existing.username,
    input.password !== undefined ? protectSecret(input.password) : existing.password,
    input.privateKey !== undefined ? protectSecret(input.privateKey) : existing.private_key,
    id
  );
  invalidateTransportCache();
  return true;
}

export function deleteProxy(id: string): boolean {
  const db = getDb();
  const used = db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE proxy_id = ?').get(id) as { c: number };
  if (used.c > 0) {
    throw new Error('proxy is assigned to a profile');
  }
  const deleted = db.prepare('DELETE FROM proxies WHERE id = ?').run(id).changes > 0;
  if (deleted) invalidateTransportCache();
  return deleted;
}

export function setProxyResult(id: string, result: ProxyCheckResult): void {
  getDb()
    .prepare('UPDATE proxies SET status = ?, country = ?, city = ?, timezone = ?, latitude = ?, longitude = ? WHERE id = ?')
    .run(
      result.ok ? 'ok' : 'fail',
      result.country ?? null,
      result.city ?? null,
      result.timezone ?? null,
      result.latitude ?? null,
      result.longitude ?? null,
      id
    );
}

/**
 * Check a proxy by making a request through it to ip-api.com.
 * For SSH proxies a temporary local SOCKS5 tunnel is created first.
 */
export async function checkProxy(proxy: ProxyRow): Promise<ProxyCheckResult> {
  const started = Date.now();
  let agent: http.Agent | undefined;
  let tunnel: SshTunnel | undefined;

  try {
    /*
     * Resolve the host ourselves before dialing it.
     *
     * Measured reason: a residential proxy configured as `lime.proxyhub.team:8080` failed with
     * `connect ETIMEDOUT 10.250.249.66:8080`. That address is RFC1918, so the request never left
     * the machine — the operator's resolver had answered with a private address, and the error
     * named a network timeout. Reported as a timeout, it sent the operator to the provider, who
     * was not at fault and whose proxy worked when dialed directly.
     *
     * A private, loopback or link-local answer for a public proxy host is never correct, so it is
     * reported as the DNS problem it is, naming the host AND the address it wrongly resolved to.
     */
    if (proxy.type !== 'ssh') {
      const bad = await describeUnreachableResolution(proxy.host);
      if (bad) return { ok: false, error: bad };
    }

    if (proxy.type === 'ssh') {
      tunnel = await createSshTunnel({
        host: proxy.host,
        port: proxy.port,
        username: proxy.username ?? undefined,
        password: revealSecret(proxy.password),
        privateKey: revealSecret(proxy.private_key),
      });
      // SAFETY: SocksProxyAgent implements http.Agent interface compatible with node-fetch
      agent = new SocksProxyAgent(`socks5://127.0.0.1:${tunnel.port}`) as unknown as http.Agent;
    } else if (proxy.type === 'socks5') {
      const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(revealSecret(proxy.password) ?? '')}@` : '';
      // SAFETY: SocksProxyAgent implements http.Agent interface compatible with node-fetch
      agent = new SocksProxyAgent(`socks5://${auth}${proxy.host}:${proxy.port}`) as unknown as http.Agent;
    } else {
      // http / https
      const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(revealSecret(proxy.password) ?? '')}@` : '';
      // SAFETY: HttpProxyAgent implements http.Agent interface compatible with node-fetch
      agent = new HttpProxyAgent(`http://${auth}${proxy.host}:${proxy.port}`) as unknown as http.Agent;
    }

    /*
     * Two attempts. A rotating residential gateway occasionally returns a malformed response —
     * measured here as `Parse Error: Missing expected CR after response line`, which succeeded on
     * the very next request and never repeated against the same proxy. A single attempt reported
     * that transient noise as a dead proxy.
     *
     * Only transport-level failures are retried. A well-formed answer that says the proxy is bad,
     * or an auth rejection, is a fact about the proxy and is returned immediately.
     */
    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(CHECK_URL, { agent, timeout: 15000 });
        const body = (await res.json()) as {
          status?: string;
          query?: string;
          country?: string;
          city?: string;
          timezone?: string;
          lat?: number;
          lon?: number;
        };

        if (body.status !== 'success') {
          return { ok: false, error: 'proxy check failed' };
        }
        return {
          ok: true,
          ip: body.query,
          country: body.country,
          city: body.city,
          timezone: body.timezone,
          latitude: body.lat,
          longitude: body.lon,
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        lastError = (err as Error).message;
        if (attempt === 2 || !isTransientProxyError(lastError)) break;
      }
    }
    return { ok: false, error: lastError };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    if (tunnel) await tunnel.close();
  }
}

/** A failure that a second attempt can plausibly clear, unlike a rejection or a bad credential. */
function isTransientProxyError(message: string): boolean {
  return /Parse Error|ECONNRESET|socket hang up|ETIMEDOUT|EAI_AGAIN|other side closed/i.test(message);
}

/**
 * Describe a hostname that resolves somewhere a public proxy cannot be, or null when it is fine.
 *
 * Deliberately says "DNS", not "network": the operator cannot fix a resolver by retrying, and the
 * message has to point at the machine rather than at the provider.
 */
async function describeUnreachableResolution(host: string): Promise<string | null> {
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isIpLiteral) {
    return isPrivateOrLocal(host)
      ? `proxy address ${host} is a private address; a public proxy cannot be reached there`
      : null;
  }
  try {
    const { address } = await dns.lookup(host);
    if (!isPrivateOrLocal(address)) return null;
    return (
      `${host} resolved to the private address ${address}, so the request never left this machine. ` +
      `This is a DNS problem on this computer, not a fault in the proxy — check the resolver, ` +
      `the hosts file, or a VPN/route that is intercepting the name.`
    );
  } catch (err) {
    return `${host} could not be resolved: ${(err as Error).message}`;
  }
}

export interface GeoFillStatus {
  running: boolean;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  current_proxy_id: string | null;
  started_at: number | null;
  pacing_ms: number;
}

const GEO_FILL_PACING_MS = 1500; // 1500ms delay = 40 req/min (strictly under ip-api 45 req/min free limit)

let cancelGeoFillDelay: (() => void) | null = null;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    cancelGeoFillDelay = null;
    resolve();
  }, ms);
  cancelGeoFillDelay = () => {
    clearTimeout(timer);
    cancelGeoFillDelay = null;
    resolve();
  };
  return promise;
}
let geoFillActive = false;
let geoFillAbort = false;
let geoFillRunId = 0;
let geoFillStatus: GeoFillStatus = {
  running: false,
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  current_proxy_id: null,
  started_at: null,
  pacing_ms: GEO_FILL_PACING_MS,
};

export function getGeoFillStatus(): GeoFillStatus {
  return { ...geoFillStatus };
}

export function stopGeoFill(): GeoFillStatus {
  if (geoFillActive) {
    geoFillAbort = true;
    geoFillActive = false;
  }
  geoFillStatus.running = false;
  geoFillStatus.current_proxy_id = null;
  if (cancelGeoFillDelay) {
    cancelGeoFillDelay();
  }
  return { ...geoFillStatus, running: false };
}

export function startGeoFill(options?: { force?: boolean }): GeoFillStatus {
  if (geoFillActive) {
    return { ...geoFillStatus };
  }

  const db = getDb();
  const query = options?.force
    ? 'SELECT * FROM proxies WHERE (country IS NULL OR country = \'\' OR city IS NULL) ORDER BY created_at DESC'
    : 'SELECT * FROM proxies WHERE (country IS NULL OR country = \'\' OR city IS NULL) AND status != \'fail\' ORDER BY created_at DESC';
  const candidates = db.prepare(query).all() as ProxyRow[];

  if (candidates.length === 0) {
    geoFillStatus = {
      running: false,
      total: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      current_proxy_id: null,
      started_at: null,
      pacing_ms: GEO_FILL_PACING_MS,
    };
    return { ...geoFillStatus };
  }

  const runId = ++geoFillRunId;
  geoFillActive = true;
  geoFillAbort = false;
  geoFillStatus = {
    running: true,
    total: candidates.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    current_proxy_id: null,
    started_at: Date.now(),
    pacing_ms: GEO_FILL_PACING_MS,
  };

  void (async () => {
    try {
      for (const proxy of candidates) {
        if (geoFillAbort || runId !== geoFillRunId) break;

        const current = getProxy(proxy.id);
        if (!current || (current.country && current.city)) {
          if (runId !== geoFillRunId) break;
          geoFillStatus.completed++;
          continue;
        }

        if (geoFillAbort || runId !== geoFillRunId) break;
        geoFillStatus.current_proxy_id = proxy.id;
        try {
          const res = await checkProxy(current);
          if (geoFillAbort || runId !== geoFillRunId) break;
          setProxyResult(proxy.id, res);
          if (res.ok) {
            geoFillStatus.succeeded++;
          } else {
            geoFillStatus.failed++;
          }
        } catch {
          if (geoFillAbort || runId !== geoFillRunId) break;
          geoFillStatus.failed++;
        }
        if (geoFillAbort || runId !== geoFillRunId) break;
        geoFillStatus.completed++;

        if (!geoFillAbort && runId === geoFillRunId && geoFillStatus.completed < geoFillStatus.total) {
          await delay(GEO_FILL_PACING_MS);
        }
      }
    } finally {
      if (runId === geoFillRunId) {
        geoFillActive = false;
        geoFillStatus.running = false;
        geoFillStatus.current_proxy_id = null;
      }
    }
  })();

  return { ...geoFillStatus };
}

export {
  checkSingleProxyHealth,
  checkProxiesBulk,
  getCachedHealth,
  clearHealthCache,
  recordProxyUsage,
  getProfileProxyUsage,
  checkCandidateProxyDrift,
  classifyError,
  type HealthReasonCode,
  type ProxyHealthResult,
  type ProxyUsageRecord,
  type ProxyUsageResponse,
} from './proxyHealth';
