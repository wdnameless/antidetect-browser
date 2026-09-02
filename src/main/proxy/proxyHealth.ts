import type { Agent } from 'http';
import { getDb } from '../db';
import { getProxy, listProxies, type ProxyRow } from './proxyManager';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';
import { createSshTunnel, type SshTunnel } from './sshTunnel';
import { revealSecret } from '../util/secretStore';
import { randomUUID } from 'crypto';

export type HealthReasonCode =
  | 'ok'
  | 'auth-failed'
  | 'connect-timeout'
  | 'tls-error'
  | 'udp-associate-refused'
  | 'stun-timeout'
  | 'geo-unavailable'
  | 'network-unreachable';

export interface ProxyHealthResult {
  proxyId: string;
  status: 'healthy' | 'unhealthy' | 'dead';
  latencyMs: number | null;
  exitIp: string | null;
  geo: {
    country: string | null;
    city?: string | null;
    timezone?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  udpCapable: boolean | null;
  reasonCode: HealthReasonCode;
  checkedAt: number;
}

export interface ProxyUsageRecord {
  id: string;
  profileId: string;
  proxyId: string;
  usedAt: number;
  resolvedCountry: string | null;
}

export interface ProxyUsageResponse {
  profileId: string;
  history: ProxyUsageRecord[];
  driftWarning: string | null;
}

// In-memory health cache keyed by proxyId
const healthCache = new Map<string, ProxyHealthResult>();

/** Clear the health cache (useful for testing) */
export function clearHealthCache(): void {
  healthCache.clear();
}

/** Get cached health for a proxy */
export function getCachedHealth(proxyId: string): ProxyHealthResult | undefined {
  return healthCache.get(proxyId);
}

/** Store health result into cache */
export function setCachedHealth(result: ProxyHealthResult): void {
  healthCache.set(result.proxyId, result);
}

/** Classify error into HealthReasonCode */
export function classifyError(err: unknown): HealthReasonCode {
  if (!err) return 'network-unreachable';
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = (err as { code?: string })?.code?.toLowerCase?.() || '';

  if (
    msg.includes('407') ||
    msg.includes('proxy authentication required') ||
    msg.includes('authentication failure') ||
    msg.includes('all configured authentication methods failed') ||
    msg.includes('auth failed') ||
    msg.includes('unauthorized') ||
    code === 'econnrefused_auth'
  ) {
    return 'auth-failed';
  }

  if (
    msg.includes('udp-associate-refused') ||
    msg.includes('udp associate') ||
    msg.includes('command not supported') ||
    msg.includes('socks command not supported')
  ) {
    return 'udp-associate-refused';
  }

  if (msg.includes('stun-timeout') || msg.includes('stun timeout')) {
    return 'stun-timeout';
  }

  if (
    msg.includes('tls') ||
    msg.includes('ssl') ||
    msg.includes('certificate') ||
    msg.includes('handshake') ||
    msg.includes('cert_has_expired') ||
    code.includes('tls') ||
    code.includes('cert')
  ) {
    return 'tls-error';
  }

  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout') ||
    msg.includes('esockettimedout') ||
    code === 'etimedout' ||
    code === 'esockettimedout'
  ) {
    return 'connect-timeout';
  }

  if (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach') ||
    msg.includes('enetunreach') ||
    msg.includes('network unreachable')
  ) {
    return 'network-unreachable';
  }

  if (msg.includes('geo-unavailable') || msg.includes('geo unavailable') || msg.includes('ip-api')) {
    return 'geo-unavailable';
  }

  return 'network-unreachable';
}

