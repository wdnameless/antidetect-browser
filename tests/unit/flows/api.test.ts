import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import * as http from 'http';
import flowsRouter from '../../../src/main/api/routes/flows';
import { ensureFlowsTable, deleteFlow } from '../../../src/main/flows/storage';
import { FlowDocument } from '../../../src/main/flows/types';
import { initDb, closeDb } from '../../../src/main/db';

function requestHelper(server: http.Server, options: {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown; text: string }> {
  const addr = server.address() as { port: number };
  const postData = options.body ? JSON.stringify(options.body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: options.path,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...options.headers,
      },
    }, (res) => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json: unknown = null;
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

describe('Flows REST API', () => {
  let app: express.Express;
  let server: http.Server;

  beforeEach(async () => {
    await initDb(':memory:');
    ensureFlowsTable();
    app = express();
    app.use(express.json());
    app.use(flowsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDb();
  });
  const sampleFlow: FlowDocument = {
    schemaVersion: '1.0.0',
    id: 'api-test-flow',
    name: 'API Test Flow',
    description: 'A test flow',
    entryNodeId: 'node-1',
    variables: [{ name: 'count', type: 'number', defaultValue: 10 }],
    nodes: [
      { id: 'node-1', type: 'eval', name: 'Eval', code: 'vars.count += 1;' },
      { id: 'node-2', type: 'wait', name: 'Wait', timeoutMs: 100 },
    ],
    edges: [
      { id: 'e1', source: 'node-1', target: 'node-2', branch: 'default' },
    ],
  };

  it('validates a flow document via POST /api/flows/validate', async () => {
    const res = await requestHelper(server, {
      method: 'POST',
      path: '/api/flows/validate',
      body: sampleFlow,
    });

    expect(res.status).toBe(200);
    const data = (res.body as { code: number; data: { valid: boolean; errors: unknown[] } }).data;
    expect(data.valid).toBe(true);
    expect(data.errors).toHaveLength(0);
  });

  it('rejects an invalid flow document via POST /api/flows/validate', async () => {
    const invalidFlow = { ...sampleFlow, nodes: [] };
    const res = await requestHelper(server, {
      method: 'POST',
      path: '/api/flows/validate',
      body: invalidFlow,
    });

    console.log('VALIDATE RES BODY:', res.body);
    const body = res.body as { data: { valid: boolean; errors: unknown[] } };
    expect(body.data.valid).toBe(false);
  });
  it('supports flow CRUD operations', async () => {
    // 1. Create
    const createRes = await requestHelper(server, {
      method: 'POST',
      path: '/api/flows',
      body: sampleFlow,
    });
    if (createRes.status !== 200) console.log('CREATE RES BODY:', createRes.body);
    expect(createRes.status).toBe(200);
    const createBody = createRes.body as { code: number; data: { flow: FlowDocument } };
    // 2. List
    const listRes = await requestHelper(server, {
      method: 'GET',
      path: '/api/flows',
    });
    expect(listRes.status).toBe(200);
    const listBody = listRes.body as { data: { list: Array<{ id: string }> } };
    expect(listBody.data.list.some((f) => f.id === sampleFlow.id)).toBe(true);

    // 3. Get by ID
    const getRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/flows/${sampleFlow.id}`,
    });
    expect(getRes.status).toBe(200);
    const getBody = getRes.body as { data: { flow: { id: string; name: string } } };
    expect(getBody.data.flow.id).toBe(sampleFlow.id);
    expect(getBody.data.flow.name).toBe(sampleFlow.name);

    // 4. Update
    const updatedFlow = { ...sampleFlow, name: 'Updated Flow Name' };
    const putRes = await requestHelper(server, {
      method: 'PUT',
      path: `/api/flows/${sampleFlow.id}`,
      body: updatedFlow,
    });
    expect(putRes.status).toBe(200);
    const putBody = putRes.body as { data: { flow: { name: string } } };
    expect(putBody.data.flow.name).toBe('Updated Flow Name');

    // 5. Export JSON
    const exportRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/flows/${sampleFlow.id}/export`,
    });
    expect(exportRes.status).toBe(200);
    const exportBody = exportRes.body as { id: string; name: string };
    expect(exportBody.id).toBe(sampleFlow.id);
    expect(exportBody.name).toBe('Updated Flow Name');

    // 6. Delete
    const delRes = await requestHelper(server, {
      method: 'DELETE',
      path: `/api/flows/${sampleFlow.id}`,
    });
    expect(delRes.status).toBe(200);
    expect((delRes.body as { code: number }).code).toBe(0);

    // 7. Get after delete -> 404
    const notFoundRes = await requestHelper(server, {
      method: 'GET',
      path: `/api/flows/${sampleFlow.id}`,
    });
    expect(notFoundRes.status).toBe(404);
  });

  it('supports importing a flow via POST /api/flows/import', async () => {
    const importData = {
      ...sampleFlow,
      id: 'imported-flow-1',
      name: 'Imported Flow',
    };

    const res = await requestHelper(server, {
      method: 'POST',
      path: '/api/flows/import',
      body: { document: importData },
    });
    if (res.status !== 200) console.log('IMPORT RES BODY:', res.body);
    expect(res.status).toBe(200);
    const resBody = res.body as { code: number; data: { id: string } };
    expect(resBody.code).toBe(0);
    expect(resBody.data.id).toBe('imported-flow-1');
    const check = await requestHelper(server, {
      method: 'GET',
      path: '/api/flows/imported-flow-1',
    });
    expect(check.status).toBe(200);
    const checkBody = check.body as { data: { flow: { name: string } } };
    expect(checkBody.data.flow.name).toBe('Imported Flow');
    deleteFlow('imported-flow-1');
  });
});
