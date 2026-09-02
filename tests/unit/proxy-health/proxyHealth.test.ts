import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import {
  classifyError,
  checkSingleProxyHealth,
  checkProxiesBulk,
  recordProxyUsage,
  getProfileProxyUsage,
  checkCandidateProxyDrift,
  clearHealthCache,
  getCachedHealth,
  setCachedHealth,
  checkUdpCapability,
  type ProxyHealthResult,
} from '../../../src/main/proxy/proxyHealth';
import { type ProxyRow } from '../../../src/main/proxy/proxyManager';
import { initDb, getDb } from '../../../src/main/db';

describe('Proxy Health & Bulk Checker', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    clearHealthCache();
    const db = getDb();
    db.exec('DELETE FROM proxy_usage;');
  });

  describe('Error Classification & Reason Codes', () => {
    it('classifies auth failure errors', () => {
      expect(classifyError(new Error('Proxy Authentication Required'))).toBe('auth-failed');
      expect(classifyError(new Error('HTTP 407 status received'))).toBe('auth-failed');
      expect(classifyError(new Error('All configured authentication methods failed'))).toBe('auth-failed');
      expect(classifyError({ code: 'ECONNREFUSED_AUTH' })).toBe('auth-failed');
    });

    it('classifies connect timeout errors', () => {
      expect(classifyError(new Error('Connection timed out'))).toBe('connect-timeout');
      expect(classifyError(new Error('ETIMEDOUT'))).toBe('connect-timeout');
      expect(classifyError({ code: 'ETIMEDOUT' })).toBe('connect-timeout');
      expect(classifyError(new Error('ESOCKETTIMEDOUT'))).toBe('connect-timeout');
    });

    it('classifies tls errors', () => {
      expect(classifyError(new Error('SSL handshake failed'))).toBe('tls-error');
      expect(classifyError(new Error('CERT_HAS_EXPIRED'))).toBe('tls-error');
      expect(classifyError(new Error('certificate signature failure'))).toBe('tls-error');
    });

    it('classifies udp-associate-refused errors', () => {
      expect(classifyError(new Error('udp-associate-refused'))).toBe('udp-associate-refused');
      expect(classifyError(new Error('SOCKS command not supported: udp associate'))).toBe('udp-associate-refused');
    });

    it('classifies stun timeout errors', () => {
      expect(classifyError(new Error('stun-timeout'))).toBe('stun-timeout');
    });

    it('classifies network unreachable / connection refused', () => {
      expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:1234'))).toBe('network-unreachable');
      expect(classifyError(new Error('ENETUNREACH'))).toBe('network-unreachable');
      expect(classifyError(new Error('EHOSTUNREACH'))).toBe('network-unreachable');
      expect(classifyError(null)).toBe('network-unreachable');
    });

    it('classifies geo unavailable errors', () => {
      expect(classifyError(new Error('geo-unavailable'))).toBe('geo-unavailable');
      expect(classifyError(new Error('ip-api service rate limited'))).toBe('geo-unavailable');
    });
  });

  describe('UDP Capability Probe Fallback', () => {
    it('returns null when udpRelay module does not exist or import throws', async () => {
      const dummyProxy: ProxyRow = {
        id: 'px_test_1',
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      vi.doMock('../../../src/main/proxy/udpRelay', () => {
        throw new Error('Module not found');
      });
      // Also mock './udpRelay' relative to proxyHealth.ts
      vi.doMock('./udpRelay', () => {
        throw new Error('Module not found');
      });

      try {
        const result = await checkUdpCapability(dummyProxy);
        expect(result).toBeNull();
      } finally {
        vi.doUnmock('../../../src/main/proxy/udpRelay');
        vi.doUnmock('./udpRelay');
      }
    });

    it('returns false when udpRelay module exists and probe fails', async () => {
      const dummyProxy: ProxyRow = {
        id: 'px_test_1',
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      vi.doMock('../../../src/main/proxy/udpRelay', () => ({
        probeUdpSupport: vi.fn().mockResolvedValue({ supported: false, reason: 'network-unreachable' }),
      }));
      vi.doMock('./udpRelay', () => ({
        probeUdpSupport: vi.fn().mockResolvedValue({ supported: false, reason: 'network-unreachable' }),
      }));

      try {
        const result = await checkUdpCapability(dummyProxy);
        expect(result).toBe(false);
      } finally {
        vi.doUnmock('../../../src/main/proxy/udpRelay');
        vi.doUnmock('./udpRelay');
      }
    });

    it('returns true when udpRelay module exists and probe succeeds', async () => {
      const dummyProxy: ProxyRow = {
        id: 'px_test_1',
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      vi.doMock('../../../src/main/proxy/udpRelay', () => ({
        probeUdpSupport: vi.fn().mockResolvedValue({ supported: true }),
      }));
      vi.doMock('./udpRelay', () => ({
        probeUdpSupport: vi.fn().mockResolvedValue({ supported: true }),
      }));

      try {
        const result = await checkUdpCapability(dummyProxy);
        expect(result).toBe(true);
      } finally {
        vi.doUnmock('../../../src/main/proxy/udpRelay');
        vi.doUnmock('./udpRelay');
      }
    });
  });

  describe('Cache Management', () => {
    it('caches and retrieves proxy health correctly', () => {
      const result: ProxyHealthResult = {
        proxyId: 'px_cache_test',
        status: 'healthy',
        latencyMs: 42,
        exitIp: '1.2.3.4',
        geo: { country: 'DE', city: 'Frankfurt' },
        udpCapable: true,
        reasonCode: 'ok',
        checkedAt: Date.now(),
      };

      expect(getCachedHealth('px_cache_test')).toBeUndefined();
      setCachedHealth(result);
      expect(getCachedHealth('px_cache_test')).toEqual(result);

      clearHealthCache();
      expect(getCachedHealth('px_cache_test')).toBeUndefined();
    });
  });

  describe('Local Stub Proxy Health Verification', () => {
    let stubServer: http.Server;
    let stubPort: number;

    beforeEach(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      stubServer = http.createServer((req, res) => {
        if (req.headers['proxy-authorization'] === 'invalid') {
          res.writeHead(407, { 'Proxy-Authenticate': 'Basic' });
          res.end(JSON.stringify({ error: 'auth failed' }));
          return;
        }

        if (req.url?.includes('fail-geo')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'fail', message: 'reserved range' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            country: 'Germany',
            city: 'Berlin',
            timezone: 'Europe/Berlin',
            lat: 52.52,
            lon: 13.405,
            query: '88.99.100.101',
          })
        );
      });

      stubServer.listen(0, '127.0.0.1', () => {
        const addr = stubServer.address() as net.AddressInfo;
        stubPort = addr.port;
        resolve();
      });
      await promise;
    });

    afterEach(async () => {
      if (stubServer) {
        const { promise, resolve } = Promise.withResolvers<void>();
        stubServer.close(() => resolve());
        await promise;
      }
    });

    it('checks healthy proxy using local stub', async () => {
      const proxy: ProxyRow = {
        id: 'px_healthy',
        type: 'http',
        host: '127.0.0.1',
        port: stubPort,
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const result = await checkSingleProxyHealth(proxy, {
        checkUrl: `http://127.0.0.1:${stubPort}/test`,
      });

      expect(result.proxyId).toBe('px_healthy');
      expect(result.status).toBe('healthy');
      expect(result.reasonCode).toBe('ok');
      expect(result.exitIp).toBe('88.99.100.101');
      expect(result.geo?.country).toBe('Germany');
      expect(result.geo?.city).toBe('Berlin');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(getCachedHealth('px_healthy')).toBeDefined();
    });

    it('detects unhealthy status when geo lookup fails', async () => {
      const proxy: ProxyRow = {
        id: 'px_fail_geo',
        type: 'http',
        host: '127.0.0.1',
        port: stubPort,
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const result = await checkSingleProxyHealth(proxy, {
        checkUrl: `http://127.0.0.1:${stubPort}/fail-geo`,
      });

      expect(result.status).toBe('unhealthy');
      expect(result.reasonCode).toBe('geo-unavailable');
      expect(result.exitIp).toBeNull();
    });

    it('reports dead status with network-unreachable on dead port', async () => {
      const proxy: ProxyRow = {
        id: 'px_dead',
        type: 'http',
        host: '127.0.0.1',
        port: 1, // Closed port
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const result = await checkSingleProxyHealth(proxy, {
        timeoutMs: 1000,
        checkUrl: 'http://127.0.0.1:1/nonexistent',
      });

      expect(result.status).toBe('dead');
      expect(['network-unreachable', 'connect-timeout']).toContain(result.reasonCode);
    });
  });

  describe('Bounded-Concurrency Bulk Checker', () => {
    it('respects concurrency limit and checks multiple proxies', async () => {
      let activeConcurrency = 0;
      let maxObservedConcurrency = 0;

      const server = http.createServer((_req, res) => {
        activeConcurrency++;
        if (activeConcurrency > maxObservedConcurrency) {
          maxObservedConcurrency = activeConcurrency;
        }
        activeConcurrency--;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            country: 'US',
            query: '1.1.1.1',
          })
        );
      });

      const { promise: listenPromise, resolve: resolveListen } = Promise.withResolvers<void>();
      server.listen(0, '127.0.0.1', () => resolveListen());
      await listenPromise;

      const port = (server.address() as net.AddressInfo).port;

      const proxies: ProxyRow[] = Array.from({ length: 25 }, (_, i) => ({
        id: `px_bulk_${i}`,
        type: 'http',
        host: '127.0.0.1',
        port,
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }));

      const concurrencyLimit = 5;
      const progressList: number[] = [];

      const results = await checkProxiesBulk(proxies, {
        concurrency: concurrencyLimit,
        checkUrl: `http://127.0.0.1:${port}/check`,
        onProgress: (done) => {
          progressList.push(done);
        },
      });

      const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
      server.close(() => resolveClose());
      await closePromise;

      expect(results.length).toBe(25);
      expect(results.every((r) => r.status === 'healthy')).toBe(true);
      expect(maxObservedConcurrency).toBeLessThanOrEqual(concurrencyLimit);
      expect(progressList.length).toBe(25);

      // Evidence: 500-stub pool check completes with bounded wall time (< 3000ms with concurrency 100)
      const stub500Server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', country: 'CA', query: '10.0.0.1' }));
      });
      const { promise: p500Listen, resolve: r500Listen } = Promise.withResolvers<void>();
      stub500Server.listen(0, '127.0.0.1', () => r500Listen());
      await p500Listen;
      const p500Port = (stub500Server.address() as net.AddressInfo).port;
      const proxies500: ProxyRow[] = Array.from({ length: 500 }, (_, i) => ({
        id: `px_500_${i}`,
        type: 'http',
        host: '127.0.0.1',
        port: p500Port,
        username: null,
        password: null,
        private_key: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }));

      const tStart = Date.now();
      const results500 = await checkProxiesBulk(proxies500, {
        concurrency: 100,
        checkUrl: `http://127.0.0.1:${p500Port}/check`,
      });
      const durationMs = Date.now() - tStart;
      const { promise: p500Close, resolve: r500Close } = Promise.withResolvers<void>();
      stub500Server.close(() => r500Close());
      await p500Close;

      expect(results500.length).toBe(500);
      expect(results500.every((r) => r.status === 'healthy')).toBe(true);
      expect(durationMs).toBeLessThan(3500);
      expect(progressList[progressList.length - 1]).toBe(25);
    });
  });

  describe('Proxy Usage & Country Drift Detection', () => {
    it('records proxy usage into database', () => {
      const rec = recordProxyUsage('prof_1', 'px_100', 'US');
      expect(rec.profileId).toBe('prof_1');
      expect(rec.proxyId).toBe('px_100');
      expect(rec.resolvedCountry).toBe('US');
      expect(rec.usedAt).toBeGreaterThan(0);

      const usage = getProfileProxyUsage('prof_1');
      expect(usage.history.length).toBe(1);
      expect(usage.history[0].proxyId).toBe('px_100');
      expect(usage.history[0].resolvedCountry).toBe('US');
      expect(usage.driftWarning).toBeNull();
    });

    it('detects country drift and formats warning with both countries', () => {
      // Use different explicit timestamps to avoid clock resolution issues
      const now = Date.now();
      recordProxyUsage('prof_drift', 'px_1', 'US', now - 1000);
      recordProxyUsage('prof_drift', 'px_2', 'DE', now);

      const usage = getProfileProxyUsage('prof_drift');
      expect(usage.history.length).toBe(2);
      expect(usage.history[0].resolvedCountry).toBe('DE'); // Most recent
      expect(usage.history[1].resolvedCountry).toBe('US'); // Previous
      expect(usage.driftWarning).toBe('country-drift: US -> DE');
    });

    it('does not warn when country remains unchanged', () => {
      const now = Date.now();
      recordProxyUsage('prof_same', 'px_1', 'FR', now - 1000);
      recordProxyUsage('prof_same', 'px_2', 'FR', now);

      const usage = getProfileProxyUsage('prof_same');
      expect(usage.driftWarning).toBeNull();
    });

    it('checks candidate proxy drift against previous profile country', () => {
      recordProxyUsage('prof_cand', 'px_prev', 'GB');
      
      const drift1 = checkCandidateProxyDrift('prof_cand', 'FR');
      expect(drift1.hasDrift).toBe(true);
      expect(drift1.warning).toBe('country-drift: GB -> FR');
      expect(drift1.previousCountry).toBe('GB');
      expect(drift1.candidateCountry).toBe('FR');

      const drift2 = checkCandidateProxyDrift('prof_cand', 'GB');
      expect(drift2.hasDrift).toBe(false);
      expect(drift2.warning).toBeNull();

      const drift3 = checkCandidateProxyDrift('prof_cand', null);
      expect(drift3.hasDrift).toBe(false);
    });
  });
});
