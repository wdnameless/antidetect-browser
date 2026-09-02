import { getDb } from '../db';
import * as pm from '../profiles/profileManager';
import * as proxyManager from '../proxy/proxyManager';
import {
  CheckVerdict,
  PreflightVerdict,
  PreflightStatus,
  PreflightCheckResult,
  PREFLIGHT_REASON,
  CheckName,
  ProfileResolvedData,
} from './types';
import { storeVerdict } from './store';

interface ResolvedProxyInfo {
  id?: string;
  type: 'socks5' | 'http' | 'ssh';
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
  timezone?: string;
}

export function resolveProfileData(profileId: string): ProfileResolvedData | null {
  const profile = pm.getProfile(profileId);
  if (!profile) return null;

  const db = getDb();
  let proxy: ResolvedProxyInfo | undefined;
  if (profile.proxy_id) {
    const px = db.prepare('SELECT * FROM proxies WHERE id = ?').get(profile.proxy_id) as
      | proxyManager.ProxyRow
      | undefined;
    if (px) {
      proxy = {
        id: px.id,
        type: px.type as 'socks5' | 'http' | 'ssh',
        host: px.host,
        port: px.port,
        username: px.username ?? undefined,
        password: px.password ?? undefined,
        country: px.country ?? undefined,
        timezone: px.timezone ?? undefined,
      };
    }
  }

  let language: string | undefined;
  if (profile.fingerprint_id) {
    const fp = db
      .prepare('SELECT config_json FROM fingerprints WHERE id = ?')
      .get(profile.fingerprint_id) as { config_json: string } | undefined;
    if (fp) {
      try {
        const cfg = JSON.parse(fp.config_json || '{}') as Record<string, unknown>;
        if (typeof cfg.language === 'string') {
          language = cfg.language;
        } else if (Array.isArray(cfg.languages) && typeof cfg.languages[0] === 'string') {
          language = cfg.languages[0];
        }
      } catch {
        // ignore parse error
      }
    }
  }

  return {
    id: profile.id,
    name: profile.name,
    proxy_id: profile.proxy_id,
    timezone: profile.timezone,
    language,
    browser_type: profile.browser_type ?? undefined,
    proxy,
  };
}