/** Check UDP capability via dynamic import with try/catch fallback */
export async function checkUdpCapability(proxy: ProxyRow): Promise<boolean | null> {
  try {
    // Sibling slice udp-socks5-quic-relay may or may not be merged yet.
    // Dynamic import is explicitly required to allow optional decoupling.
    const udpModulePath = './udpRelay';
    const udpModule = (await import(udpModulePath)) as {
      probeUdpSupport?: (p: ProxyRow) => Promise<{ supported?: boolean } | boolean>;
    };
    if (typeof udpModule.probeUdpSupport === 'function') {
      const res = await udpModule.probeUdpSupport(proxy);
      if (typeof res === 'object' && res !== null && 'supported' in res) {
        return Boolean(res.supported);
      }
      return Boolean(res);
    }
  } catch {
    // Fallback when module or probe fails / does not exist
  }
  return null;
}

/** Check a single proxy health */
export async function checkSingleProxyHealth(
  proxy: ProxyRow,
  options?: { timeoutMs?: number; checkUrl?: string }
): Promise<ProxyHealthResult> {
  const started = Date.now();
  const timeoutMs = options?.timeoutMs ?? 10000;
  const checkUrl = options?.checkUrl ?? 'http://ip-api.com/json?fields=status,message,country,city,timezone,lat,lon,query';

  let tunnel: SshTunnel | undefined;

  try {
    let agent: Agent | undefined;

    if (proxy.type === 'ssh') {
      tunnel = await createSshTunnel({
        host: proxy.host,
        port: proxy.port,
        username: proxy.username ?? undefined,
        password: revealSecret(proxy.password),
        privateKey: revealSecret(proxy.private_key),
      });
      agent = new SocksProxyAgent(`socks5://127.0.0.1:${tunnel.port}`) as unknown as Agent;
    } else if (proxy.type === 'socks5') {
      const password = revealSecret(proxy.password) ?? '';
      const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(password)}@` : '';
      agent = new SocksProxyAgent(`socks5://${auth}${proxy.host}:${proxy.port}`) as unknown as Agent;
    } else {
      // http / https
      const password = revealSecret(proxy.password) ?? '';
      const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(password)}@` : '';
      agent = new HttpProxyAgent(`http://${auth}${proxy.host}:${proxy.port}`) as unknown as Agent;
    }

    const res = await fetch(checkUrl, {
      agent,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const elapsed = Date.now() - started;

    if (!res.ok) {
      if (res.status === 407) {
        throw new Error('auth-failed');
      }
      throw new Error(`HTTP status ${res.status}`);
    }

    const body = (await res.json()) as {
      status?: string;
      message?: string;
      country?: string;
      city?: string;
      timezone?: string;
      lat?: number;
      lon?: number;
      query?: string;
      ip?: string;
    };

    if (body.status === 'fail' || (!body.query && !body.ip && !body.country)) {
      const result: ProxyHealthResult = {
        proxyId: proxy.id,
        status: 'unhealthy',
        latencyMs: elapsed,
        exitIp: null,
        geo: null,
        udpCapable: await checkUdpCapability(proxy),
        reasonCode: 'geo-unavailable',
        checkedAt: Date.now(),
      };
      setCachedHealth(result);
      return result;
    }

    const udpCapable = await checkUdpCapability(proxy);

    const result: ProxyHealthResult = {
      proxyId: proxy.id,
      status: 'healthy',
      latencyMs: elapsed,
      exitIp: body.query || body.ip || null,
      geo: {
        country: body.country || null,
        city: body.city || null,
        timezone: body.timezone || null,
        latitude: body.lat ?? null,
        longitude: body.lon ?? null,
      },
      udpCapable,
      reasonCode: 'ok',
      checkedAt: Date.now(),
    };

    setCachedHealth(result);
    return result;
  } catch (err: unknown) {
    const reasonCode = classifyError(err);
    const result: ProxyHealthResult = {
      proxyId: proxy.id,
      status: 'dead',
      latencyMs: null,
      exitIp: null,
      geo: null,
      udpCapable: null,
      reasonCode,
      checkedAt: Date.now(),
    };
    setCachedHealth(result);
    return result;
  } finally {
    if (tunnel) {
      try {
        await tunnel.close();
      } catch {
        // ignore
      }
    }
  }
}

