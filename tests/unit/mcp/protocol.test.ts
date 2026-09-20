import { describe, it, expect, beforeEach } from 'vitest';
import * as http from 'node:http';
import {
  parseJsonRpcMessage,
  createErrorResponse,
  createSuccessResponse,
  RPC_ERRORS,
} from '../../../mcp/src/protocol';
import { SessionTokenManager } from '../../../mcp/src/auth';
import { McpServer } from '../../../mcp/src/server';
import { ToolRouter, TOOL_DEFINITIONS } from '../../../mcp/src/tools';

describe('MCP Protocol & Transports', () => {
  let server: McpServer;
  let toolRouter: ToolRouter;

  beforeEach(() => {
    toolRouter = new ToolRouter();
    server = new McpServer({ toolRouter });
  });

  it('parses valid JSON-RPC 2.0 messages', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });

    const parsed = parseJsonRpcMessage(raw);
    expect(parsed.error).toBeUndefined();
    expect(parsed.request).toBeDefined();
    expect(parsed.request?.method).toBe('initialize');
    expect(parsed.request?.id).toBe(1);
  });

  it('rejects invalid JSON-RPC payload', () => {
    const parsed = parseJsonRpcMessage('not-json');
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.error?.code).toBe(RPC_ERRORS.PARSE_ERROR.code);

    const invalidReq = parseJsonRpcMessage(JSON.stringify({ jsonrpc: '1.0', method: 'ping' }));
    expect(invalidReq.error).toBeDefined();
    expect(invalidReq.error?.error?.code).toBe(RPC_ERRORS.INVALID_REQUEST.code);
  });

  it('handles initialize request returning protocol capabilities', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
    });

    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe('init-1');
    const result = res.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('@antidetect/mcp-server');
  });

  it('handles ping request', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'ping-1',
      method: 'ping',
    });

    expect(res.id).toBe('ping-1');
    expect(res.error).toBeUndefined();
  });

  it('tools/list returns only Tier 1 and Tier 2 tools, never prohibited tools', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'tools-1',
      method: 'tools/list',
    });

    expect(res.error).toBeUndefined();
    const result = res.result as { tools: Array<{ name: string; description: string }> };
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBe(TOOL_DEFINITIONS.length);

    const names = result.tools.map((t) => t.name);
    expect(names).toContain('profiles.list');
    expect(names).toContain('browser.navigate');
    expect(names).toContain('profiles.delete');
    expect(names).toContain('browser.evaluate_allowlisted');

    // Verify NO prohibited tools exposed
    expect(names).not.toContain('cdp.send');
    expect(names).not.toContain('Runtime.evaluate');
    expect(names).not.toContain('process.exec');
    expect(names).not.toContain('fs.read');
  });

  it('returns MethodNotFound for unknown RPC methods', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'unknown/method',
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(RPC_ERRORS.METHOD_NOT_FOUND.code);
  });

  it('enforces loopback-only binding for HTTP transport', async () => {
    await expect(server.startHttp(9999, '0.0.0.0')).rejects.toThrow(/loopback/i);
    await expect(server.startHttp(9999, '192.168.1.50')).rejects.toThrow(/loopback/i);
  });

  it('validates Host header against DNS rebinding attacks', async () => {
    // The transport now requires a bearer token, so a Host-header check must send one —
    // otherwise every request returns 401 and the assertions below would be measuring
    // authentication rather than the rebinding defence they exist to cover.
    const secret = 'host-validation-secret';
    process.env.ANTIDETECT_MCP_SECRET = secret;
    const authedServer = new McpServer({ tokenManager: new SessionTokenManager(secret) });
    const authedPort = 44124;
    await authedServer.startHttp(authedPort, '127.0.0.1');
    const token = new SessionTokenManager(secret).generateToken('host-test', 'standard');

    try {
      // Forbidden Host header (DNS rebinding attempt).
      // Use node:http directly: the vitest runtime's global fetch drops
      // custom Host headers (undici guard), which would mask the defense.
      const evilStatus = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: authedPort,
            path: '/mcp',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Host: 'evil.example.com:4000',
              Authorization: `Bearer ${token}`,
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          }
        );
        req.on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
      });
      // 403, not 401: the Host check runs BEFORE authentication, so a rebinding attempt is
      // refused for the reason it is refused — not incidentally by the auth layer.
      expect(evilStatus).toBe(403);

      // Legitimate Host headers: localhost:<port> and 127.0.0.1:<port>
      const goodRes1 = await fetch(`http://127.0.0.1:${authedPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${authedPort}`,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'ping',
        }),
      });
      expect(goodRes1.status).toBe(200);

      const goodRes2 = await fetch(`http://127.0.0.1:${authedPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: `localhost:${authedPort}`,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'ping',
        }),
      });
      expect(goodRes2.status).toBe(200);
    } finally {
      delete process.env.ANTIDETECT_MCP_SECRET;
      await authedServer.stop();
    }
  });

  it('rejects an unauthenticated request before it can reach any tool', async () => {
    // The defect this pins: `POST /mcp` used to fall through with the default scope, and
    // because the server carries the app's credentials, an unauthenticated local caller could
    // EXECUTE tools — a profile was created over the loopback socket with no header at all.
    const secret = 'auth-required-secret';
    const authedServer = new McpServer({ tokenManager: new SessionTokenManager(secret) });
    const port = 44125;
    await authedServer.startHttp(port, '127.0.0.1');
    try {
      const noHeader = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(noHeader.status).toBe(401);

      const forged = new SessionTokenManager('antidetect-mcp-default-secret').generateToken(
        'attacker',
        'admin',
      );
      const forgedRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${forged}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      });
      // The published default secret must not mint an accepted token.
      expect(forgedRes.status).toBe(401);

      const valid = new SessionTokenManager(secret).generateToken('operator', 'standard');
      const okRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${valid}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
      });
      // And a correctly signed token still works, so the fix did not simply close the door.
      expect(okRes.status).toBe(200);
    } finally {
      await authedServer.stop();
    }
  });
});
