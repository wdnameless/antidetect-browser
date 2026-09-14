export interface SseLogEntry {
  line: string;
  created_at?: number;
  nodeId?: string;
  durationMs?: number;
  screenshot?: string;
  raw: string;
}

export interface SseEndEvent {
  event: 'end';
  status: 'finished' | 'error' | 'stop';
  code?: number;
  error?: string;
}

export type LiveRunStatus = 'idle' | 'starting' | 'running' | 'finished' | 'error' | 'stopped';

/**
 * Extracts screenshot reference from log line or JSON.
 * Supports:
 * - JSON: { "screenshot": "path/or/base64", ... } or { "screenshotPath": "..." }
 * - Text: [SCREENSHOT] path or Screenshot: path
 * - Data URLs: data:image/...
 */
export function extractScreenshotRef(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Try parsing JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.screenshot === 'string' && parsed.screenshot) {
        return parsed.screenshot;
      }
      if (typeof parsed.screenshotPath === 'string' && parsed.screenshotPath) {
        return parsed.screenshotPath;
      }
      if (typeof parsed.image === 'string' && parsed.image) {
        return parsed.image;
      }
    } catch {
      // not valid json
    }
  }

  // Regex patterns
  // 1. data:image/... URL
  const dataUrlMatch = trimmed.match(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/);
  if (dataUrlMatch) {
    return dataUrlMatch[0];
  }

  // 2. [SCREENSHOT] <path> or screenshot=<path> or [screenshot] <path>
  const tagMatch = trimmed.match(/(?:\[SCREENSHOT\]\s*|screenshot[:=]\s*|\bscreenshot\s+saved\s+to\s+)([^\s"',;]+)/i);
  if (tagMatch && tagMatch[1]) {
    return tagMatch[1];
  }

  return null;
}

/**
 * Extracts node ID and duration from span format or node=<id>
 * Examples:
 * - [SPAN] node-1 duration=120ms
 * - [SPAN_START] node-1
 * - [SPAN_END] node-1 duration: 150ms
 * - node=node-1
 * - [node-1]
 */
export function extractNodeTiming(raw: string): { nodeId?: string; durationMs?: number } {
  if (!raw) return {};
  let nodeId: string | undefined;
  let durationMs: number | undefined;

  // Node id: node=<id> or node: <id> or [SPAN...] <id>
  const nodeMatch = raw.match(/node[=:]\s*([a-zA-Z0-9_-]+)/i) || raw.match(/\[SPAN(?:_START|_END)?\]\s*([a-zA-Z0-9_-]+)/i);
  if (nodeMatch && nodeMatch[1]) {
    nodeId = nodeMatch[1];
  }

  // Duration: duration=123ms or duration: 123ms or took 123ms or in 123ms
  const durMatch = raw.match(/(?:duration[=:]\s*|took\s+|in\s+)(\d+(?:\.\d+)?)\s*(ms|s)?/i);
  if (durMatch && durMatch[1]) {
    const val = parseFloat(durMatch[1]);
    const unit = (durMatch[2] || 'ms').toLowerCase();
    durationMs = unit === 's' ? Math.round(val * 1000) : Math.round(val);
  }

  return { nodeId, durationMs };
}

/**
 * Parses a raw line from SSE data stream.
 * SSE event can be:
 * - JSON: {"line": "...", "created_at": 12345}
 * - JSON: {"event": "end", "status": "finished"}
 * - Raw string
 */
export function parseSseLine(payload: string): { log?: SseLogEntry; end?: SseEndEvent } | null {
  if (!payload || !payload.trim()) return null;
  const trimmed = payload.trim();

  // Check if it's JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.event === 'end') {
        const rawStatus = String(obj.status || '').toLowerCase();
        let status: 'finished' | 'error' | 'stop' = 'finished';
        if (rawStatus === 'error' || rawStatus === 'failed') {
          status = 'error';
        } else if (rawStatus === 'stop' || rawStatus === 'stopped') {
          status = 'stop';
        }
        return {
          end: {
            event: 'end',
            status,
            code: typeof obj.code === 'number' ? obj.code : undefined,
            error: typeof obj.error === 'string' ? obj.error : undefined
          }
        };
      }

      // Check if it's a log object { line, created_at, ... }
      const lineText = typeof obj.line === 'string' ? obj.line : (typeof obj.message === 'string' ? obj.message : JSON.stringify(obj));
      const timing = extractNodeTiming(lineText);
      const screenshot = extractScreenshotRef(trimmed) || extractScreenshotRef(lineText);

      return {
        log: {
          line: lineText,
          created_at: typeof obj.created_at === 'number' ? obj.created_at : Date.now(),
          nodeId: timing.nodeId || (typeof obj.nodeId === 'string' ? obj.nodeId : undefined),
          durationMs: timing.durationMs ?? (typeof obj.durationMs === 'number' ? obj.durationMs : undefined),
          screenshot: screenshot || undefined,
          raw: trimmed
        }
      };
    } catch {
      // Fall through to plain text
    }
  }

  const timing = extractNodeTiming(trimmed);
  const screenshot = extractScreenshotRef(trimmed);

  return {
    log: {
      line: trimmed,
      created_at: Date.now(),
      nodeId: timing.nodeId,
      durationMs: timing.durationMs,
      screenshot: screenshot || undefined,
      raw: trimmed
    }
  };
}