/** Run check on multiple proxies with bounded concurrency (default 100) */
export async function checkProxiesBulk(
  proxies: ProxyRow[],
  options?: {
    concurrency?: number;
    timeoutMs?: number;
    checkUrl?: string;
    onProgress?: (completed: number, total: number, latest: ProxyHealthResult) => void;
  }
): Promise<ProxyHealthResult[]> {
  const limit = Math.max(1, options?.concurrency ?? 100);
  const results: ProxyHealthResult[] = new Array(proxies.length);
  let currentIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = currentIndex++;
      if (idx >= proxies.length) break;
      const proxy = proxies[idx];
      const res = await checkSingleProxyHealth(proxy, options);
      results[idx] = res;
      completedCount++;
      if (options?.onProgress) {
        options.onProgress(completedCount, proxies.length, res);
      }
    }
  }

  const workerCount = Math.min(limit, proxies.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}

/** Record proxy usage when a profile starts */
export function recordProxyUsage(
  profileId: string,
  proxyId: string,
  resolvedCountry?: string | null,
  customUsedAt?: number
): ProxyUsageRecord {
  const db = getDb();
  const id = `pu_${randomUUID()}`;
  const usedAt = customUsedAt !== undefined ? customUsedAt : Date.now();
  const country = resolvedCountry || null;
  db.prepare(
    `INSERT INTO proxy_usage (id, profile_id, proxy_id, used_at, resolved_country)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, profileId, proxyId, usedAt, country);

  return {
    id,
    profileId,
    proxyId,
    usedAt,
    resolvedCountry: country,
  };
}

/** Retrieve proxy usage history for a profile and check for country drift */
export function getProfileProxyUsage(profileId: string): ProxyUsageResponse {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, profile_id, proxy_id, used_at, resolved_country
       FROM proxy_usage
       WHERE profile_id = ?
       ORDER BY used_at DESC`
    )
    .all(profileId) as Array<{
    id: string;
    profile_id: string;
    proxy_id: string;
    used_at: number;
    resolved_country: string | null;
  }>;

  const history: ProxyUsageRecord[] = rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    proxyId: r.proxy_id,
    usedAt: r.used_at,
    resolvedCountry: r.resolved_country,
  }));

  // Detect country drift between the most recent usage and the previous usage
  let driftWarning: string | null = null;
  if (history.length >= 2) {
    const current = history[0];
    // Find the immediately preceding record that had a resolved country
    const previous = history.slice(1).find((r) => Boolean(r.resolvedCountry));
    if (
      current.resolvedCountry &&
      previous?.resolvedCountry &&
      current.resolvedCountry !== previous.resolvedCountry
    ) {
      driftWarning = `country-drift: ${previous.resolvedCountry} -> ${current.resolvedCountry}`;
    }
  }

  return {
    profileId,
    history,
    driftWarning,
  };
}

/**
 * Detect if attaching candidateProxy to profileId would cause country drift.
 * Expose to preflight service or profile start flow.
 */
export function checkCandidateProxyDrift(
  profileId: string,
  candidateCountry?: string | null
): { hasDrift: boolean; warning: string | null; previousCountry: string | null; candidateCountry: string | null } {
  if (!candidateCountry) {
    return { hasDrift: false, warning: null, previousCountry: null, candidateCountry: null };
  }
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT resolved_country
       FROM proxy_usage
       WHERE profile_id = ? AND resolved_country IS NOT NULL AND resolved_country != ''
       ORDER BY used_at DESC
       LIMIT 1`
    )
    .all(profileId) as Array<{ resolved_country: string }>;

  const previousCountry = rows[0]?.resolved_country || null;
  if (previousCountry && previousCountry !== candidateCountry) {
    return {
      hasDrift: true,
      warning: `country-drift: ${previousCountry} -> ${candidateCountry}`,
      previousCountry,
      candidateCountry,
    };
  }

  return {
    hasDrift: false,
    warning: null,
    previousCountry,
    candidateCountry,
  };
}