export async function checkProxyAlive(proxy?: ResolvedProxyInfo): Promise<CheckVerdict> {
  if (!proxy) {
    return {
      status: 'pass',
      reasonCode: PREFLIGHT_REASON.DIRECT_NO_PROXY,
      detail: 'Profile runs directly without proxy',
    };
  }

  try {
    const checkRow: proxyManager.ProxyRow = {
      id: proxy.id || 'tmp-check',
      type: proxy.type,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username ?? null,
      password: proxy.password ?? null,
      private_key: null,
      country: proxy.country ?? null,
      timezone: proxy.timezone ?? null,
      latitude: null,
      longitude: null,
      status: 'active',
      created_at: Date.now(),
    };
    const result = await proxyManager.checkProxy(checkRow);
    if (result.ok) {
      return {
        status: 'pass',
        reasonCode: PREFLIGHT_REASON.OK,
        detail: `Proxy responded with latency ${result.latencyMs ?? 0}ms (egress: ${result.ip ?? 'unknown'})`,
      };
    }
    return {
      status: 'fail',
      reasonCode: PREFLIGHT_REASON.PROXY_UNREACHABLE,
      detail: result.error || 'Proxy connection test failed',
    };
  } catch (err: unknown) {
    return {
      status: 'fail',
      reasonCode: PREFLIGHT_REASON.PROXY_UNREACHABLE,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkEgressIpGeo(proxy?: ResolvedProxyInfo): Promise<CheckVerdict> {
  if (!proxy) {
    return {
      status: 'pass',
      reasonCode: PREFLIGHT_REASON.DIRECT_NO_PROXY,
      detail: 'No proxy configured; host egress IP used',
    };
  }

  try {
    const checkRow: proxyManager.ProxyRow = {
      id: proxy.id || 'tmp-geo',
      type: proxy.type,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username ?? null,
      password: proxy.password ?? null,
      private_key: null,
      country: proxy.country ?? null,
      timezone: proxy.timezone ?? null,
      latitude: null,
      longitude: null,
      status: 'active',
      created_at: Date.now(),
    };
    const result = await proxyManager.checkProxy(checkRow);
    if (!result.ok) {
      return {
        status: 'warn',
        reasonCode: PREFLIGHT_REASON.GEO_LOOKUP_FAILED,
        detail: `Could not determine egress geo: ${result.error || 'unknown error'}`,
      };
    }

    if (proxy.country && result.country) {
      const declared = proxy.country.trim().toUpperCase();
      const detected = result.country.trim().toUpperCase();
      if (declared !== detected) {
        return {
          status: 'warn',
          reasonCode: PREFLIGHT_REASON.EGRESS_GEO_MISMATCH,
          detail: `Expected proxy country '${declared}' but detected '${detected}'`,
        };
      }
    }

    return {
      status: 'pass',
      reasonCode: PREFLIGHT_REASON.OK,
      detail: `Egress country '${result.country || 'unknown'}' matches proxy expectation`,
    };
  } catch (err: unknown) {
    return {
      status: 'warn',
      reasonCode: PREFLIGHT_REASON.GEO_LOOKUP_FAILED,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkTimezoneMatch(
  profileTimezone: string | null | undefined,
  proxy?: ResolvedProxyInfo
): Promise<CheckVerdict> {
  if (!proxy) {
    return {
      status: 'pass',
      reasonCode: 'tz-not-configured',
      detail: 'Direct connection; timezone check passed',
    };
  }

  const proxyTz = proxy.timezone;
  if (!proxyTz) {
    return {
      status: 'pass',
      reasonCode: 'tz-not-configured',
      detail: 'Proxy has no declared timezone to compare against profile',
    };
  }

  if (!profileTimezone) {
    return {
      status: 'warn',
      reasonCode: PREFLIGHT_REASON.TZ_PROXY_MISMATCH,
      detail: `Proxy timezone is '${proxyTz}' but profile timezone is automatic/unassigned`,
    };
  }

  const normalizeTz = (tz: string) => tz.trim().toLowerCase().replace(/_/g, ' ');
  if (normalizeTz(profileTimezone) !== normalizeTz(proxyTz)) {
    return {
      status: 'warn',
      reasonCode: PREFLIGHT_REASON.TZ_PROXY_MISMATCH,
      detail: `Profile timezone '${profileTimezone}' differs from proxy timezone '${proxyTz}'`,
    };
  }

  return {
    status: 'pass',
    reasonCode: 'tz-match',
    detail: `Timezone '${profileTimezone}' matches proxy timezone`,
  };
}

export function checkLanguageMatch(
  profileLanguage: string | null | undefined,
  proxyCountry: string | null | undefined
): CheckVerdict {
  if (!proxyCountry || !profileLanguage) {
    return {
      status: 'pass',
      reasonCode: 'lang-not-configured',
      detail: 'No proxy country or profile language configured to compare',
    };
  }

  const c = proxyCountry.trim().toUpperCase();
  const lang = profileLanguage.trim().toLowerCase().split(/[-_]/)[0];

  const countryToLangMap: Record<string, string[]> = {
    US: ['en'],
    GB: ['en'],
    CA: ['en', 'fr'],
    AU: ['en'],
    DE: ['de'],
    FR: ['fr'],
    ES: ['es'],
    IT: ['it'],
    RU: ['ru'],
    UA: ['uk', 'ru'],
    BY: ['be', 'ru'],
    KZ: ['kk', 'ru'],
    CN: ['zh'],
    JP: ['ja'],
    KR: ['ko'],
    BR: ['pt'],
    PT: ['pt'],
  };

  const expectedLangs = countryToLangMap[c];
  if (expectedLangs && !expectedLangs.includes(lang)) {
    return {
      status: 'warn',
      reasonCode: PREFLIGHT_REASON.LANGUAGE_COUNTRY_MISMATCH,
      detail: `Profile language '${profileLanguage}' does not correspond typically to proxy country '${c}'`,
    };
  }

  return {
    status: 'pass',
    reasonCode: 'lang-match',
    detail: `Profile language matches proxy region '${c}'`,
  };
}

export function checkWebrtcHygiene(
  proxy?: ResolvedProxyInfo,
  _browserType?: string | null
): CheckVerdict {
  if (proxy && (proxy.type === 'http' || proxy.type === 'ssh')) {
    return {
      status: 'warn',
      reasonCode: PREFLIGHT_REASON.WEBRTC_LEAK_RISK,
      detail: `Proxy type '${proxy.type}' cannot route UDP; WebRTC traffic may bypass proxy or leak local IP without strict disabling`,
    };
  }

  return {
    status: 'pass',
    reasonCode: 'webrtc-clean',
    detail: 'WebRTC routing policy coherent with proxy transport',
  };
}

export async function checkDnsEgress(proxy?: ResolvedProxyInfo): Promise<CheckVerdict> {
  if (!proxy) {
    return {
      status: 'pass',
      reasonCode: 'dns-direct',
      detail: 'Direct connection; standard system DNS egress used',
    };
  }

  if (proxy.type === 'http') {
    return {
      status: 'warn',
      reasonCode: PREFLIGHT_REASON.DNS_LEAK_RISK,
      detail: 'HTTP proxies do not tunnel raw DNS queries; remote DNS requires CONNECT or DNS-over-HTTPS fallback',
    };
  }

  return {
    status: 'pass',
    reasonCode: 'dns-ok',
    detail: 'Proxy protocol tunnels remote DNS lookups safely',
  };
}

export async function checkQuicRelayState(
  profileId: string,
  proxy?: ResolvedProxyInfo
): Promise<CheckVerdict> {
  if (!proxy) {
    return {
      status: 'pass',
      reasonCode: 'relay-disabled',
      detail: 'No proxy; HTTP/3 QUIC can operate directly over host network',
    };
  }

  try {
    const mod = await import('../proxy/udpRelay' as string);
    if (typeof mod.getUdpRelayState === 'function') {
      const state = mod.getUdpRelayState(profileId);
      if (state && state.active) {
        return {
          status: 'pass',
          reasonCode: PREFLIGHT_REASON.RELAY_READY,
          detail: 'UDP relay active; QUIC/HTTP/3 supported over SOCKS5 relay',
        };
      }
    }
  } catch {
    // Sibling slice not merged or module not present
  }

  return {
    status: 'warn',
    reasonCode: PREFLIGHT_REASON.RELAY_UNAVAILABLE,
    detail: 'UDP/QUIC relay unavailable for proxy profile; browser will fall back to TCP/HTTP/2',
  };
}

export function calculateOverallVerdict(checks: PreflightCheckResult): PreflightStatus {
  const checkValues = Object.values(checks) as CheckVerdict[];
  const statuses = checkValues.map((c) => c.status);
  if (statuses.includes('fail')) {
    return 'fail';
  }
  if (statuses.includes('warn')) {
    return 'warn';
  }
  return 'pass';
}

export async function runPreflight(profileId: string): Promise<PreflightVerdict> {
  const data = resolveProfileData(profileId);
  const proxy = data?.proxy;

  const [
    proxyAlive,
    egressGeo,
    timezoneMatch,
    quicRelay,
  ] = await Promise.all([
    checkProxyAlive(proxy),
    checkEgressIpGeo(proxy),
    checkTimezoneMatch(data?.timezone, proxy),
    checkQuicRelayState(profileId, proxy),
  ]);

  const languageMatch = checkLanguageMatch(data?.language, proxy?.country);
  const webrtcHygiene = checkWebrtcHygiene(proxy, data?.browser_type);
  const dnsEgress = await checkDnsEgress(proxy);

  const checks: PreflightCheckResult = {
    'proxy-alive': proxyAlive,
    'egress-ip-geo': egressGeo,
    'timezone-match': timezoneMatch,
    'language-match': languageMatch,
    'webrtc-hygiene': webrtcHygiene,
    'dns-egress': dnsEgress,
    'quic-relay-state': quicRelay,
  };

  const overall = calculateOverallVerdict(checks);
  const checkList: Array<CheckVerdict & { name: CheckName }> = (Object.keys(checks) as CheckName[]).map(
    (name) => ({
      name,
      ...checks[name],
    })
  );

  const verdict: PreflightVerdict = {
    profileId,
    timestamp: Date.now(),
    overall,
    passed: overall === 'pass' || overall === 'warn',
    checks,
    checkList,
  };

  storeVerdict(verdict);
  return verdict;
}

export async function blockOnFailLaunchGuard(
  profileId: string,
  blockOnFail?: boolean
): Promise<{ allowed: boolean; verdict?: PreflightVerdict }> {
  if (!blockOnFail) {
    return { allowed: true };
  }

  const verdict = await runPreflight(profileId);
  if (verdict.overall === 'fail') {
    return { allowed: false, verdict };
  }

  return { allowed: true, verdict };
}
