import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpServer } from '../../../mcp/src/server';
import { ToolRouter } from '../../../mcp/src/tools';
import { McpAuditLogger } from '../../../mcp/src/audit';
import { NonceReplayDefense } from '../../../mcp/src/auth';
import { RPC_ERRORS } from '../../../mcp/src/protocol';
import { AntidetectClient } from '../../../packages/sdk-node/src/client';
import { BrowserDriver } from '../../../mcp/src/browser';

describe('MCP Security Tiers & Tool Routing', () => {
  let tempAuditPath: string;
  let auditLogger: McpAuditLogger;
  let nonceDefense: NonceReplayDefense;
  let mockClient: AntidetectClient;
  let mockBrowserDriver: BrowserDriver;
  let toolRouter: ToolRouter;
  let server: McpServer;

  beforeEach(() => {
    tempAuditPath = path.join(os.tmpdir(), `mcp-test-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    auditLogger = new McpAuditLogger(tempAuditPath);
    nonceDefense = new NonceReplayDefense();

    mockClient = {
      profiles: {
        list: async () => ({ success: true, data: { profiles: [{ id: 'p1', name: 'Profile 1' }] } }),
        get: async (id: string) => ({ success: true, data: { id, name: 'Profile 1' } }),
        create: async (data: unknown) => ({ success: true, data: { id: 'p-new', ...(data as object) } }),
        start: async (id: string) => ({ success: true, data: { started: true, id } }),
        stop: async (id: string) => ({ success: true, data: { stopped: true, id } }),
        delete: async (id: string) => ({ success: true, data: { deleted: true, id } }),
      },
      browser: {
        start: async (id: string) => ({ success: true, data: { started: true, id } }),
        stop: async (id: string) => ({ success: true, data: { stopped: true, id } }),
        active: async () => ({ success: true, data: [] }),
      },
      diagnostics: {
        run: async (id: string) => ({ success: true, data: { profile_id: id, status: 'healthy' } }),
      },
      request: async (endpoint: string) => ({ success: true, data: { endpoint, handled: true } }),
    } as unknown as AntidetectClient;

    mockBrowserDriver = {
      navigate: async (_id: string, url: string) => ({ url, status: 200 }),
      click: async (_id: string, selector: string) => ({ clicked: true, selector }),
      type: async (_id: string, selector: string, _text: string) => ({ typed: true, selector }),
      screenshot: async (_id: string) => ({ format: 'image/png', base64: 'fakeb64', sizeBytes: 7 }),
      evaluateAllowlisted: async (_id: string, _code: string, params: Record<string, unknown>) => ({ evaluated: true, params }),
    } as unknown as BrowserDriver;

    toolRouter = new ToolRouter({
      client: mockClient,
      browserDriver: mockBrowserDriver,
      auditLogger,
    });

    server = new McpServer({
      toolRouter,
      auditLogger: auditLogger as any,
      nonceDefense,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempAuditPath)) {
      try {
        fs.unlinkSync(tempAuditPath);
      } catch {
        // ignore
      }
    }
  });

  it('executes Tier 1 (Default) tools under standard scope', async () => {
    const listRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'profiles.list',
        arguments: {},
      },
    }, { scope: 'standard' });

    expect(listRes.error).toBeUndefined();
    expect(listRes.result).toBeDefined();

    const navRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'browser.navigate',
        arguments: { profile_id: 'p1', url: 'https://example.com' },
      },
    }, { scope: 'standard' });

    expect(navRes.error).toBeUndefined();
  });

  it('denies Tier 2 (Gated) tools under standard scope and audits denial', async () => {
    const delRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'profiles.delete',
        arguments: { profile_id: 'p1' },
      },
    }, { scope: 'standard' });

    expect(delRes.error).toBeDefined();
    expect(delRes.error?.code).toBe(RPC_ERRORS.FORBIDDEN.code);

    // Verify audit log has the denial entry
    const logContent = fs.readFileSync(tempAuditPath, 'utf8');
    expect(logContent).toContain('profiles.delete');
    expect(logContent).toContain('"decision":"deny"');
  });

  it('allows Tier 2 (Gated) tools under admin scope', async () => {
    const delRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'profiles.delete',
        arguments: { profile_id: 'p1' },
      },
    }, { scope: 'admin' });

    expect(delRes.error).toBeUndefined();
    expect(delRes.result).toBeDefined();
  });

  it('allows Tier 2 tools when permitted via allowedGatedEnv', async () => {
    const customServer = new McpServer({
      toolRouter,
      allowedGatedEnv: 'profiles.delete,profiles.restore',
    });

    const delRes = await customServer.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'profiles.delete',
        arguments: { profile_id: 'p1' },
      },
    }, { scope: 'standard' });

    expect(delRes.error).toBeUndefined();
  });

  it('hard-rejects Prohibited tools under all scopes', async () => {
    for (const scope of ['standard', 'admin', 'profile:write_danger']) {
      const cdpRes = await server.handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: `prohib-${scope}`,
        method: 'tools/call',
        params: {
          name: 'cdp.send',
          arguments: { method: 'Runtime.evaluate' },
        },
      }, { scope });

      expect(cdpRes.error).toBeDefined();
      expect(cdpRes.error?.code).toBe(RPC_ERRORS.PROHIBITED.code);
    }
  });

  it('browser.evaluate_allowlisted accepts registered script and rejects unknown/arbitrary scripts', async () => {
    // Registered script from mcp/allowlist.json
    const allowedRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'browser.evaluate_allowlisted',
        arguments: {
          profile_id: 'p1',
          script_id: 'extract_page_metadata',
          params: {},
        },
      },
    }, { scope: 'admin' });

    expect(allowedRes.error).toBeUndefined();

    // Unknown script
    const unknownRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'browser.evaluate_allowlisted',
        arguments: {
          profile_id: 'p1',
          script_id: 'arbitrary_unapproved_script',
          params: {},
        },
      },
    }, { scope: 'admin' });

    expect(unknownRes.error).toBeDefined();
    expect(unknownRes.error?.data).toContain('not registered in mcp allowlist');
  });

  it('rejects replayed nonces via NonceReplayDefense', async () => {
    const nonce = 'unique-nonce-12345';

    const firstRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'profiles.list',
        arguments: {},
      },
    }, { scope: 'standard', nonce });

    expect(firstRes.error).toBeUndefined();

    // Replay same nonce
    const replayRes = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'profiles.list',
        arguments: {},
      },
    }, { scope: 'standard', nonce });

    expect(replayRes.error).toBeDefined();
    expect(replayRes.error?.code).toBe(RPC_ERRORS.NONCE_REPLAY.code);
  });
});
