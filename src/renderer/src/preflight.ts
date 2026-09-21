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
  'tz-proxy-mismatch': {
    summary: 'Timezone does not match proxy location',
    hint: 'Update profile timezone in settings or configure auto-match to proxy location.',
  },
  'geo-lang-mismatch': {
    summary: 'Language does not match proxy country',
    hint: 'Adjust browser Accept-Language and profile locale to match proxy origin.',
  },
  'ip-mismatch': {
    summary: 'Detected IP does not match expected proxy IP',
    hint: 'Check proxy server stability or upstream IP rotation settings.',
  },
  'dns-leak-detected': {
    summary: 'DNS requests are leaking outside the proxy tunnel',
    hint: 'Enable remote DNS resolution or use a secure proxy protocol (SOCKS5/SSH).',
  },
  'webrtc-leak-detected': {
    summary: 'WebRTC is exposing your real local or public IP',
    hint: 'Set WebRTC mode to disabled, proxy-only, or fake public IP.',
  },
  'proxy-offline': {
    summary: 'Proxy endpoint is unreachable or timing out',
    hint: 'Verify proxy credentials, port, server health, and firewall access.',
  },
  'proxy-slow': {
    summary: 'Proxy latency exceeds acceptable threshold',
    hint: 'Switch to a faster proxy node or closer geographical location.',
  },
  'udp-disabled': {
    summary: 'UDP traffic is not supported by proxy',
    hint: 'Enable UDP relay or use SOCKS5 with UDP associate for WebRTC/QUIC support.',
  },
  'ssl-handshake-failed': {
    summary: 'SSL/TLS handshake with proxy or gateway failed',
    hint: 'Inspect custom certificates or certificate authorities configured for proxy.',
  },
  'header-signature-mismatch': {
    summary: 'HTTP client headers do not match fingerprint expectations',
    hint: 'Regenerate user-agent headers and fingerprint preset.',
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
