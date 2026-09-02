import React from 'react';

export type PreflightStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheckVerdict {
  name: string;
  status: PreflightStatus;
  durationMs: number;
  reason?: string;
  message?: string;
}

export interface PreflightVerdict {
  profileId: string;
  overall: PreflightStatus;
  checks: PreflightCheckVerdict[];
  timestamp: number;
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
