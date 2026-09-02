import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseJsonRpcMessage,
  createErrorResponse,
  createSuccessResponse,
  RPC_ERRORS,
} from '../../../mcp/src/protocol';
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
});
