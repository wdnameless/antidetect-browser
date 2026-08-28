// Typing batcher for action mirroring (Sprint 3.2).
//
// Keystroke-by-keystroke replay is slow and detectable (unnatural event
// cadence). The master listener instead reports field value snapshots on
// change/blur, and this batcher coalesces rapid value updates into ONE replay
// per field per 300 ms window.

export interface TypingBatch {
  fieldKey: string;
  value: string;
}

export type BatchFlush = (batch: TypingBatch) => void;

export class InputDebouncer {
  private pending = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();
  private readonly windowMs: number;

  constructor(windowMs = 300) {
    this.windowMs = windowMs;
  }

  /** Record a value update for a field; schedules (or re-schedules) the flush. */
  push(fieldKey: string, value: string, flush: BatchFlush): void {
    const existing = this.pending.get(fieldKey);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pending.delete(fieldKey);
      flush({ fieldKey, value });
    }, this.windowMs);
    this.pending.set(fieldKey, { value, timer });
  }

  /** Flush one field immediately (e.g. on change/blur) and cancel its timer. */
  flushNow(fieldKey: string, flush: BatchFlush): boolean {
    const existing = this.pending.get(fieldKey);
    if (!existing) return false;
    clearTimeout(existing.timer);
    this.pending.delete(fieldKey);
    flush({ fieldKey, value: existing.value });
    return true;
  }

  /** Flush everything pending (session stop). */
  flushAll(flush: BatchFlush): void {
    for (const key of Array.from(this.pending.keys())) {
      this.flushNow(key, flush);
    }
  }

  /** Cancel everything without flushing. */
  clear(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  get pendingKeys(): string[] {
    return Array.from(this.pending.keys());
  }

  get size(): number {
    return this.pending.size;
  }
}

/**
 * Dedup helper: master events must not be re-injected into the master itself,
 * and (with isSlave flags) slave replays must never cascade. Pure predicate.
 */
export function shouldForwardEvent(sourceProfileId: string, targetProfileId: string, isSlavePage: boolean): boolean {
  // Never forward to the event source (master) and never forward into a page
  // already replaying a mirrored action.
  return sourceProfileId !== targetProfileId && !isSlavePage;
}