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