/**
 * Appends a log entry to existing list, enforcing the MAX_LOG_LINES cap (200).
 */
export const MAX_LOG_LINES = 200;

/**
 * Appends a log entry to existing list, enforcing the MAX_LOG_LINES cap (200).
 */

// ---------------------------------------------------------------
// Fleet run view: fold N task log streams into per-profile state.
//
// Pure, browser-free reduction (unit-testable). Consumes the SAME
// line parsing as the single-profile live run (parseSseLine /
// extractNodeTiming / reduceLogLines) — nothing is re-derived here.
// Progress is derived from [FLOW_SPAN_END] events against the flow
// document's node count, so a partial stream yields partial progress.
// ---------------------------------------------------------------

export type FleetProfileStatus = 'queued' | 'working' | 'finished' | 'error' | 'stopped';

export interface FleetProfileState {
  taskUuid: string;
  profileId: string;
  status: FleetProfileStatus;
  /** node id of the most recently started span (`[FLOW_SPAN_START]`) */
  currentNodeId: string | null;
  /** distinct nodes completed via `[FLOW_SPAN_END]` */
  completedCount: number;
  /** flow document node count this profile runs against */
  totalNodes: number;
  error: string | null;
  logs: SseLogEntry[];
  completedNodeIds: string[];
}

export interface FleetRunState {
  profiles: FleetProfileState[];
  /** true when every profile is terminal (finished/error/stopped) */
  finished: boolean;
}

export type FleetRunEvent =
  | {
      kind: 'init';
      taskUuid: string;
      profileId: string;
      totalNodes: number;
      /** concurrency used for the run; slotIndex < cap start working */
      activeSessionCap: number;
      /** 0-based position in the backend task list (dispatch order) */
      slotIndex: number;
      /** authoritative snapshot status from GET /api/task-groups/:id/tasks */
      snapshotStatus?: string;
    }
  | { kind: 'payload'; taskUuid: string; payload: string }
  | { kind: 'stopAll' }
  | { kind: 'clearLogs'; taskUuid: string };

const SPAN_START_RE = /^\[FLOW_SPAN_START\]\s+([a-zA-Z0-9_-]+)/;
const SPAN_END_RE = /^\[FLOW_SPAN_END\]\s+([a-zA-Z0-9_-]+)/;

function computeFleetFinished(profiles: FleetProfileState[]): boolean {
  return (
    profiles.length > 0 &&
    profiles.every(
      p => p.status === 'finished' || p.status === 'error' || p.status === 'stopped'
    )
  );
}

function initialFleetStatus(
  ev: Extract<FleetRunEvent, { kind: 'init' }>
): FleetProfileStatus {
  const snap = ev.snapshotStatus;
  if (snap === 'finished') return 'finished';
  if (snap === 'error') return 'error';
  if (snap === 'stop') return 'stopped';
  // A task the coordinator has not picked up yet is queued, regardless of
  // its position, unless the snapshot already shows it working.
  if (snap === 'waiting') return 'queued';
  return ev.slotIndex < ev.activeSessionCap ? 'working' : 'queued';
}

/** Progress of one profile: nodes completed vs the flow document node count. */
export function fleetProgress(profile: FleetProfileState): {
  completed: number;
  total: number;
  fraction: number;
} {
  const total = Math.max(0, profile.totalNodes);
  const completed = Math.min(profile.completedCount, total);
  return { completed, total, fraction: total > 0 ? completed / total : 0 };
}

