export type CheckStatus = 'pass' | 'warn' | 'fail';

export type CheckName =
  | 'proxy-alive'
  | 'egress-ip-geo'
  | 'timezone-match'
  | 'language-match'
  | 'webrtc-hygiene'
  | 'dns-egress'
  | 'quic-relay-state';

export type PreflightReasonCode =
  // Timezone
  | 'tz-proxy-mismatch'
  | 'tz-match'
  | 'tz-not-configured'
  | 'tz-undetermined'
  // Proxy
  | 'proxy-ok'
  | 'proxy-not-configured'
  | 'proxy-unreachable'
  | 'proxy-auth-failed'
  | 'proxy-timeout'
  | 'proxy-error'
  // Geo / Egress
  | 'geo-match'
  | 'geo-mismatch'
  | 'geo-lookup-failed'
  | 'geo-not-configured'
  | 'geo-ok'
  // Language
  | 'lang-match'
  | 'lang-mismatch'
  | 'lang-not-configured'
  | 'lang-ok'
  // WebRTC
  | 'webrtc-clean'
  | 'webrtc-disabled'
  | 'webrtc-leak-risk'
  | 'webrtc-unprotected'
  // DNS
  | 'dns-ok'
  | 'dns-leak-risk'
  | 'dns-egress-coherent'
  | 'dns-direct'
  // QUIC / Relay
  | 'relay-ready'
  | 'relay-unavailable'
  | 'relay-degraded'
  | 'relay-disabled'
  | 'relay-error';

export const PREFLIGHT_REASON = {
  DIRECT_NO_PROXY: 'proxy-not-configured',
  PROXY_UNREACHABLE: 'proxy-unreachable',
  GEO_LOOKUP_FAILED: 'geo-lookup-failed',
  EGRESS_GEO_MISMATCH: 'geo-mismatch',
  TZ_PROXY_MISMATCH: 'tz-proxy-mismatch',
  LANGUAGE_COUNTRY_MISMATCH: 'lang-mismatch',
  WEBRTC_LEAK_RISK: 'webrtc-leak-risk',
  DNS_LEAK_RISK: 'dns-leak-risk',
  RELAY_UNAVAILABLE: 'relay-unavailable',
  RELAY_READY: 'relay-ready',
  OK: 'proxy-ok',
} as const;

export interface CheckVerdict {
  status: CheckStatus;
  reasonCode?: PreflightReasonCode | string;
  detail: string;
  durationMs?: number;
}

export type PreflightStatus = CheckStatus;

export type PreflightCheckResult = Record<CheckName, CheckVerdict>;

export interface PreflightVerdict {
  profileId: string;
  timestamp: number;
  overall: CheckStatus;
  passed: boolean;
  checks: PreflightCheckResult;
  checkList: Array<CheckVerdict & { name: CheckName }>;
}

export interface ProfileResolvedData {
  id: string;
  name: string | null;
  proxy_id: string | null;
  timezone: string | null;
  language?: string;
  browser_type?: string;
  proxy?: {
    id?: string;
    type: 'socks5' | 'http' | 'ssh';
    host: string;
    port: number;
    username?: string;
    password?: string;
    country?: string;
    timezone?: string;
  };
}

export interface PreflightOptions {
  timeoutMs?: number;
  probeProxy?: boolean;
  probeGeo?: boolean;
  probeRelay?: boolean;
}
