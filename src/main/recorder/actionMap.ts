// Flow recorder action mapping (Wave 2, gap B1): pure capture-record -> flow
// node mapper. No I/O, no side effects — fully unit-testable.
//
// Capture records travel from the injected page listener through the recorder
// bridge as plain JSON (see listener.ts / bridge.ts). This module maps a record
// to a `FlowNode` that satisfies the real node schemas in
// `src/main/flows/types.ts` and is shaped exactly like a node created from the
// FlowCanvas palette (same config fields, same id convention), so a recorded
// step is indistinguishable from a hand-made one.
import type { FlowNode, FlowNodeType } from '../flows/types';

/** Record kinds the capture surface can report (shared wire contract). */
export type CaptureRecordKind = 'click' | 'type' | 'navigate' | 'scroll' | 'key' | 'wait';

/**
 * Shared capture contract: `{ kind: 'click'|'type'|'navigate'|'scroll'|'key';
 * selector: string|null; text?: string; url?: string; button?: number|string }`.
 * `wait` is a renderer-originated record (element action picker).
 */
export interface CaptureRecord {
  kind: CaptureRecordKind;
  selector: string | null;
  text?: string;
  url?: string;
  button?: number | string;
  waitType?: 'time' | 'selector' | 'navigation';
  durationMs?: number;
  timeoutMs?: number;
}

export interface MapCapturedOptions {
  /** Prefer the human-input node variants (human_click / human_type). */
  human?: boolean;
  /** Node id override; defaults to the canvas convention `node-<type>-<ts>`. */
  id?: string;
}

/** Default node id, matching the FlowCanvas `addNode` convention. */
export function recordedNodeId(type: FlowNodeType, now = Date.now()): string {
  return `node-${type}-${now.toString().slice(-4)}`;
}

/** Display names matching the FlowCanvas palette labels. */
const RECORDED_LABELS: Record<string, string> = {
  navigate: 'Navigate',
  click: 'Click Element',
  human_click: 'Human Click',
  type: 'Type Text',
  human_type: 'Human Type',
  wait: 'Wait',
};

/**
 * Map a captured action to a flow node. Returns `null` for records that cannot
 * be expressed as a step: untargeted scrolls, lone modifier keys, records with
 * no selector (click/type need a target), url-less navigations, and any
 * unrecognised kind.
 */
export function mapCapturedAction(
  record: CaptureRecord,
  opts: MapCapturedOptions = {}
): FlowNode | null {
  const human = opts.human === true;

  // A url-bearing record is a navigation, whatever the reported kind.
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (url) {
    const node: FlowNode = {
      id: opts.id ?? recordedNodeId('navigate'),
      type: 'navigate',
      name: RECORDED_LABELS.navigate,
      url,
      timeoutMs: 30000,
    };
    return node;
  }

  switch (record.kind) {
    case 'click': {
      if (!record.selector) return null;
      if (human) {
        const node: FlowNode = {
          id: opts.id ?? recordedNodeId('human_click'),
          type: 'human_click',
          name: RECORDED_LABELS.human_click,
          selector: record.selector,
          targetWidth: 40,
        };
        return node;
      }
      const node: FlowNode = {
        id: opts.id ?? recordedNodeId('click'),
        type: 'click',
        name: RECORDED_LABELS.click,
        selector: record.selector,
        waitForSelector: true,
        timeoutMs: 5000,
      };
      return node;
    }
    case 'type': {
      if (!record.selector) return null;
      if (human) {
        const node: FlowNode = {
          id: opts.id ?? recordedNodeId('human_type'),
          type: 'human_type',
          name: RECORDED_LABELS.human_type,
          selector: record.selector,
          text: record.text ?? '',
          allowTypos: false,
        };
        return node;
      }
      const node: FlowNode = {
        id: opts.id ?? recordedNodeId('type'),
        type: 'type',
        name: RECORDED_LABELS.type,
        selector: record.selector,
        text: record.text ?? '',
        delayMs: 25,
      };
      return node;
    }
    case 'navigate': {
      // url-less navigate records are inert (the pre-check above handled the
      // url-bearing ones).
      if (!url) return null;
      const node: FlowNode = {
        id: opts.id ?? recordedNodeId('navigate'),
        type: 'navigate',
        name: RECORDED_LABELS.navigate,
        url,
        timeoutMs: 30000,
      };
      return node;
    }
    case 'wait': {
      if (record.waitType === 'selector' && record.selector) {
        const node: FlowNode = {
          id: opts.id ?? recordedNodeId('wait'),
          type: 'wait',
          name: RECORDED_LABELS.wait,
          waitType: 'selector',
          selector: record.selector,
          timeoutMs: record.timeoutMs ?? 10000,
        };
        return node;
      }
      if (record.waitType === 'navigation') {
        const node: FlowNode = {
          id: opts.id ?? recordedNodeId('wait'),
          type: 'wait',
          name: RECORDED_LABELS.wait,
          waitType: 'navigation',
          timeoutMs: record.timeoutMs ?? 30000,
        };
        return node;
      }
      const node: FlowNode = {
        id: opts.id ?? recordedNodeId('wait'),
        type: 'wait',
        name: RECORDED_LABELS.wait,
        waitType: 'time',
        durationMs: record.durationMs ?? 2000,
      };
      return node;
    }
    case 'scroll':
    case 'key':
    default:
      // Untargeted scroll, lone modifier key, or an unrecognised record kind —
      // none of these can become a step.
      return null;
  }
}

/**
 * Folds successive `key`/`type` capture records targeting the same element into
 * one typing burst. Pure and stateful: feed records in arrival order with a
 * monotonic timestamp; `push` returns the records that should be emitted NOW
 * (a folded burst when it closes, pass-through otherwise), so a burst of
 * keystrokes materialises as exactly ONE `type` node instead of one node per
 * keystroke.
 */
export class TypingCoalescer {
  private pending: { selector: string | null; text: string } | null = null;
  private lastSeen = 0;

  constructor(private readonly windowMs: number = 250) {}

  /** Records to emit now; empty while a burst is still accumulating. */
  push(record: CaptureRecord, now: number): CaptureRecord[] {
    if (record.kind === 'key') {
      const text = record.text ?? '';
      // Modifier / special keys (Shift, Enter, ...) carry no single character —
      // ignore them without closing the current burst.
      if (text.length !== 1) return [];
      if (
        this.pending &&
        this.pending.selector === record.selector &&
        now - this.lastSeen <= this.windowMs
      ) {
        this.pending.text += text;
        this.lastSeen = now;
        return [];
      }
      const flushed = this.flush();
      this.pending = { selector: record.selector, text };
      this.lastSeen = now;
      return flushed;
    }
    if (record.kind === 'type') {
      // A change/blur report carries the field's final value — it supersedes
      // any accumulated keystrokes for the same target.
      if (this.pending && this.pending.selector === record.selector) {
        this.pending = null;
        this.lastSeen = 0;
        return [record];
      }
      const flushed = this.flush();
      return [...flushed, record];
    }
    // Any other event (click, navigate, ...) closes the burst first so the
    // emitted node order matches what the operator did.
    return [...this.flush(), record];
  }

  /** Close a pending burst (recording stop, panel close). */
  flush(): CaptureRecord[] {
    if (!this.pending) return [];
    const folded: CaptureRecord = {
      kind: 'type',
      selector: this.pending.selector,
      text: this.pending.text,
    };
    this.pending = null;
    this.lastSeen = 0;
    return [folded];
  }
}