/**
 * Folds one SSE payload (raw `data:` text) or lifecycle event into the fleet
 * run state for the task it belongs to. Per-profile terminal statuses are
 * sticky: one profile failing never flips the others, and the run is only
 * `finished` when every profile is terminal.
 */
export function reduceFleetRunState(
  prev: FleetRunState | null,
  ev: FleetRunEvent
): FleetRunState {
  if (ev.kind === 'init') {
    const profiles = prev ? prev.profiles : [];
    if (profiles.some(p => p.taskUuid === ev.taskUuid)) {
      return prev ?? { profiles: [], finished: false };
    }
    const profile: FleetProfileState = {
      taskUuid: ev.taskUuid,
      profileId: ev.profileId,
      status: initialFleetStatus(ev),
      currentNodeId: null,
      completedCount: 0,
      totalNodes: ev.totalNodes,
      error: null,
      logs: [],
      completedNodeIds: [],
    };
    const next = [...profiles, profile];
    return { profiles: next, finished: computeFleetFinished(next) };
  }

  if (ev.kind === 'stopAll') {
    if (!prev) return { profiles: [], finished: false };
    const profiles = prev.profiles.map(p => {
      if (p.status === 'queued' || p.status === 'working') {
        return { ...p, status: 'stopped' as const };
      }
      return p;
    });
    return { profiles, finished: computeFleetFinished(profiles) };
  }

  if (ev.kind === 'clearLogs') {
    if (!prev) return { profiles: [], finished: false };
    const profiles = prev.profiles.map(p =>
      p.taskUuid === ev.taskUuid ? { ...p, logs: [] } : p
    );
    return { profiles, finished: prev.finished };
  }

  // payload — reuse the existing single-stream parsing
  if (!prev) return { profiles: [], finished: false };
  const parsed = parseSseLine(ev.payload);
  if (!parsed) return prev;
  const idx = prev.profiles.findIndex(p => p.taskUuid === ev.taskUuid);
  if (idx === -1) return prev;
  const profile = prev.profiles[idx];

  const commit = (next: FleetProfileState): FleetRunState => {
    const profiles = [...prev.profiles];
    profiles[idx] = next;
    return { profiles, finished: computeFleetFinished(profiles) };
  };

  if (parsed.end) {
    // Terminal statuses are sticky — a late event (e.g. the backend's
    // group-stop `error` after a local stop) must not overwrite a stopped row.
    if (profile.status === 'queued' || profile.status === 'working') {
      const status: FleetProfileStatus =
        parsed.end.status === 'error'
          ? 'error'
          : parsed.end.status === 'stop'
          ? 'stopped'
          : 'finished';
      return commit({
        ...profile,
        status,
        error: parsed.end.status === 'error' ? parsed.end.error ?? null : profile.error,
      });
    }
    return prev;
  }

  if (parsed.log) {
    const entry = parsed.log;
    const next: FleetProfileState = {
      ...profile,
      // Receiving any log line means the worker is actually running.
      status: profile.status === 'queued' ? 'working' : profile.status,
      logs: reduceLogLines(profile.logs, entry),
      completedNodeIds: [...profile.completedNodeIds],
      completedCount: profile.completedCount,
    };
    const line = entry.line || '';
    const startMatch = SPAN_START_RE.exec(line);
    if (startMatch) {
      next.currentNodeId = startMatch[1];
    }
    const endMatch = SPAN_END_RE.exec(line);
    if (endMatch && !next.completedNodeIds.includes(endMatch[1])) {
      next.completedNodeIds.push(endMatch[1]);
      next.completedCount = next.completedNodeIds.length;
    }
    return commit(next);
  }

  return prev;
}

export function reduceLogLines(current: SseLogEntry[], next: SseLogEntry, cap: number = MAX_LOG_LINES): SseLogEntry[] {
  const updated = [...current, next];
  if (updated.length > cap) {
    return updated.slice(updated.length - cap);
  }
  return updated;
}

/**
 * Calculates whether the container should auto-scroll down.
 * If user has scrolled up by more than threshold (default 20px), auto-scroll is disabled.
 */
export function shouldAutoScroll(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = 20
): boolean {
  if (scrollHeight <= clientHeight) return true;
  const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
  return distanceFromBottom <= threshold;
}
