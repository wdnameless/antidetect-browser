import * as fs from 'node:fs';
import * as path from 'node:path';
import { isAuthorized, isProhibitedTool } from './auth';
import { McpAuditLogger } from './audit';
import { AntidetectClient } from '@antidetect/sdk';
import { BrowserDriver } from './browser';

import { redactSensitiveArgs } from './redaction';
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
    name: 'browser.human_type',
    description: 'Type text into an input field with per-key human pacing (Motion domain): per-key delays, optional typo model.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        selector: { type: 'string', description: 'CSS selector of input field' },
        text: { type: 'string', description: 'Text to type' },
        allow_typos: { type: 'boolean', description: 'Enable the human typo model (default false)' },
      },
      required: ['profile_id', 'selector', 'text'],
    },
  },
  {
    name: 'browser.human_click',
    description: 'Click an element via a Fitts-law human cursor glide (Motion domain).',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Unique profile identifier' },
        selector: { type: 'string', description: 'CSS/XPath selector of element to click' },
        target_width: { type: 'number', description: 'Target width in px feeding Fitts law (default 32)' },
      },
      required: ['profile_id', 'selector'],
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
  {
    name: 'proxies.list',
    description: 'List configured proxies (metadata only, credentials excluded).',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'proxies.create',
    description: 'Create a new proxy entry.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['http', 'https', 'socks5', 'ssh'], description: 'Proxy protocol' },
        host: { type: 'string', description: 'Proxy host' },
        port: { type: 'number', description: 'Proxy port' },
        username: { type: 'string', description: 'Proxy username' },
        password: { type: 'string', description: 'Proxy password (redacted in audit logs)' },
        privateKey: { type: 'string', description: 'SSH private key for ssh-type proxies' },
      },
      required: ['type', 'host', 'port'],
    },
  },
  {
    name: 'proxies.check',
    description: 'Run a live health check against a proxy.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        proxy_id: { type: 'string', description: 'Proxy ID to check' },
      },
      required: ['proxy_id'],
    },
  },
  {
    name: 'extensions.list',
    description: 'List installed browser extensions.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'extensions.install',
    description: 'Install an extension from the Chrome Web Store (url), a known id, or a local path.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Chrome Web Store URL of the extension' },
        id: { type: 'string', description: 'Known extension id' },
        path: { type: 'string', description: 'Local path to the unpacked extension' },
      },
    },
  },
  {
    name: 'flows.list',
    description: 'List all automation flows.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'flows.get',
    description: 'Retrieve a flow document by id.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        flow_id: { type: 'string', description: 'Flow id' },
      },
      required: ['flow_id'],
    },
  },
  {
    name: 'flows.run',
    description: 'Run a flow across the given profile ids via a task group.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        flow_id: { type: 'string', description: 'Flow id to run' },
        profile_ids: { type: 'array', items: { type: 'string' }, description: 'Profiles to run the flow on' },
        concurrency: { type: 'number', description: 'Optional concurrency cap' },
        trigger: { type: 'string', enum: ['manual', 'cron'], description: 'Trigger type' },
        cron_schedule: { type: 'string', description: 'Cron schedule when trigger=cron' },
      },
      required: ['flow_id', 'profile_ids'],
    },
  },
  {
    name: 'flows.validate',
    description: 'Validate a flow document (by flow_id or inline document).',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        flow_id: { type: 'string', description: 'Flow id to validate (loaded from storage)' },
        document: { type: 'object', description: 'Inline flow document to validate, when flow_id is not given' },
      },
    },
  },
  {
    name: 'task_groups.list',
    description: 'List script task groups.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'task_groups.get',
    description: 'Retrieve a task group by id.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'string', description: 'Task group id' },
      },
      required: ['group_id'],
    },
  },
  {
    name: 'task_groups.tasks',
    description: 'List tasks belonging to a task group.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'string', description: 'Task group id' },
      },
      required: ['group_id'],
    },
  },
  {
    name: 'task_groups.start',
    description: 'Start or resume a task group.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'string', description: 'Task group id' },
      },
      required: ['group_id'],
    },
  },
  {
    name: 'task_groups.stop',
    description: 'Gracefully stop a running task group.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'string', description: 'Task group id' },
      },
      required: ['group_id'],
    },
  },
  {
    name: 'trash.list',
    description: 'List soft-deleted profiles in the trash.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'triggers.list',
    description: 'List automation triggers.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'triggers.create',
    description: 'Create a new trigger (schedule or event based).',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Trigger name' },
        script_id: { type: 'string', description: 'Script id to run' },
        type: { type: 'string', enum: ['schedule', 'event'], description: 'Trigger type' },
        schedule: { type: 'string', description: 'Cron schedule when type=schedule' },
        event: { type: 'string', enum: ['profile_started', 'profile_stopped'], description: 'Event when type=event' },
      },
      required: ['name', 'script_id', 'type'],
    },
  },
  {
    name: 'triggers.toggle',
    description: 'Enable or disable a trigger.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        trigger_id: { type: 'string', description: 'Trigger id' },
        enabled: { type: 'boolean', description: 'Desired enabled state' },
      },
      required: ['trigger_id', 'enabled'],
    },
  },
  {
    name: 'tags.list',
    description: 'List profile tags.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tags.attach',
    description: 'Attach a tag to one or more profiles.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        tag_id: { type: 'string', description: 'Tag id' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'Profile ids to attach the tag to' },
      },
      required: ['tag_id', 'user_ids'],
    },
  },
  {
    name: 'tags.detach',
    description: 'Detach a tag from one or more profiles.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        tag_id: { type: 'string', description: 'Tag id' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'Profile ids to detach the tag from' },
      },
      required: ['tag_id', 'user_ids'],
    },
  },
  {
    name: 'batch.start',
    description: 'Start multiple profiles in one request, returning a per-item success/failure report.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        user_ids: { type: 'array', items: { type: 'string' }, description: 'Profile ids to start' },
      },
      required: ['user_ids'],
    },
  },
  {
    name: 'batch.stop',
    description: 'Stop multiple profiles in one request, returning a per-item success/failure report.',
    tier: 'default',
    inputSchema: {
      type: 'object',
      properties: {
        user_ids: { type: 'array', items: { type: 'string' }, description: 'Profile ids to stop' },
      },
      required: ['user_ids'],
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
  {
    name: 'proxies.delete',
    description: 'Permanently delete a proxy entry (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        proxy_id: { type: 'string', description: 'Proxy ID to delete' },
      },
      required: ['proxy_id'],
    },
  },
  {
    name: 'extensions.delete',
    description: 'Permanently remove an installed extension (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        extension_id: { type: 'string', description: 'Extension ID to delete' },
      },
      required: ['extension_id'],
    },
  },
  {
    name: 'trash.delete_forever',
    description: 'Purge a soft-deleted profile from trash permanently (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Profile ID to purge forever' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'cookies.export',
    description: 'Export a profile\'s cookies (requires admin / profile:write_danger scope — cookie values are secret material).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Profile ID to export cookies from' },
        format: { type: 'string', enum: ['json', 'netscape'], description: 'Export format (default json)' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'cookies.import',
    description: 'Import cookies into a profile (requires admin / profile:write_danger scope — cookie values are secret material).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Profile ID to import cookies into' },
        cookies: { type: 'array', items: { type: 'object' }, description: 'Structured cookie objects (json format)' },
        format: { type: 'string', enum: ['json', 'netscape', 'sqlite', 'cookies'], description: 'Import format' },
        text: { type: 'string', description: 'Raw cookie payload (netscape text or sqlite base64)' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'triggers.delete',
    description: 'Permanently delete a trigger (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        trigger_id: { type: 'string', description: 'Trigger ID to delete' },
      },
      required: ['trigger_id'],
    },
  },
  {
    name: 'batch.delete',
    description: 'Bulk soft-delete multiple profiles in one request (requires admin / profile:write_danger scope).',
    tier: 'gated',
    inputSchema: {
      type: 'object',
      properties: {
        user_ids: { type: 'array', items: { type: 'string' }, description: 'Profile ids to delete' },
      },
      required: ['user_ids'],
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
    // Redaction happens BEFORE hashing/logging so audit logs never contain raw secrets
    // and the hash chain remains verifiable against redacted parameters.
    const auditedArgs = redactSensitiveArgs(args);
    if (isProhibitedTool(name)) {
      this.auditLogger.log({
        nonce,
        tool: name,
        args: auditedArgs,
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
        args: auditedArgs,
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
        args: auditedArgs,
        decision: 'allow',
        caller,
      });
      return { success: true, data: result };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.auditLogger.log({
        nonce,
        tool: name,
        args: auditedArgs,
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
      case 'browser.human_type': {
        const profileId = String(args.profile_id || '');
        const selector = String(args.selector || '');
        const text = String(args.text || '');
        const allowTypos = Boolean(args.allow_typos);
        return await this.browserDriver.humanType(profileId, selector, text, allowTypos);
      }
      case 'browser.human_click': {
        const profileId = String(args.profile_id || '');
        const selector = String(args.selector || '');
        const targetWidth = Number(args.target_width) > 0 ? Number(args.target_width) : 32;
        return await this.browserDriver.humanClick(profileId, selector, targetWidth);
      }
      case 'diagnostics.run': {
        const profileId = String(args.profile_id || '');
        const resp = await this.client.diagnostics.run(profileId);
        return resp.data;
      }

      // Tier 1.5+ surface: proxies / extensions / flows / task groups / trash / triggers / tags / batch
      case 'proxies.list': {
        const resp = await this.client.proxy.list();
        return resp.data;
      }
      case 'proxies.create': {
        const resp = await this.client.proxy.create({
          type: String(args.type || ''),
          host: String(args.host || ''),
          port: Number(args.port),
          ...(args.username !== undefined ? { username: String(args.username) } : {}),
          ...(args.password !== undefined ? { password: String(args.password) } : {}),
          ...(args.privateKey !== undefined ? { privateKey: String(args.privateKey) } : {}),
        });
        return resp.data;
      }
      case 'proxies.check': {
        const proxyId = String(args.proxy_id || '');
        const resp = await this.client.proxy.check(proxyId);
        return resp.data;
      }
      case 'extensions.list': {
        const resp = await (this.client as any).request('/api/v1/extension/list', { method: 'GET' });
        return resp.data;
      }
      case 'extensions.install': {
        const payload: Record<string, unknown> = {};
        if (args.url !== undefined) payload.url = String(args.url);
        if (args.id !== undefined) payload.id = String(args.id);
        if (args.path !== undefined) payload.path = String(args.path);
        const resp = await (this.client as any).request('/api/v1/extension/install', { method: 'POST', body: payload });
        return resp.data;
      }
      case 'flows.list': {
        const resp = await (this.client as any).request('/api/flows', { method: 'GET' });
        return resp.data;
      }
      case 'flows.get': {
        const flowId = String(args.flow_id || '');
        const resp = await (this.client as any).request(`/api/flows/${encodeURIComponent(flowId)}`, { method: 'GET' });
        return resp.data;
      }
      case 'flows.run': {
        const flowId = String(args.flow_id || '');
        const body: Record<string, unknown> = { profile_ids: args.profile_ids };
        if (args.concurrency !== undefined) body.concurrency = Number(args.concurrency);
        if (args.trigger !== undefined) body.trigger = String(args.trigger);
        if (args.cron_schedule !== undefined) body.cron_schedule = String(args.cron_schedule);
        const resp = await (this.client as any).request(`/api/flows/${encodeURIComponent(flowId)}/run`, { method: 'POST', body });
        return resp.data;
      }
      case 'flows.validate': {
        const flowId = args.flow_id !== undefined ? String(args.flow_id) : undefined;
        const payload = args.document !== undefined ? (args.document as Record<string, unknown>) : undefined;
        if (flowId) {
          // POST /api/flows/:id/validate validates the stored flow
          const resp = await (this.client as any).request(`/api/flows/${encodeURIComponent(flowId)}/validate`, { method: 'POST', body: {} });
          return resp.data;
        }
        if (payload) {
          // POST /api/flows/validate validates an inline document
          const resp = await (this.client as any).request('/api/flows/validate', { method: 'POST', body: payload });
          return resp.data;
        }
        throw new Error('flows.validate requires either flow_id or an inline document');
      }
      case 'task_groups.list': {
        const resp = await (this.client as any).request('/api/task-groups', { method: 'GET' });
        return resp.data;
      }
      case 'task_groups.get': {
        const groupId = String(args.group_id || '');
        const resp = await (this.client as any).request(`/api/task-groups/${encodeURIComponent(groupId)}`, { method: 'GET' });
        return resp.data;
      }
      case 'task_groups.tasks': {
        const groupId = String(args.group_id || '');
        const resp = await (this.client as any).request(`/api/task-groups/${encodeURIComponent(groupId)}/tasks`, { method: 'GET' });
        return resp.data;
      }
      case 'task_groups.start': {
        const groupId = String(args.group_id || '');
        const resp = await (this.client as any).request(`/api/task-groups/${encodeURIComponent(groupId)}/start`, { method: 'POST', body: {} });
        return resp.data;
      }
      case 'task_groups.stop': {
        const groupId = String(args.group_id || '');
        const resp = await (this.client as any).request(`/api/task-groups/${encodeURIComponent(groupId)}/stop`, { method: 'POST', body: {} });
        return resp.data;
      }
      case 'trash.list': {
        const resp = await (this.client as any).request('/api/v1/trash', { method: 'GET' });
        return resp.data;
      }
      case 'triggers.list': {
        const resp = await (this.client as any).request('/api/v1/triggers', { method: 'GET' });
        return resp.data;
      }
      case 'triggers.create': {
        const body: Record<string, unknown> = {
          name: String(args.name || ''),
          script_id: String(args.script_id || ''),
          type: String(args.type || ''),
        };
        if (args.schedule !== undefined) body.schedule = String(args.schedule);
        if (args.event !== undefined) body.event = String(args.event);
        const resp = await (this.client as any).request('/api/v1/triggers', { method: 'POST', body });
        return resp.data;
      }
      case 'triggers.toggle': {
        const triggerId = String(args.trigger_id || '');
        const enabled = Boolean(args.enabled);
        const resp = await (this.client as any).request(`/api/v1/triggers/${encodeURIComponent(triggerId)}/toggle`, {
          method: 'POST',
          body: { enabled },
        });
        return resp.data;
      }
      case 'tags.list': {
        const resp = await (this.client as any).request('/api/v1/tags', { method: 'GET' });
        return resp.data;
      }
      case 'tags.attach': {
        const tagId = String(args.tag_id || '');
        const userIds = Array.isArray(args.user_ids) ? (args.user_ids as unknown[]) : [];
        const resp = await (this.client as any).request(`/api/v1/tags/${encodeURIComponent(tagId)}/attach`, {
          method: 'POST',
          body: { user_ids: userIds },
        });
        return resp.data;
      }
      case 'tags.detach': {
        const tagId = String(args.tag_id || '');
        const userIds = Array.isArray(args.user_ids) ? (args.user_ids as unknown[]) : [];
        const resp = await (this.client as any).request(`/api/v1/tags/${encodeURIComponent(tagId)}/detach`, {
          method: 'POST',
          body: { user_ids: userIds },
        });
        return resp.data;
      }
      case 'batch.start': {
        const userIds = Array.isArray(args.user_ids) ? (args.user_ids as unknown[]) : [];
        const resp = await (this.client as any).request('/api/v1/browser-profile/bulk-start', {
          method: 'POST',
          body: { user_ids: userIds },
        });
        return resp.data;
      }
      case 'batch.stop': {
        const userIds = Array.isArray(args.user_ids) ? (args.user_ids as unknown[]) : [];
        const resp = await (this.client as any).request('/api/v1/browser-profile/bulk-stop', {
          method: 'POST',
          body: { user_ids: userIds },
        });
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
      case 'proxies.delete': {
        const proxyId = String(args.proxy_id || '');
        const resp = await this.client.proxy.delete(proxyId);
        return resp.data;
      }
      case 'extensions.delete': {
        const extensionId = String(args.extension_id || '');
        const resp = await (this.client as any).request('/api/v1/extension/delete', {
          method: 'POST',
          body: { extension_id: extensionId },
        });
        return resp.data;
      }
      case 'trash.delete_forever': {
        const profileId = String(args.profile_id || '');
        // POST /api/v1/trash/:id/delete purges a soft-deleted profile permanently.
        const resp = await (this.client as any).request(`/api/v1/trash/${encodeURIComponent(profileId)}/delete`, {
          method: 'POST',
        });
        return resp.data;
      }
      case 'cookies.export': {
        const profileId = String(args.profile_id || '');
        const format = args.format !== undefined ? String(args.format) : 'json';
        const resp = await (this.client as any).request('/api/v1/browser-profile/cookies/export', {
          method: 'GET',
          query: { user_id: profileId, format },
        });
        return resp.data;
      }
      case 'cookies.import': {
        const profileId = String(args.profile_id || '');
        const body: Record<string, unknown> = { user_id: profileId };
        if (args.cookies !== undefined) body.cookies = args.cookies;
        if (args.format !== undefined) body.format = String(args.format);
        if (args.text !== undefined) body.text = String(args.text);
        const resp = await (this.client as any).request('/api/v1/browser-profile/cookies/import', {
          method: 'POST',
          body,
        });
        return resp.data;
      }
      case 'triggers.delete': {
        const triggerId = String(args.trigger_id || '');
        const resp = await (this.client as any).request(`/api/v1/triggers/${encodeURIComponent(triggerId)}/delete`, {
          method: 'POST',
          body: {},
        });
        return resp.data;
      }
      case 'batch.delete': {
        const userIds = Array.isArray(args.user_ids) ? (args.user_ids as unknown[]) : [];
        const resp = await (this.client as any).request('/api/v1/browser-profile/bulk-delete', {
          method: 'POST',
          body: { user_ids: userIds },
        });
        return resp.data;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
