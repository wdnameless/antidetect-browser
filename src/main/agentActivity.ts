/**
 * Agent activity: what an external caller has just done to this app.
 *
 * The operator launches profiles through an AI agent (the bundled MCP server) and could not see it
 * happen in the interface: «Агент открывает профиль браузера, но в нашем интерфейсе NullTrace не
 * отображается, что браузер открыт». They also asked to be told when the agent acts:
 * «когда агент дергает опишку, у нас должно приходить уведомления, что он что-то дергает и что-то
 * делает». This module is the single place that answers "who called, and what did it just do".
 *
 * WHERE ACTIVITY COMES FROM — TWO SOURCES, BOTH REQUIRED
 *
 * The MCP server is a separate child process with two ways of acting:
 *
 *  1. Via this backend's HTTP API — `profiles.start` calls `client.browser.start`, i.e. a real
 *     `POST /api/v1/browser/start`. Observed here by the request classifier.
 *  2. Via Chrome DevTools Protocol directly — `browser.navigate`, `browser.click`, `browser.type`,
 *     `browser.screenshot`, `browser.human_type` and `browser.human_click` connect puppeteer-core
 *     straight to the profile's CDP endpoint (`mcp/src/browser.ts`) and never touch this backend at
 *     all. Those are reported by the MCP tool dispatcher itself, which sends one lightweight POST
 *     per action.
 *
 * Instrumenting only the HTTP surface would silently miss every page interaction, which is most of
 * what an agent does; instrumenting only the MCP layer would miss direct API/SDK users. Both
 * report here and are rendered the same way.
 *
 * Nothing in this module is on the critical path: publishing never throws and never awaits, so a
 * subscriber that fails cannot affect the response the caller receives.
 */

export type ActivitySource = 'agent' | 'ui' | 'telegram';

/** A human-meaningful action, as the operator would describe it. */
export interface AgentActivityEvent {
  /** Stable id, so a consumer can de-duplicate across a reconnect. */
  id: string;
  /** Epoch ms. */
  at: number;
  /** Machine kind, e.g. `profile.start`. Used for per-event notification settings. */
  kind: string;
  /** Ready-to-render sentence, e.g. `Started profile «Профиль 1»`. */
  summary: string;
  /** Who did it. Only `agent` is announced; see the Telegram subscriber. */
  source: ActivitySource;
  profileId?: string;
  /** Where it was observed — an HTTP route or an MCP tool name. Diagnosis only. */
  route: string;
}

type ActivityListener = (event: AgentActivityEvent) => void;

const listeners: ActivityListener[] = [];
let seq = 0;

