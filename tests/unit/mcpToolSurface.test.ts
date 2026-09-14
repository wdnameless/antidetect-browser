import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ToolRouter, TOOL_DEFINITIONS, ToolManifest } from '../../mcp/src/tools';
import {
  DEFAULT_TOOL_NAMES,
  GATED_TOOL_NAMES,
  PROHIBITED_TOOL_NAMES,
  isProhibitedTool,
} from '../../mcp/src/auth';
import { McpAuditLogger } from '../../mcp/src/audit';
import { AntidetectClient } from '../../packages/sdk-node/src/client';

/** Snapshot of the prohibited set as it existed before this surface expansion. */
const ORIGINAL_PROHIBITED = [
  'cdp.send',
  'cdp',
  'Runtime.evaluate',
  'runtime.evaluate',
  'Page.addScriptToEvaluateOnNewDocument',
  'process.exec',
  'child_process',
  'fs.read',
  'fs.write',
  'fs.delete',
  'credentials.dump',
  'credentials.extract',
  'evaluate_raw',
  'eval',
  'shell.exec',
];

/** Extract the space/comma separated tool names inside the last parenthesized block of a README tier line. */
function parseReadmeTierLine(line: string): Set<string> {
  const matches = [...line.matchAll(/\(([^)]*)\)/g)];
  if (matches.length === 0) return new Set<string>();
  const block = matches[matches.length - 1][1];
  return new Set(
    block
      .split(',')
      .map((s) => s.trim().replace(/`/g, ''))
      .filter(Boolean)
  );
}

describe('MCP tool surface (gap B6: extend-mcp-tool-surface)', () => {
  let tempAuditPath: string;
  let auditLogger: McpAuditLogger;
  let mockClient: AntidetectClient;
  let toolRouter: ToolRouter;

  beforeEach(() => {
    tempAuditPath = path.join(os.tmpdir(), `mcp-surface-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    auditLogger = new McpAuditLogger(tempAuditPath);

    mockClient = {
      proxy: {
        list: async () => ({ success: true, data: { list: [], total: 0 } }),
        create: async () => ({ success: true, data: { proxy_id: 'px-1' } }),
        delete: async () => ({ success: true, data: { deleted: true } }),
        check: async () => ({ success: true, data: { ok: true, latency_ms: 42 } }),
      },
      request: async (endpoint: string, opts?: { method?: string }) => ({
        success: true,
        data: { endpoint, method: opts?.method ?? 'GET', ok: true },
      }),
    } as unknown as AntidetectClient;

    toolRouter = new ToolRouter({
      client: mockClient,
      auditLogger,
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

  it('covers every uncovered API area with a registered tool', () => {
    const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    // groups named in the change: proxies, extensions, flows, task groups, trash, cookies, triggers, tags, batch
    expect(names).toContain('proxies.list');
    expect(names).toContain('proxies.create');
    expect(names).toContain('proxies.delete');
    expect(names).toContain('proxies.check');
    expect(names).toContain('extensions.list');
    expect(names).toContain('extensions.install');
    expect(names).toContain('extensions.delete');
    expect(names).toContain('flows.list');
    expect(names).toContain('flows.get');
    expect(names).toContain('flows.run');
    expect(names).toContain('flows.validate');
    expect(names).toContain('task_groups.list');
    expect(names).toContain('task_groups.get');
    expect(names).toContain('task_groups.tasks');
    expect(names).toContain('task_groups.start');
    expect(names).toContain('task_groups.stop');
    expect(names).toContain('trash.list');
    expect(names).toContain('trash.delete_forever');
    expect(names).toContain('cookies.export');
    expect(names).toContain('cookies.import');
    expect(names).toContain('triggers.list');
    expect(names).toContain('triggers.create');
    expect(names).toContain('triggers.delete');
    expect(names).toContain('triggers.toggle');
    expect(names).toContain('tags.list');
    expect(names).toContain('tags.attach');
    expect(names).toContain('tags.detach');
    expect(names).toContain('batch.start');
    expect(names).toContain('batch.stop');
    expect(names).toContain('batch.delete');
  });

  it('classifies every registered tool in exactly one tier (totality over the whole registry)', () => {
    const manifestNames = TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(manifestNames).size).toBe(manifestNames.length); // no duplicate registration

    // Every registered tool is in exactly one of the two name sets.
    for (const name of manifestNames) {
      const inDefault = DEFAULT_TOOL_NAMES.has(name) ? 1 : 0;
      const inGated = GATED_TOOL_NAMES.has(name) ? 1 : 0;
      expect(inDefault + inGated, `${name} must be in exactly one tier`).toBe(1);
    }

    // Every name in either set is a registered tool (no orphan set entries).
    for (const name of [...DEFAULT_TOOL_NAMES, ...GATED_TOOL_NAMES]) {
      expect(manifestNames).toContain(name);
    }

    // A tool in neither set would be unreachable or ungated — assert both membership directions above cover it.
    const union = new Set([...DEFAULT_TOOL_NAMES, ...GATED_TOOL_NAMES]);
    const unnamed = manifestNames.filter((n) => !union.has(n));
    expect(unnamed).toEqual([]);
  });

  it('matches manifest tier declarations with the name sets', () => {
    for (const tool of TOOL_DEFINITIONS) {
      if (tool.tier === 'default') {
        expect(DEFAULT_TOOL_NAMES.has(tool.name), `${tool.name} declared default but not in DEFAULT_TOOL_NAMES`).toBe(true);
        expect(GATED_TOOL_NAMES.has(tool.name)).toBe(false);
      } else if (tool.tier === 'gated') {
        expect(GATED_TOOL_NAMES.has(tool.name), `${tool.name} declared gated but not in GATED_TOOL_NAMES`).toBe(true);
        expect(DEFAULT_TOOL_NAMES.has(tool.name)).toBe(false);
      } else {
        throw new Error(`Unknown tier on ${tool.name}`);
      }
    }
  });

  it('refuses every gated tool for a standard-scope caller and records the refusal', async () => {
    for (const tool of TOOL_DEFINITIONS.filter((t) => t.tier === 'gated')) {
      const args: Record<string, unknown> = {};
      if (tool.name.includes('profile')) args.profile_id = 'p1';
      if (tool.name.includes('proxy')) args.proxy_id = 'px-1';
      if (tool.name.includes('extension')) args.extension_id = 'ext-1';
      if (tool.name.includes('trigger')) args.trigger_id = 'trg-1';
      if (tool.name.includes('cookie')) args.profile_id = 'p1';
      if (tool.name === 'batch.delete') args.user_ids = ['p1', 'p2'];
      if (tool.name === 'browser.evaluate_allowlisted') {
        args.profile_id = 'p1';
        args.script_id = 'extract_page_metadata';
      }
      if (tool.name === 'profiles.export_preserved' || tool.name === 'profiles.cleanup_preserved') args.registry_id = 'r1';

      const res = await toolRouter.callTool(tool.name, args, { scope: 'standard', caller: 'test-standard' });

      expect(res.success, `${tool.name} should be refused for standard scope`).toBe(false);
      expect(res.isForbidden, `${tool.name} should be marked forbidden`).toBe(true);

      const log = fs.readFileSync(tempAuditPath, 'utf8');
      expect(log, `refusal of ${tool.name} must be audited`).toContain(`"tool":"${tool.name}"`);
      expect(log).toContain('"decision":"deny"');
    }
  });

  it('allows every new gated tool for an admin-scope caller', async () => {
    const gatedNames = [
      'proxies.delete',
      'extensions.delete',
      'trash.delete_forever',
      'cookies.export',
      'cookies.import',
      'triggers.delete',
      'batch.delete',
    ];
    for (const name of gatedNames) {
      const args: Record<string, unknown> = {};
      if (name === 'proxies.delete') args.proxy_id = 'px-1';
      if (name === 'extensions.delete') args.extension_id = 'ext-1';
      if (name === 'trash.delete_forever') args.profile_id = 'p1';
      if (name === 'cookies.export') args.profile_id = 'p1';
      if (name === 'cookies.import') {
        args.profile_id = 'p1';
        args.cookies = [{ name: 'sid', value: 'abc', domain: '.example.com', path: '/' }];
      }
      if (name === 'triggers.delete') args.trigger_id = 'trg-1';
      if (name === 'batch.delete') args.user_ids = ['p1', 'p2'];

      for (const scope of ['admin', 'profile:write_danger']) {
        const res = await toolRouter.callTool(name, args, { scope, caller: `test-${scope}` });
        expect(res.success, `${name} should be allowed under ${scope}`).toBe(true);
        expect(res.error).toBeUndefined();
      }
    }
  });

  it('keeps the prohibited set unchanged and rejects any registered tool matching it', () => {
    // The exact pre-expansion prohibited names are still prohibited.
    for (const name of ORIGINAL_PROHIBITED) {
      expect(PROHIBITED_TOOL_NAMES.has(name), `${name} must remain prohibited`).toBe(true);
    }
    expect(PROHIBITED_TOOL_NAMES.size).toBe(ORIGINAL_PROHIBITED.length);

    // No registered (or tier-set) tool falls into a prohibited category.
    const registered = [
      ...TOOL_DEFINITIONS.map((t) => t.name),
      ...DEFAULT_TOOL_NAMES,
      ...GATED_TOOL_NAMES,
    ];
    for (const name of new Set(registered)) {
      expect(isProhibitedTool(name), `${name} must not be prohibited`).toBe(false);
    }

    // No registered name is an explicit prohibited name.
    for (const tool of TOOL_DEFINITIONS) {
      expect(PROHIBITED_TOOL_NAMES.has(tool.name)).toBe(false);
    }
  });

  it('documents every registered tool with its tier in mcp/README.md', () => {
    const readmePath = path.join(__dirname, '..', '..', 'mcp', 'README.md');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const tier1Line = readme.split('\n').find((l) => l.includes('**Tier 1 (Default)**'));
    const tier2Line = readme.split('\n').find((l) => l.includes('**Tier 2 (Gated)**'));
    expect(tier1Line, 'README must document a Tier 1 (Default) list').toBeDefined();
    expect(tier2Line, 'README must document a Tier 2 (Gated) list').toBeDefined();

    const docDefault = parseReadmeTierLine(tier1Line!);
    const docGated = parseReadmeTierLine(tier2Line!);

    for (const tool of TOOL_DEFINITIONS as ToolManifest[]) {
      if (tool.tier === 'default') {
        expect(docDefault.has(tool.name), `${tool.name} missing from README Tier 1`).toBe(true);
        expect(docGated.has(tool.name), `${tool.name} wrongly documented as gated`).toBe(false);
      } else {
        expect(docGated.has(tool.name), `${tool.name} missing from README Tier 2`).toBe(true);
        expect(docDefault.has(tool.name), `${tool.name} wrongly documented as default`).toBe(false);
      }
    }

    // No documented tier entry that is not a registered tool.
    const registryNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    for (const name of [...docDefault, ...docGated]) {
      expect(registryNames.has(name), `README documents unknown tool ${name}`).toBe(true);
    }
  });
});
