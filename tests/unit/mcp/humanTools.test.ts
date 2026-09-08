import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpServer } from '../../../mcp/src/server';
import { ToolRouter, TOOL_DEFINITIONS } from '../../../mcp/src/tools';
import { McpAuditLogger } from '../../../mcp/src/audit';
import { NonceReplayDefense } from '../../../mcp/src/auth';
import { AntidetectClient } from '../../../packages/sdk-node/src/client';
import { BrowserDriver } from '../../../mcp/src/browser';

/** tools/call results arrive as { content: [{ type: 'text', text: '<json>' }] }. */
function parseToolText(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const first = content?.find((c) => c.type === 'text');
    if (first) {
      try {
        return JSON.parse(first.text) as Record<string, unknown>;
      } catch {
        return { raw: first.text };
      }
    }
  }
  return {};
}

describe('MCP human-input tools (Motion domain)', () => {
  let tempAuditPath: string;
  let auditLogger: McpAuditLogger;
  let nonceDefense: NonceReplayDefense;
  let mockClient: AntidetectClient;
  let mockBrowserDriver: BrowserDriver;
  let toolRouter: ToolRouter;
  let server: McpServer;

  beforeEach(() => {
    tempAuditPath = path.join(os.tmpdir(), `mcp-human-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    auditLogger = new McpAuditLogger(tempAuditPath);
    nonceDefense = new NonceReplayDefense();

    mockClient = {
      profiles: {
        list: async () => ({ success: true, data: { profiles: [{ id: 'p1', name: 'Profile 1' }] } }),
      },
    } as unknown as AntidetectClient;

    mockBrowserDriver = {
      humanType: async (_id: string, selector: string, text: string, allowTypos: boolean) => ({
        typed: true,
        selector,
        text,
        allowTypos,
        durationMs: 1200,
      }),
      humanClick: async (_id: string, selector: string, targetWidth: number) => ({
        clicked: true,
        selector,
        targetWidth,
        durationMs: 640,
      }),
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

  it('declares browser.human_type and browser.human_click as default-tier tools', () => {
    const typeTool = TOOL_DEFINITIONS.find((t) => t.name === 'browser.human_type');
    const clickTool = TOOL_DEFINITIONS.find((t) => t.name === 'browser.human_click');
    expect(typeTool).toBeDefined();
    expect(typeTool?.tier).toBe('default');
    expect(typeTool?.inputSchema.required).toEqual(['profile_id', 'selector', 'text']);
    expect(clickTool).toBeDefined();
    expect(clickTool?.tier).toBe('default');
    expect(clickTool?.inputSchema.required).toEqual(['profile_id', 'selector']);
  });

  it('routes browser.human_type with the allow_typos flag and text payload', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'browser.human_type',
        arguments: { profile_id: 'p1', selector: 'input[name="q"]', text: 'hello world', allow_typos: true },
      },
    }, { scope: 'standard' });

    expect(res.error).toBeUndefined();
    const payload = parseToolText(res.result);
    expect(payload).toMatchObject({ typed: true, text: 'hello world', allowTypos: true });
  });

  it('routes browser.human_click with the target_width parameter defaulted to 32', async () => {
    const withWidth = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'browser.human_click',
        arguments: { profile_id: 'p1', selector: 'button.submit', target_width: 16 },
      },
    }, { scope: 'standard' });
    expect(withWidth.error).toBeUndefined();
    expect(parseToolText(withWidth.result)).toMatchObject({ clicked: true, targetWidth: 16 });

    const defaultWidth = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'browser.human_click',
        arguments: { profile_id: 'p1', selector: 'button.submit' },
      },
    }, { scope: 'standard' });
    expect(parseToolText(defaultWidth.result)).toMatchObject({ clicked: true, targetWidth: 32 });
  });
});