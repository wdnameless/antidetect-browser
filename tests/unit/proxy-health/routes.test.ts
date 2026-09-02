import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express, { Express } from 'express';
import * as http from 'http';
import * as net from 'net';
import proxyHealthRouter from '../../../src/main/api/routes/proxyHealth';
import { initDb, getDb } from '../../../src/main/db';
import { clearHealthCache, recordProxyUsage } from '../../../src/main/proxy/proxyHealth';
import { createProxy } from '../../../src/main/proxy/proxyManager';

describe('Proxy Health API Routes', () => {
  let app: Express;
  let server: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    await initDb();
    app = express();
    app.use(express.json());
    app.use(proxyHealthRouter);

    const { promise, resolve } = Promise.withResolvers<void>();
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      serverPort = addr.port;
      resolve();
    });
    await promise;
  });

  afterAll(async () => {
    if (server) {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => resolve());
      await promise;
    }
  });

  beforeEach(() => {
    clearHealthCache();
    const db = getDb();
    db.exec('DELETE FROM proxy_usage;');
    db.exec('DELETE FROM proxies;');
  });

  function apiRequest(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<{ status: number; body: any }> {
    const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: any }>();
    const postData = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: serverPort,
        method,
        path,
        headers: postData
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            }
          : undefined,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode || 0, body: parsed });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
    return promise;
  }

  describe('GET /api/profiles/:id/proxy-usage', () => {
    it('returns empty usage when no history exists', async () => {
      const res = await apiRequest('GET', '/api/profiles/prof_empty/proxy-usage');
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.profileId).toBe('prof_empty');
      expect(res.body.data.history).toEqual([]);
      expect(res.body.data.driftWarning).toBeNull();
    });

    it('returns usage records and drift warning when country changes', async () => {
      const now = Date.now();
      recordProxyUsage('prof_test', 'px_1', 'FR', now - 1000);
      recordProxyUsage('prof_test', 'px_2', 'US', now);

      const res = await apiRequest('GET', '/api/profiles/prof_test/proxy-usage');
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.history.length).toBe(2);
      expect(res.body.data.driftWarning).toBe('country-drift: FR -> US');
    });
  });

  describe('GET /api/proxies/:id/health', () => {
    it('returns proxy not found error for non-existent proxy', async () => {
      const res = await apiRequest('GET', '/api/proxies/px_not_found/health');
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(-1);
      expect(res.body.msg).toBe('proxy not found');
    });

    it('returns health check result for existing proxy', async () => {
      const proxyId = createProxy({
        type: 'http',
        host: '127.0.0.1',
        port: 65432,
      });

      const res = await apiRequest('GET', `/api/proxies/${proxyId}/health`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.proxyId).toBe(proxyId);
      expect(res.body.data.status).toBe('dead');
      expect(['network-unreachable', 'connect-timeout']).toContain(res.body.data.reasonCode);
    });
  });

  describe('POST /api/proxies/check-all', () => {
    it('returns empty summary when no proxies exist', async () => {
      const res = await apiRequest('POST', '/api/proxies/check-all', {});

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.results).toEqual([]);
    });

    it('filters proxies by type or ids and performs check', async () => {
      createProxy({ type: 'http', host: '127.0.0.1', port: 65431 });
      const p2 = createProxy({ type: 'socks5', host: '127.0.0.1', port: 65432 });

      const res = await apiRequest('POST', '/api/proxies/check-all', {
        type: 'socks5',
        concurrency: 5,
      });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.results[0].proxyId).toBe(p2);
    });
  });
});
