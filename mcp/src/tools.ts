import * as fs from 'node:fs';
import * as path from 'node:path';
import { isAuthorized, isProhibitedTool } from './auth';
import { McpAuditLogger } from './audit';
import { AntidetectClient } from '../../packages/sdk-node/dist/index.js';
import { BrowserDriver } from './browser';

export interface ToolManifest {
  name: string;
  description: string;
  tier: 'default' | 'gated';
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AllowlistEntry {
  id: string;
  name: string;
  description: string;
  params?: Record<string, unknown>;
  code: string;
}

export interface AllowlistRegistry {
  version: string;
  scripts: Record<string, AllowlistEntry>;
}

export const TOOL_DEFINITIONS: ToolManifest[] = [
  // Tier 1: Default
  {
    name: 'profiles.list',
    description: 'Enumerate profiles metadata (excluding sensitive credentials).',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number' },
        page_size: { type: 'number', description: 'Page size limit' },
        group_id: { type: 'string', description: 'Filter by group ID' },
      },
    },
  },
  {
    name: 'profiles.get',
    description: 'Retrieve profile details by profile ID.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'profiles.create',
    description: 'Provision a new browser profile with optional configuration.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Profile name' },
        group_id: { type: 'string', description: 'Assigned group ID' },
        proxy_id: { type: 'string', description: 'Proxy ID' },
        tags: { type: 'array', items: { type: 'string' } },
        os: { type: 'string', enum: ['windows', 'macos', 'linux'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'profiles.start',
    description: 'Launch a profile browser session and return CDP connection info.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        headless: { type: 'boolean', description: 'Run headless mode' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'profiles.stop',
    description: 'Terminate an active profile browser session.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'browser.navigate',
    description: 'Navigate active browser page of a profile to the specified URL.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        url: { type: 'string', description: 'Target URL to load' },
      },
      required: ['profile_id', 'url'],
    },
  },
  {
    name: 'browser.click',
    description: 'Click a DOM element on the active page matching selector.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        selector: { type: 'string', description: 'CSS/XPath selector of element to click' },
      },
      required: ['profile_id', 'selector'],
    },
  },
  {
    name: 'browser.type',
    description: 'Type text into a DOM input element matching selector.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        selector: { type: 'string', description: 'CSS selector of input field' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['profile_id', 'selector', 'text'],
    },
  },
  {
    name: 'browser.screenshot',
    description: 'Capture screenshot of the active page as base64 PNG (capped at 5MB).',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        full_page: { type: 'boolean', description: 'Capture full scrollable page' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'diagnostics.run',
    description: 'Execute health and proxy verification probes for a profile.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Profile ID to run diagnostics on' },
      },
      required: ['profile_id'],
    },
  },

  // Tier 2: Gated
  {
    name: 'profiles.delete',
    description: 'Permanently or soft-delete a browser profile (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Profile ID to delete' },
        permanent: { type: 'boolean', description: 'Permanent deletion' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'profiles.restore',
    description: 'Restore a soft-deleted profile from trash (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Profile ID to restore' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'profiles.export_preserved',
    description: 'Export preserved legacy browser data archive (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        registry_id: { type: 'string', description: 'Preserved data registry ID' },
      },
      required: ['registry_id'],
    },
  },
  {
    name: 'profiles.cleanup_preserved',
    description: 'Permanently cleanup and delete preserved legacy data archive (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        registry_id: { type: 'string', description: 'Preserved data registry ID' },
        confirmation: { type: 'string', description: 'Confirmation token' },
      },
      required: ['registry_id'],
    },
  },
  {
    name: 'browser.evaluate_allowlisted',
    description: 'Execute pre-registered script template by unique registered script_id with structured params.',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        script_id: { type: 'string', description: 'Allowlisted script identifier' },
        params: { type: 'object', description: 'Parameters to pass to the script function' },
      },
      required: ['profile_id', 'script_id'],
    },
  },
];

export class ToolRouter {
  private readonly client: AntidetectClient;
  private readonly browserDriver: BrowserDriver;
  private readonly auditLogger: McpAuditLogger;
  private readonly allowlist: Map<string, AllowlistEntry> = new Map();

  constructor(options?: {
    client?: AntidetectClient;
    browserDriver?: BrowserDriver;
    auditLogger?: McpAuditLogger;
    allowlistPath?: string;
  }) {
    this.client = options?.client || new AntidetectClient({ baseUrl: process.env.ANTIDETECT_API_URL || 'http://127.0.0.1:3000' });
    this.browserDriver = options?.browserDriver || new BrowserDriver(this.client);
    this.auditLogger = options?.auditLogger || new McpAuditLogger();

    const allowlistFile = options?.allowlistPath || path.resolve(__dirname, '../allowlist.json');
    this.loadAllowlist(allowlistFile);
  }

