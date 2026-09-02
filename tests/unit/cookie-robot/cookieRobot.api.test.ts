import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import cookieRobotRoutes from '../../../src/main/api/routes/cookieRobot';
import {
  saveReport,
  CookieRobotReport,
} from '../../../src/main/scripts/modules/cookieRobot';
import { initDb, closeDb } from '../../../src/main/db';

function requestHelper(server: http.Server, options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; body: any; text: string }> {
  const addr = server.address() as any;
  const port = addr.port;

  return new Promise((resolve, reject) => {
    const postData = options.body ? JSON.stringify(options.body) : undefined;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: options.path,
      method: options.method,
      headers: {
        ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...options.headers,
      },
    }, (res) => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode || 0, body: json, text });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

describe('Cookie Robot API Routes', () => {
  let app: express.Express;
  let server: http.Server;

  beforeEach(async () => {
    await initDb(':memory:');
    app = express();
    app.use(express.json());
    app.use(cookieRobotRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  describe('POST /api/cookie-robot/start', () => {
    it('returns 400 when profileId or urls is missing', async () => {
      const res1 = await requestHelper(server, { method: 'POST', path: '/api/cookie-robot/start', body: {} });
      expect(res1.status).toBe(400);
      expect(res1.body.code).toBe(-1);

      const res2 = await requestHelper(server, { method: 'POST', path: '/api/cookie-robot/start', body: { profileId: 'p1' } });
      expect(res2.status).toBe(400);

      const res3 = await requestHelper(server, { method: 'POST', path: '/api/cookie-robot/start', body: { urls: ['https://example.com'] } });
      expect(res3.status).toBe(400);
    });

    it('starts cookie robot run and returns runId', async () => {
      const res = await requestHelper(server, {
        method: 'POST',
        path: '/api/cookie-robot/start',
        body: {
          profileId: 'prof_test_api',
          urls: ['https://example.com'],
          maxPages: 2,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.profileId).toBe('prof_test_api');
      expect(res.body.data.runId).toBeDefined();
    });
  });

  describe('POST /api/cookie-robot/stop and /abort', () => {
    it('aborts active run by profileId or runId', async () => {
      const startRes = await requestHelper(server, {
        method: 'POST',
        path: '/api/cookie-robot/start',
        body: {
          profileId: 'prof_to_abort',
          urls: ['https://example.com/long'],
          dwellMsMin: 5000,
          dwellMsMax: 10000,
        },
      });

      const runId = startRes.body.data.runId;

      const stopRes = await requestHelper(server, {
        method: 'POST',
        path: '/api/cookie-robot/stop',
        body: { runId },
      });

      expect(stopRes.status).toBe(200);
      expect(stopRes.body.code).toBe(0);
      expect(stopRes.body.data.stopped).toBe(true);
    });

    it('returns false/404-safe response when stopping non-existent run', async () => {
      const stopRes = await requestHelper(server, {
        method: 'POST',
        path: '/api/cookie-robot/stop',
        body: { runId: 'non-existent-run' },
      });

      expect(stopRes.status).toBe(200);
      expect(stopRes.body.data.stopped).toBe(false);
    });
  });

  describe('GET /api/cookie-robot/reports', () => {
    it('returns empty list or reports', async () => {
      const res = await requestHelper(server, { method: 'GET', path: '/api/cookie-robot/reports' });
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('filters reports by profileId', async () => {
      const mockReport: CookieRobotReport = {
        id: 'rep_api_test_1',
        profileId: 'profile_specific',
        status: 'completed',
        pagesVisited: 3,
        cookiesSet: 5,
        domainsTouched: ['example.com'],
        durationMs: 1200,
        errors: [],
        startedAt: 1000,
        finishedAt: 2200,
      };
      saveReport(mockReport);

      const res = await requestHelper(server, { method: 'GET', path: '/api/cookie-robot/reports?profileId=profile_specific' });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].profileId).toBe('profile_specific');
    });
  });

  describe('GET /api/cookie-robot/reports/:id', () => {
    it('returns 404 when report not found', async () => {
      const res = await requestHelper(server, { method: 'GET', path: '/api/cookie-robot/reports/does_not_exist_xyz' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(-1);
    });

    it('returns report when found', async () => {
      const mockReport: CookieRobotReport = {
        id: 'rep_single_get',
        profileId: 'prof_single',
        status: 'completed',
        pagesVisited: 1,
        cookiesSet: 2,
        domainsTouched: ['single.org'],
        durationMs: 500,
        errors: [],
        startedAt: 1000,
        finishedAt: 1500,
      };
      saveReport(mockReport);

      const res = await requestHelper(server, { method: 'GET', path: '/api/cookie-robot/reports/rep_single_get' });
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toBe('rep_single_get');
      expect(res.body.data.profileId).toBe('prof_single');
    });
  });

  describe('POST /api/cookie-robot/schedule', () => {
    it('rejects when missing required fields', async () => {
      const res = await requestHelper(server, { method: 'POST', path: '/api/cookie-robot/schedule', body: {} });
      expect(res.status).toBe(400);
    });

    it('creates task group for cookie robot', async () => {
      const res = await requestHelper(server, {
        method: 'POST',
        path: '/api/cookie-robot/schedule',
        body: {
          name: 'Warmup Morning Group',
          profileIds: ['p1', 'p2', 'p3'],
          urls: ['https://alpha.com', 'https://beta.com'],
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.taskGroup).toBeDefined();
      expect(res.body.data.taskGroup.profile_ids).toEqual(['p1', 'p2', 'p3']);
    });
  });
});
