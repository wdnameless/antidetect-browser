import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkProxyAlive,
  checkEgressIpGeo,
  checkTimezoneMatch,
  checkLanguageMatch,
  checkWebrtcHygiene,
  checkDnsEgress,
  checkQuicRelayState,
  calculateOverallVerdict,
  runPreflight,
  blockOnFailLaunchGuard,
} from '../../../src/main/preflight/preflightService';
import { PREFLIGHT_REASON, PreflightCheckResult } from '../../../src/main/preflight/types';
import * as proxyManager from '../../../src/main/proxy/proxyManager';
import * as pm from '../../../src/main/profiles/profileManager';

vi.mock('../../../src/main/proxy/proxyManager', () => ({
  checkProxy: vi.fn(),
}));

vi.mock('../../../src/main/profiles/profileManager', () => ({
  getProfile: vi.fn(),
}));

vi.mock('../../../src/main/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(),
    })),
  })),
}));

describe('Preflight Service Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkProxyAlive', () => {
    it('passes for direct connection without proxy', async () => {
      const res = await checkProxyAlive(undefined);
      expect(res.status).toBe('pass');
      expect(res.reasonCode).toBe(PREFLIGHT_REASON.DIRECT_NO_PROXY);
    });

    it('passes when proxy responds ok', async () => {
      vi.mocked(proxyManager.checkProxy).mockResolvedValueOnce({
        ok: true,
        ip: '1.2.3.4',
        latencyMs: 42,
      });

      const res = await checkProxyAlive({
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      });
      expect(res.status).toBe('pass');
      expect(res.detail).toContain('latency 42ms');
    });

    it('fails when proxy check fails', async () => {
      vi.mocked(proxyManager.checkProxy).mockResolvedValueOnce({
        ok: false,
        error: 'ECONNREFUSED',
      });

      const res = await checkProxyAlive({
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      });
      expect(res.status).toBe('fail');
      expect(res.reasonCode).toBe(PREFLIGHT_REASON.PROXY_UNREACHABLE);
      expect(res.detail).toBe('ECONNREFUSED');
    });
  });

  describe('checkEgressIpGeo', () => {
    it('passes for direct connection', async () => {
      const res = await checkEgressIpGeo(undefined);
      expect(res.status).toBe('pass');
      expect(res.reasonCode).toBe(PREFLIGHT_REASON.DIRECT_NO_PROXY);
    });

    it('passes when egress geo matches expected country', async () => {
      vi.mocked(proxyManager.checkProxy).mockResolvedValueOnce({
        ok: true,
        country: 'US',
      });

      const res = await checkEgressIpGeo({
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
        country: 'US',
      });
      expect(res.status).toBe('pass');
      expect(res.detail).toContain('US');
    });

    it('warns when egress country differs from proxy country', async () => {
      vi.mocked(proxyManager.checkProxy).mockResolvedValueOnce({
        ok: true,
        country: 'DE',
      });

      const res = await checkEgressIpGeo({
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
        country: 'US',
      });
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe(PREFLIGHT_REASON.EGRESS_GEO_MISMATCH);
    });

    it('warns when lookup fails', async () => {
      vi.mocked(proxyManager.checkProxy).mockResolvedValueOnce({
        ok: false,
        error: 'GeoIP timeout',
      });

      const res = await checkEgressIpGeo({
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
      });
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe(PREFLIGHT_REASON.GEO_LOOKUP_FAILED);
    });
  });

  describe('checkTimezoneMatch', () => {
    it('passes when no proxy timezone is configured', async () => {
      const res = await checkTimezoneMatch('America/New_York', undefined);
      expect(res.status).toBe('pass');
    });

    it('passes when proxy timezone matches profile timezone', async () => {
      const res = await checkTimezoneMatch('America/New_York', {
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
        timezone: 'America/New_York',
      });
      expect(res.status).toBe('pass');
    });

    it('warns on tz-proxy-mismatch when timezones conflict', async () => {
      const res = await checkTimezoneMatch('Europe/Berlin', {
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
        timezone: 'America/New_York',
      });
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe('tz-proxy-mismatch');
    });

    it('warns on tz-proxy-mismatch when profile timezone is unassigned', async () => {
      const res = await checkTimezoneMatch(null, {
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
        timezone: 'America/New_York',
      });
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe('tz-proxy-mismatch');
    });
  });

  describe('checkLanguageMatch', () => {
    it('passes when language matches typical country', () => {
      const res = checkLanguageMatch('en-US', 'US');
      expect(res.status).toBe('pass');
    });

    it('warns when language does not match country', () => {
      const res = checkLanguageMatch('ru-RU', 'US');
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe('lang-mismatch');
    });

    it('passes if no country or language is specified', () => {
      const res = checkLanguageMatch(undefined, undefined);
      expect(res.status).toBe('pass');
    });
  });

  describe('checkWebrtcHygiene', () => {
    it('passes for socks5 proxy', () => {
      const res = checkWebrtcHygiene({
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
      });
      expect(res.status).toBe('pass');
    });

    it('warns for http proxy due to leak risk', () => {
      const res = checkWebrtcHygiene({
        type: 'http',
        host: '1.2.3.4',
        port: 8080,
      });
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe('webrtc-leak-risk');
    });
  });

  describe('checkDnsEgress', () => {
    it('passes for direct connection', async () => {
      const res = await checkDnsEgress(undefined);
      expect(res.status).toBe('pass');
    });

    it('passes for socks5', async () => {
      const res = await checkDnsEgress({
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
      });
      expect(res.status).toBe('pass');
    });

    it('warns for http proxy', async () => {
      const res = await checkDnsEgress({
        type: 'http',
        host: '1.2.3.4',
        port: 8080,
      });
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe('dns-leak-risk');
    });
  });

  describe('checkQuicRelayState', () => {
    it('passes for direct connection', async () => {
      const res = await checkQuicRelayState('p1', undefined);
      expect(res.status).toBe('pass');
    });

    it('warns with relay-unavailable when sibling slice is not active', async () => {
      const res = await checkQuicRelayState('p1', {
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
      });
      expect(res.status).toBe('warn');
      expect(res.reasonCode).toBe('relay-unavailable');
    });
  });

  describe('calculateOverallVerdict', () => {
    it('returns fail if any check fails', () => {
      const checks: PreflightCheckResult = {
        'proxy-alive': { status: 'fail', detail: 'down' },
        'egress-ip-geo': { status: 'pass', detail: 'ok' },
        'timezone-match': { status: 'pass', detail: 'ok' },
        'language-match': { status: 'pass', detail: 'ok' },
        'webrtc-hygiene': { status: 'pass', detail: 'ok' },
        'dns-egress': { status: 'pass', detail: 'ok' },
        'quic-relay-state': { status: 'pass', detail: 'ok' },
      };
      expect(calculateOverallVerdict(checks)).toBe('fail');
    });

    it('returns warn if checks have warn but no fail', () => {
      const checks: PreflightCheckResult = {
        'proxy-alive': { status: 'pass', detail: 'ok' },
        'egress-ip-geo': { status: 'warn', detail: 'mismatch' },
        'timezone-match': { status: 'pass', detail: 'ok' },
        'language-match': { status: 'pass', detail: 'ok' },
        'webrtc-hygiene': { status: 'pass', detail: 'ok' },
        'dns-egress': { status: 'pass', detail: 'ok' },
        'quic-relay-state': { status: 'pass', detail: 'ok' },
      };
      expect(calculateOverallVerdict(checks)).toBe('warn');
    });

    it('returns pass if all checks pass', () => {
      const checks: PreflightCheckResult = {
        'proxy-alive': { status: 'pass', detail: 'ok' },
        'egress-ip-geo': { status: 'pass', detail: 'ok' },
        'timezone-match': { status: 'pass', detail: 'ok' },
        'language-match': { status: 'pass', detail: 'ok' },
        'webrtc-hygiene': { status: 'pass', detail: 'ok' },
        'dns-egress': { status: 'pass', detail: 'ok' },
        'quic-relay-state': { status: 'pass', detail: 'ok' },
      };
      expect(calculateOverallVerdict(checks)).toBe('pass');
    });
  });

  describe('blockOnFailLaunchGuard', () => {
    it('allows launch if blockOnFail is false', async () => {
      const res = await blockOnFailLaunchGuard('p-test', false);
      expect(res.allowed).toBe(true);
    });

    it('refuses launch if blockOnFail is true and preflight fails', async () => {
      vi.mocked(pm.getProfile).mockReturnValueOnce({
        id: 'p-fail',
        name: 'test',
        user_id: 'p-fail',
        group_id: null,
        status: 'closed',
        browser_type: 'chrome',
        platform: 'windows',
        canvas_noise: 0,
        audio_noise: 0,
        webgl_noise: 0,
        client_rects_noise: 0,
        proxy_id: 'px1',
        fingerprint_id: null,
        user_agent: null,
        screen_resolution: null,
        device_memory: null,
        hardware_concurrency: null,
        language: null,
        timezone: null,
        webrtc_mode: 'alter',
        webrtc_ip: null,
        os: 'windows',
        os_version: '11',
        kernel_version: null,
        cookie_count: 0,
        created_at: 0,
        updated_at: 0,
        deleted_at: null,
        last_opened_at: null,
        storage_usage_bytes: 0,
      } as any);

      const dbMock = {
        prepare: vi.fn((sql: string) => ({
          get: vi.fn(() => ({
            id: 'px1',
            type: 'socks5',
            host: '1.2.3.4',
            port: 1080,
          })),
        })),
      };
      const dbModule = await import('../../../src/main/db');
      vi.mocked(dbModule.getDb).mockReturnValue(dbMock as any);

      vi.mocked(proxyManager.checkProxy).mockResolvedValueOnce({
        ok: false,
        error: 'Proxy dead',
      });

      const res = await blockOnFailLaunchGuard('p-fail', true);
      expect(res.allowed).toBe(false);
      expect(res.verdict?.overall).toBe('fail');
      expect(res.verdict?.checks['proxy-alive'].status).toBe('fail');
    });
  });
});
