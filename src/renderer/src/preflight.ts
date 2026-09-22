import React from 'react';

export type PreflightStatus = 'pass' | 'warn' | 'fail';

/**
 * One diagnostic check, exactly as the backend serialises it.
 *
 * `reasonCode` and `detail` are the wire field names (`CheckVerdict` in
 * `src/main/preflight/types.ts`). They were declared here as `reason` and `message`, which do not
 * exist on the response — so the remediation lookup and the per-check summary both read
 * `undefined`, and the modal silently showed neither.
 */
export interface PreflightCheckVerdict {
  name: string;
  status: PreflightStatus;
  reasonCode?: string;
  detail: string;
  durationMs?: number;
}

/**
 * The preflight verdict as it actually arrives over HTTP.
 *
 * `checks` is an OBJECT keyed by check name and `checkList` is the same data as an array. This
 * type used to declare `checks` as an array, and the modal called `verdict.checks.map(...)` — a
 * TypeError on the first render, which unmounted the whole React tree (there is no error boundary)
 * and left the operator with a blank window: «точечный preflight чек не работает». The contract is
 * pinned by the backend's own tests (`tests/unit/preflight/preflightRoutes.test.ts` builds
 * `checks: {}` + `checkList: []`), so the array view lives in `checkList` — never in `checks`.
 */
export interface PreflightVerdict {
  profileId: string;
  overall: PreflightStatus;
  passed?: boolean;
  checks: Record<string, PreflightCheckVerdict>;
  checkList: PreflightCheckVerdict[];
  timestamp: number;
}

/**
 * The checks as an array, which is the only shape callers can iterate.
 *
 * `checkList` is authoritative because the backend builds it from the same map it serialises as
 * `checks`, and it carries each check's `name`. `Object.values` is the fallback for a verdict that
 * only has the map. Both consumers (`PreflightModal`, `Diagnostics`) go through here so the
 * object-vs-array mistake cannot be made a third time.
 */
export function checksOf(verdict: PreflightVerdict): PreflightCheckVerdict[] {
  if (Array.isArray(verdict.checkList) && verdict.checkList.length > 0) return verdict.checkList;
  // The map's KEY is the check name; the value carries no `name` of its own, so it must be
  // applied after the spread rather than before it.
  return Object.entries(verdict.checks ?? {}).map(([name, check]) => ({ ...check, name }));
}

export const PREFLIGHT_REASON_REMEDIATION: Record<string, { summary: string; hint: string }> = {
  'proxy-not-found': {
    summary: 'Configured proxy record not found',
    hint: 'The proxy assigned to this profile was deleted or does not exist. Reassign a proxy or set profile to direct connection.',
  },
  'proxy-unreachable': {
    summary: 'Proxy endpoint is unreachable or connection failed',
    hint: 'Verify proxy credentials, host, port, server health, and firewall access.',
  },
  'geo-mismatch': {
    summary: 'Detected egress country does not match expected proxy country',
    hint: 'Check proxy server stability or upstream IP rotation settings.',
  },
  'geo-lookup-failed': {
    summary: 'Could not determine egress geo location',
    hint: 'Verify proxy connectivity and upstream IP lookup service availability.',
  },
  'tz-proxy-mismatch': {
    summary: 'Timezone does not match proxy location',
    hint: 'Update profile timezone in settings or configure auto-match to proxy location.',
  },
  'lang-mismatch': {
    summary: 'Language does not match proxy country',
    hint: 'Adjust browser Accept-Language and profile locale to match proxy origin.',
  },
  'webrtc-leak-risk': {
    summary: 'WebRTC routing may bypass proxy or leak local IP',
    hint: 'Proxy type cannot route UDP. Set WebRTC mode to disabled or use a SOCKS5 proxy.',
  },
  'dns-leak-risk': {
    summary: 'DNS queries may leak outside the proxy tunnel',
    hint: 'HTTP proxies do not tunnel raw DNS queries. Use SOCKS5 or configure DNS-over-HTTPS.',
  },
  'relay-unavailable': {
    summary: 'UDP/QUIC relay unavailable for proxy profile',
    hint: 'Browser will fall back to TCP/HTTP/2. Configure UDP relay or SOCKS5 with UDP associate for QUIC support.',
  },
  'coherence-fail': {
    summary: 'Critical fingerprint hardware incoherence detected',
    hint: 'Fingerprint hardware parameters (GPU, platform, architecture) conflict with catalog rules. Regenerate fingerprint.',
  },
  'coherence-warn': {
    summary: 'Fingerprint configuration has minor coherence warnings',
    hint: 'Review fingerprint settings or regenerate fingerprint to match standard browser families.',
  },
};

export function getRemediation(reason?: string, fallbackMessage?: string): { summary: string; hint: string } {
  if (reason && PREFLIGHT_REASON_REMEDIATION[reason]) {
    return PREFLIGHT_REASON_REMEDIATION[reason];
  }
  return {
    summary: fallbackMessage || reason || 'Check did not pass validation',
    hint: 'Review profile settings, proxy routing, and fingerprint parameters.',
  };
}