/** Subscribe to agent activity. Returns an unsubscribe function. */
export function onAgentActivity(listener: ActivityListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

/**
 * Publish an activity event to every subscriber.
 *
 * A listener that throws is skipped for this event only — the caller's response is already under
 * way by the time this runs, and one broken consumer must not stop the others from being told.
 */
export function publishAgentActivity(input: Omit<AgentActivityEvent, 'id' | 'at'> & { at?: number }): AgentActivityEvent {
  const event: AgentActivityEvent = {
    id: `act_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    at: input.at ?? Date.now(),
    kind: input.kind,
    summary: input.summary,
    source: input.source,
    profileId: input.profileId,
    route: input.route,
  };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A subscriber's failure is not the caller's problem.
    }
  }
  return event;
}

/** Test seam: drop every subscriber so a suite starts from a known state. */
export function resetAgentActivityListeners(): void {
  listeners.length = 0;
}

/**
 * Classifies an HTTP request's origin.
 *
 * An explicit client header wins. The `User-Agent` fallback exists because the useful question is
 * not "is this the exact MCP process" but "is this the desktop interface or a program": the panel
 * always sends a `Mozilla`-prefixed agent, while a script using `fetch`/`axios` never does.
 * Classifying on the explicit header alone would make every third-party automation script
 * invisible, which is the opposite of what was asked for.
 */
export function classifyRequest(headers: Record<string, unknown>): ActivitySource | 'unknown' {
  const declared = String(headers['x-nulltrace-client'] ?? '').trim().toLowerCase();
  if (declared === 'mcp' || declared === 'agent') return 'agent';
  if (declared === 'ui' || declared === 'panel') return 'ui';
  const ua = String(headers['user-agent'] ?? '');
  if (!ua) return 'unknown';
  return /mozilla|webkit|gecko|chrome|safari|edg\//i.test(ua) ? 'ui' : 'agent';
}

/**
 * What an HTTP request means, in the operator's language.
 *
 * `null` for requests not worth announcing: the panel polls `/status` and lists its own data
 * constantly, and reporting those would bury the real actions in noise. Every path here was read
 * from the owning route file — the app's route prefixes are not uniform (`/api/v1/...`,
 * `/api/flows`, `/api/task-groups`), so they cannot be guessed.
 */
export function describeRequest(method: string, pathname: string): { kind: string; verb: string } | null {
  const m = method.toUpperCase();
  const p = pathname;

  // Profile lifecycle: the operator's headline case.
  if (p === '/api/v1/browser/start' || p === '/api/v2/browser-profile/start') return { kind: 'profile.start', verb: 'Started' };
  if (p === '/api/v1/browser/stop' || p === '/api/v2/browser-profile/stop') return { kind: 'profile.stop', verb: 'Stopped' };
  if (p === '/api/v1/profiles' && m === 'POST') return { kind: 'profile.create', verb: 'Created' };
  if (p === '/api/v1/profiles/temporary') return { kind: 'profile.create', verb: 'Created a temporary profile for' };
  if (p === '/api/v1/browser-profile/bulk-start') return { kind: 'profile.bulk_start', verb: 'Started profiles in bulk' };
  if (p === '/api/v1/browser-profile/bulk-stop') return { kind: 'profile.bulk_stop', verb: 'Stopped profiles in bulk' };
  if (m === 'DELETE' && /^\/api\/v1\/profiles\/[^/]+$/.test(p)) return { kind: 'profile.delete', verb: 'Deleted' };

  // Supporting operations, with the real prefixes verified against their route files.
  if (p === '/api/v1/proxy' && m === 'POST') return { kind: 'proxy.create', verb: 'Added a proxy' };
  if (/^\/api\/v1\/proxy\/[^/]+\/check$/.test(p)) return { kind: 'proxy.check', verb: 'Checked proxy' };
  if (p === '/api/v1/extension/install') return { kind: 'extension.install', verb: 'Installed an extension' };
  if (/^\/api\/flows\/[^/]+\/run$/.test(p)) return { kind: 'flow.run', verb: 'Ran a flow' };
  if (/^\/api\/v1\/diagnostics\/[^/]+$/.test(p)) return { kind: 'diagnostics.run', verb: 'Ran diagnostics on' };
  if (/^\/api\/task-groups\/[^/]+\/start$/.test(p)) return { kind: 'taskgroup.start', verb: 'Started a task group' };
  if (/^\/api\/cookie-robot\/(run|start)$/.test(p)) return { kind: 'cookies.harvest', verb: 'Ran the cookie robot on' };
  if (p === '/api/v1/browser-profile/cookies/export' || p === '/api/v1/browser-profile/cookies/export-sqlite') {
    return { kind: 'cookies.export', verb: 'Exported cookies from' };
  }

  return null;
}

/**
 * The profile a request targets, when it names one.
 *
 * Read from the body or the query because both forms are in use across the routes above. A bulk
 * call reports its count instead of one id. The value is returned unresolved — turning it into a
 * name needs the database, and consumers resolve it when they render.
 */
export function extractProfileId(body: unknown, query: unknown): string | undefined {
  const fromBody = body as { user_id?: unknown; profile_id?: unknown; user_ids?: unknown } | undefined;
  const fromQuery = query as { user_id?: unknown; profile_id?: unknown } | undefined;
  for (const candidate of [fromBody?.user_id, fromBody?.profile_id, fromQuery?.user_id, fromQuery?.profile_id]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const many = fromBody?.user_ids;
  if (Array.isArray(many) && many.length > 0) return `${many.length} profiles`;
  return undefined;
}

/**
 * Tool names the MCP dispatcher reports, as the operator would describe them.
 *
 * Kept beside `describeRequest` so the two observation points stay in one file and cannot drift
 * into two vocabularies. Names are the ones in `mcp/src/tools.ts`; a tool absent here is still
 * published by the dispatcher, just under its raw name.
 */
export const MCP_TOOL_LABELS: Record<string, { kind: string; verb: string }> = {
  'profiles.start': { kind: 'profile.start', verb: 'Started' },
  'profiles.stop': { kind: 'profile.stop', verb: 'Stopped' },
  'profiles.create': { kind: 'profile.create', verb: 'Created' },
  'profiles.delete': { kind: 'profile.delete', verb: 'Deleted' },
  'profiles.restore': { kind: 'profile.restore', verb: 'Restored' },
  'browser.navigate': { kind: 'browser.navigate', verb: 'Navigated to a page in' },
  'browser.click': { kind: 'browser.click', verb: 'Clicked an element in' },
  'browser.type': { kind: 'browser.type', verb: 'Typed into a field in' },
  'browser.human_type': { kind: 'browser.type', verb: 'Typed like a human into' },
  'browser.human_click': { kind: 'browser.click', verb: 'Clicked like a human in' },
  'browser.screenshot': { kind: 'browser.screenshot', verb: 'Took a screenshot of' },
  'browser.evaluate_allowlisted': { kind: 'browser.evaluate', verb: 'Ran a script in' },
  'proxies.create': { kind: 'proxy.create', verb: 'Added a proxy' },
  'proxies.check': { kind: 'proxy.check', verb: 'Checked a proxy' },
  'extensions.install': { kind: 'extension.install', verb: 'Installed an extension' },
  'flows.run': { kind: 'flow.run', verb: 'Ran a flow' },
  'task_groups.start': { kind: 'taskgroup.start', verb: 'Started a task group' },
  'batch.start': { kind: 'profile.bulk_start', verb: 'Started profiles in bulk' },
  'batch.stop': { kind: 'profile.bulk_stop', verb: 'Stopped profiles in bulk' },
  'cookies.export': { kind: 'cookies.export', verb: 'Exported cookies from' },
  'diagnostics.run': { kind: 'diagnostics.run', verb: 'Ran diagnostics on' },
  'trash.delete_forever': { kind: 'trash.delete', verb: 'Emptied the trash' },
  'triggers.create': { kind: 'trigger.create', verb: 'Created a trigger' },
  'triggers.delete': { kind: 'trigger.delete', verb: 'Deleted a trigger' },
  'tags.attach': { kind: 'tag.attach', verb: 'Attached a tag to' },
  'tags.detach': { kind: 'tag.detach', verb: 'Removed a tag from' },
};

/** Tool names an operator would not want announced — reads and lists. */
export function isAnnounceableTool(tool: string): boolean {
  if (MCP_TOOL_LABELS[tool]) return true;
  // Anything ending in a read verb is a query, not an action.
  return !/\.(list|get|export_preserved|cleanup_preserved)$/.test(tool);
}
