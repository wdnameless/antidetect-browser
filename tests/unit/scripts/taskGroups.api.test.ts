import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { initDb, closeDb } from '../../../src/main/db';
import taskGroupsRouter from '../../../src/main/api/routes/taskGroups';
import { getTaskQueueCoordinator } from '../../../src/main/scripts/taskQueue';
import { DATA_DIR, getApiKey } from '../../../src/main/config';
import { authMiddleware } from '../../../src/main/api/auth';
import { appendTaskLog, updateTaskProgress } from '../../../src/main/scripts/taskGroups';

function requestHelper(server: http.Server, options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; text: string }> {
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
        resolve({ status: res.statusCode || 0, headers: res.headers, body: json, text });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

describe('Task Groups REST API Routes', () => {
  let app: express.Express;
  let server: http.Server;
  let apiKey: string;
  beforeEach(async () => {
    await initDb(':memory:');
    apiKey = getApiKey();

    app = express();
    app.use(express.json());
    // Apply authMiddleware exactly like server.ts does for non-panel /api routes
    app.use('/api', (req, res, next) => {
      authMiddleware(req, res, next);
    });
    app.use(taskGroupsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterEach(async () => {
    const q = getTaskQueueCoordinator();
    q.destroy();
    closeDb();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('rejects unauthorized requests with 401 when no auth header or session', async () => {
    const res = await requestHelper(server, {
      method: 'GET',
      path: '/api/task-groups',
    });
    expect(res.status).toBe(401);
  });

  it('creates task group via POST /api/task-groups and fetches via GET list and by ID', async () => {
    const createRes = await requestHelper(server, {
      method: 'POST',
      path: '/api/task-groups',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        name: 'API Group 1',
        script_id: 'script-123',
        profile_ids: ['prof-1', 'prof-2'],
        active_session_cap: 3,
        per_task_timeout_ms: 30000,
        repeat_count: 2,
        randomize_profile_order: true,
        time_window_cron: '* * * * *',
      },
    });

    expect(createRes.status).toBe(200);
    expect(createRes.body.code).toBe(0);
    const groupId = createRes.body.data.id;
    expect(groupId).toBeDefined();

    const listRes = await requestHelper(server, {
      method: 'GET',
      path: '/api/task-groups',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.list.length).toBe(1);
    expect(listRes.body.data.list[0].id).toBe(groupId);

    const getRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/task-groups/${groupId}`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(groupId);
    expect(getRes.body.data.name).toBe('API Group 1');
  });

  it('retrieves tasks of a group via GET /api/task-groups/:id/tasks', async () => {
    const createRes = await requestHelper(server, {
      method: 'POST',
      path: '/api/task-groups',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        name: 'Group Tasks Test',
        script_id: 'script-1',
        profile_ids: ['prof-a', 'prof-b'],
      },
    });

    const groupId = createRes.body.data.id;

    const tasksRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/task-groups/${groupId}/tasks`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.data.list.length).toBe(2);
    expect(tasksRes.body.data.list[0].status).toBe('waiting');
  });

  it('starts and stops group via POST /api/task-groups/:id/start and :id/stop', async () => {
    const createRes = await requestHelper(server, {
      method: 'POST',
      path: '/api/task-groups',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        name: 'Start Stop Test',
        script_id: 'script-nonexistent',
        profile_ids: ['prof-1'],
      },
    });

    const groupId = createRes.body.data.id;

    const startRes = await requestHelper(server, {
      method: 'POST',
      path: `/api/task-groups/${groupId}/start`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(startRes.status).toBe(200);
    expect(startRes.body.code).toBe(0);

    const stopRes = await requestHelper(server, {
      method: 'POST',
      path: `/api/task-groups/${groupId}/stop`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(stopRes.status).toBe(200);
    expect(stopRes.body.code).toBe(0);
    expect(stopRes.body.data.status).toBe('stop');
  });

  it('streams logs via GET /api/tasks/:uuid/logs with SSE format', async () => {
    const createRes = await requestHelper(server, {
      method: 'POST',
      path: '/api/task-groups',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        name: 'Log Stream Test',
        script_id: 'script-1',
        profile_ids: ['prof-1'],
      },
    });

    const groupId = createRes.body.data.id;
    const tasksRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/task-groups/${groupId}/tasks`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const taskUuid = tasksRes.body.data.list[0].uuid;

    // 1. Non-streaming JSON mode (stream=false)
    const jsonRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/tasks/${taskUuid}/logs?stream=false`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.code).toBe(0);
    expect(Array.isArray(jsonRes.body.data.list)).toBe(true);

    // 2. Insert dummy log and mark task terminal to test SSE stream closure
    // static imports used
    appendTaskLog(taskUuid, 'Test log message');
    updateTaskProgress(taskUuid, { status: 'finished' });

    const logRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/tasks/${taskUuid}/logs?stream=true`,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
    });

    expect(logRes.status).toBe(200);
    expect(logRes.headers['content-type']).toContain('text/event-stream');
    expect(logRes.text).toContain('Test log message');
    expect(logRes.text).toContain('"event":"end"');
  });
});