  private loadAllowlist(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(raw) as AllowlistRegistry;
        if (json.scripts) {
          for (const [key, val] of Object.entries(json.scripts)) {
            this.allowlist.set(key, val);
          }
        }
      } catch (err) {
        console.error('[ToolRouter] Failed to parse allowlist.json:', err);
      }
    }
  }

  public getAllowlist(): Map<string, AllowlistEntry> {
    return this.allowlist;
  }

  public listTools(): Array<{ name: string; description: string; inputSchema: unknown }> {
    return TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  public async callTool(
    name: string,
    args: Record<string, unknown> = {},
    context: { scope?: string; caller?: string; nonce?: string; allowedGatedEnv?: string } = {}
  ): Promise<{ success: boolean; data?: unknown; error?: string; isForbidden?: boolean; isProhibited?: boolean }> {
    const caller = context.caller || 'mcp-agent';
    const nonce = context.nonce || `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const scope = context.scope || 'standard';

    if (isProhibitedTool(name)) {
      this.auditLogger.log({
        nonce,
        tool: name,
        args,
        decision: 'deny',
        error: 'Prohibited operation',
        caller,
      });
      return {
        success: false,
        error: `Prohibited operation: '${name}' violates safety policy`,
        isProhibited: true,
      };
    }

    if (!isAuthorized(name, scope, context.allowedGatedEnv)) {
      this.auditLogger.log({
        nonce,
        tool: name,
        args,
        decision: 'deny',
        error: 'Insufficient permissions',
        caller,
      });
      return {
        success: false,
        error: `Forbidden: Scope '${scope}' cannot execute tool '${name}'`,
        isForbidden: true,
      };
    }

    try {
      const result = await this.executeToolInternal(name, args);
      this.auditLogger.log({
        nonce,
        tool: name,
        args,
        decision: 'allow',
        caller,
      });
      return { success: true, data: result };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.auditLogger.log({
        nonce,
        tool: name,
        args,
        decision: 'error',
        error: errMsg,
        caller,
      });
      return { success: false, error: errMsg };
    }
  }

  private async executeToolInternal(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'profiles.list': {
        const resp = await this.client.profiles.list(args as any);
        return resp.data;
      }
      case 'profiles.get': {
        const profileId = String(args.profile_id || '');
        const resp = await this.client.profiles.get(profileId);
        return resp.data;
      }
      case 'profiles.create': {
        const resp = await this.client.profiles.create(args as any);
        return resp.data;
      }
      case 'profiles.start': {
        const profileId = String(args.profile_id || '');
        const headless = Boolean(args.headless);
        const resp = await this.client.browser.start(profileId, { headless });
        return resp.data;
      }
      case 'profiles.stop': {
        const profileId = String(args.profile_id || '');
        const resp = await this.client.browser.stop(profileId);
        return resp.data;
      }
      case 'browser.navigate': {
        const profileId = String(args.profile_id || '');
        const url = String(args.url || '');
        return await this.browserDriver.navigate(profileId, url);
      }
      case 'browser.click': {
        const profileId = String(args.profile_id || '');
        const selector = String(args.selector || '');
        return await this.browserDriver.click(profileId, selector);
      }
      case 'browser.type': {
        const profileId = String(args.profile_id || '');
        const selector = String(args.selector || '');
        const text = String(args.text || '');
        return await this.browserDriver.type(profileId, selector, text);
      }
      case 'browser.screenshot': {
        const profileId = String(args.profile_id || '');
        const fullPage = Boolean(args.full_page);
        return await this.browserDriver.screenshot(profileId, fullPage);
      }
      case 'diagnostics.run': {
        const profileId = String(args.profile_id || '');
        const resp = await this.client.diagnostics.run(profileId);
        return resp.data;
      }

      // Gated Tools
      case 'profiles.delete': {
        const profileId = String(args.profile_id || '');
        const resp = await this.client.profiles.delete(profileId);
        return resp.data;
      }
      case 'profiles.restore': {
        const profileId = String(args.profile_id || '');
        // Calls POST /api/v1/trash/:id/restore via generic client request
        const resp = await (this.client as any).request(`/api/v1/trash/${encodeURIComponent(profileId)}/restore`, {
          method: 'POST',
        });
        return resp.data;
      }
      case 'profiles.export_preserved': {
        const registryId = String(args.registry_id || '');
        const resp = await (this.client as any).request(`/api/v1/preserved-browser-data/${encodeURIComponent(registryId)}/export`, {
          method: 'POST',
        });
        return resp.data;
      }
      case 'profiles.cleanup_preserved': {
        const registryId = String(args.registry_id || '');
        const confirmation = String(args.confirmation || '');
        const resp = await (this.client as any).request(`/api/v1/preserved-browser-data/${encodeURIComponent(registryId)}/cleanup`, {
          method: 'POST',
          body: { confirmation },
        });
        return resp.data;
      }
      case 'browser.evaluate_allowlisted': {
        const profileId = String(args.profile_id || '');
        const scriptId = String(args.script_id || '');
        const params = (args.params as Record<string, unknown>) || {};

        const scriptEntry = this.allowlist.get(scriptId);
        if (!scriptEntry) {
          throw new Error(`Script ID '${scriptId}' is not registered in mcp allowlist. Arbitrary script evaluation is prohibited.`);
        }

        return await this.browserDriver.evaluateAllowlisted(profileId, scriptEntry.code, params);
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
