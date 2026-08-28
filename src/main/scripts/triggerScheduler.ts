// Trigger scheduler (Sprint 4.3): fires scripts on schedules and events.
//
// - schedule triggers: a 30 s tick matches simple cron-like schedules —
//   "interval:<minutes>" or "daily:HH:MM" — no external cron dependency.
// - event triggers: profileManager exposes an onProfileStatusChange hook;
//   profile_started / profile_stopped events run their bound script with the
//   profile id. Disabled triggers never fire.
import { getDb } from '../db';
import { logger } from '../util/logger';
import { runScript } from './scriptEngine';

export type TriggerType = 'schedule' | 'event';
export type TriggerEvent = 'profile_started' | 'profile_stopped';

export interface TriggerRow {
  id: string;
  name: string;
  script_id: string;
  type: TriggerType;
  schedule: string | null;
  event: TriggerEvent | null;
  enabled: boolean;
  last_fired_at: number | null;
  created_at: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 30_000;

interface ParsedSchedule {
  kind: 'interval' | 'daily';
  intervalMs?: number;
  hour?: number;
  minute?: number;
}

/** Parse "interval:<minutes>" or "daily:HH:MM" (pure, unit-tested). */
export function parseSchedule(schedule: string): ParsedSchedule | null {
  const parts = schedule.split(':').map((s) => s.trim());
  if (parts[0] === 'interval') {
    const minutes = Number(parts[1]);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return { kind: 'interval', intervalMs: minutes * 60_000 };
  }
  if (parts[0] === 'daily') {
    const hour = Number(parts[1]);
    const minute = Number(parts[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    return { kind: 'daily', hour, minute };
  }
  return null;
}

export function isValidSchedule(schedule: string): boolean {
  return parseSchedule(schedule) !== null;
}

/**
 * Pure matcher: is the trigger due at `nowMs`, given the last fired time?
 *  - interval: now - lastFired >= interval (never fired = due immediately)
 *  - daily: HH:MM within the current tick window and not already fired today
 */
export function isDue(
  parsed: ParsedSchedule,
  lastFiredAt: number | null,
  nowMs: number,
  tickWindowMs = TICK_MS
): boolean {
  if (parsed.kind === 'interval') {
    if (lastFiredAt === null) return true;
    return nowMs - lastFiredAt >= (parsed.intervalMs ?? 0);
  }
  // daily
  const d = new Date(nowMs);
  const minutesNow = d.getHours() * 60 + d.getMinutes();
  const minutesTarget = (parsed.hour ?? 0) * 60 + (parsed.minute ?? 0);
  if (minutesNow < minutesTarget || minutesNow >= minutesTarget + tickWindowMs / 60_000) {
    return false;
  }
  if (lastFiredAt !== null) {
    const last = new Date(lastFiredAt);
    const sameDay = last.getFullYear() === d.getFullYear() && last.getMonth() === d.getMonth() && last.getDate() === d.getDate();
    if (sameDay) return false;
  }
  return true;
}

function loadTriggers(): TriggerRow[] {
  return getDb()
    .prepare('SELECT * FROM triggers WHERE enabled = 1')
    .all() as unknown as TriggerRow[];
}

function fireDueScheduleTriggers(): void {
  const now = Date.now();
  let triggers: TriggerRow[];
  try {
    triggers = loadTriggers();
  } catch (err) {
    logger.warn('trigger scheduler db read failed', { error: (err as Error).message });
    return;
  }
  for (const t of triggers) {
    if (t.type !== 'schedule' || !t.schedule) continue;
    const parsed = parseSchedule(t.schedule);
    if (!parsed) continue;
    if (!isDue(parsed, t.last_fired_at, now)) continue;
    // Fire once per due window.
    getDb()
      .prepare('UPDATE triggers SET last_fired_at = ? WHERE id = ?')
      .run(now, t.id);
    try {
      runScript(t.script_id, []);
      logger.info('trigger fired (schedule)', { trigger: t.id, script: t.script_id });
    } catch (err) {
      logger.warn('trigger script run failed', { trigger: t.id, error: (err as Error).message });
    }
  }
}

/** Event hook: called by profileManager on every status change. */
export function onProfileStatusChanged(profileId: string, status: string): void {
  const event = status === 'running' ? 'profile_started' : status === 'closed' ? 'profile_stopped' : null;
  if (!event) return;
  let triggers: TriggerRow[];
  try {
    triggers = loadTriggers();
  } catch {
    return;
  }
  for (const t of triggers) {
    if (t.type !== 'event' || t.event !== event) continue;
    try {
      runScript(t.script_id, [profileId]);
      logger.info('trigger fired (event)', { trigger: t.id, event, profileId });
    } catch (err) {
      logger.warn('trigger script run failed', { trigger: t.id, error: (err as Error).message });
    }
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      fireDueScheduleTriggers();
    } catch (err) {
      logger.warn('trigger tick failed', { error: (err as Error).message });
    }
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ---------------------------------------------------------------------------
// Triggers CRUD
// ---------------------------------------------------------------------------

export function listTriggers(): TriggerRow[] {
  return getDb()
    .prepare('SELECT * FROM triggers ORDER BY created_at DESC')
    .all() as unknown as TriggerRow[];
}

export interface TriggerInput {
  name: string;
  script_id: string;
  type: TriggerType;
  schedule?: string;
  event?: TriggerEvent;
}

export function createTrigger(input: TriggerInput): { ok: true; data: { id: string } } | { ok: false; code: string; msg: string } {
  const script = getDb().prepare('SELECT id FROM scripts WHERE id = ?').get(input.script_id);
  if (!script) return { ok: false, code: 'NOT_FOUND', msg: 'script not found' };
  if (input.type === 'schedule') {
    if (!input.schedule || !isValidSchedule(input.schedule)) {
      return { ok: false, code: 'INVALID_INPUT', msg: 'schedule must be "interval:<minutes>" or "daily:HH:MM"' };
    }
  } else if (input.type === 'event') {
    if (input.event !== 'profile_started' && input.event !== 'profile_stopped') {
      return { ok: false, code: 'INVALID_INPUT', msg: 'event must be profile_started or profile_stopped' };
    }
  } else {
    return { ok: false, code: 'INVALID_INPUT', msg: 'type must be schedule or event' };
  }
  const id = 'trg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  getDb()
    .prepare('INSERT INTO triggers (id, name, script_id, type, schedule, event, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run(id, input.name, input.script_id, input.type, input.schedule ?? null, input.event ?? null, Date.now());
  return { ok: true, data: { id } };
}

export function updateTrigger(
  id: string,
  updates: { name?: string; schedule?: string; event?: TriggerEvent }
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.schedule !== undefined) {
    if (!isValidSchedule(updates.schedule)) return false;
    sets.push('schedule = ?');
    params.push(updates.schedule);
  }
  if (updates.event !== undefined) {
    if (updates.event !== 'profile_started' && updates.event !== 'profile_stopped') return false;
    sets.push('event = ?');
    params.push(updates.event);
  }
  if (sets.length === 0) return false;
  params.push(id);
  return getDb().prepare(`UPDATE triggers SET ${sets.join(', ')} WHERE id = ?`).run(...params).changes > 0;
}

export function setTriggerEnabled(id: string, enabled: boolean): boolean {
  return (
    getDb()
      .prepare('UPDATE triggers SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id).changes > 0
  );
}

export function deleteTrigger(id: string): boolean {
  return getDb().prepare('DELETE FROM triggers WHERE id = ?').run(id).changes > 0;
}