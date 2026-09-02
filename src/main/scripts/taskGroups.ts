import { randomUUID } from 'crypto';
import { getDb } from '../db';

export type TaskGroupStatus = 'waiting' | 'working' | 'finished' | 'error' | 'stop';
export type TaskStatus = 'waiting' | 'working' | 'finished' | 'error' | 'stop';

export interface TaskGroup {
  id: string;
  name: string;
  script_id: string;
  profile_ids: string[];
  active_session_cap: number;
  per_task_timeout_ms: number;
  repeat_count: number;
  randomize_profile_order: boolean;
  time_window_cron?: string | null;
  status: TaskGroupStatus;
  created_at: number;
  updated_at: number;
}

export interface Task {
  uuid: string;
  group_id: string;
  profile_id: string;
  script_id: string;
  status: TaskStatus;
  attempts: number;
  repeat_count: number;
  timeout_ms: number;
  next_run_at: number;
  created_at: number;
  updated_at: number;
  finished_at?: number | null;
  error?: string | null;
}

export interface TaskRun {
  id: string;
  task_uuid: string;
  attempt: number;
  status: TaskStatus;
  log_tail?: string | null;
  started_at: number;
  finished_at?: number | null;
  error?: string | null;
}

export interface TaskLog {
  id: number;
  task_uuid: string;
  run_id?: string | null;
  line: string;
  created_at: number;
}

export interface CreateTaskGroupParams {
  name: string;
  script_id: string;
  profile_ids: string[];
  active_session_cap?: number;
  per_task_timeout_ms?: number;
  repeat_count?: number;
  randomize_profile_order?: boolean;
  time_window_cron?: string | null;
}

interface TaskGroupDbRow {
  id: string;
  name: string;
  script_id: string;
  profile_ids: string;
  active_session_cap: number;
  per_task_timeout_ms: number;
  repeat_count: number;
  randomize_profile_order: number;
  time_window_cron?: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

interface TaskDbRow {
  uuid: string;
  group_id: string;
  profile_id: string;
  script_id: string;
  status: string;
  attempts: number;
  repeat_count: number;
  timeout_ms: number;
  next_run_at: number;
  created_at: number;
  updated_at: number;
  finished_at?: number | null;
  error?: string | null;
}

interface TaskRunDbRow {
  id: string;
  task_uuid: string;
  attempt: number;
  status: string;
  log_tail?: string | null;
  started_at: number;
  finished_at?: number | null;
  error?: string | null;
}

interface TaskLogDbRow {
  id: number;
  task_uuid: string;
  run_id?: string | null;
  line: string;
  created_at: number;
}

export function createTaskGroup(params: CreateTaskGroupParams): TaskGroup {
  const db = getDb();
  const id = 'tg_' + randomUUID();
  const now = Date.now();
  const activeSessionCap = Math.max(1, params.active_session_cap ?? 1);
  const perTaskTimeoutMs = Math.max(1000, params.per_task_timeout_ms ?? 60000);
  const repeatCount = Math.max(0, params.repeat_count ?? 0);
  const randomize = Boolean(params.randomize_profile_order);
  const timeWindowCron = params.time_window_cron ?? null;

  db.prepare(`
    INSERT INTO task_groups (
      id, name, script_id, profile_ids, active_session_cap,
      per_task_timeout_ms, repeat_count, randomize_profile_order,
      time_window_cron, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)
  `).run(
    id,
    params.name,
    params.script_id,
    JSON.stringify(params.profile_ids),
    activeSessionCap,
    perTaskTimeoutMs,
    repeatCount,
    randomize ? 1 : 0,
    timeWindowCron,
    now,
    now
  );
  const insertTaskStmt = db.prepare(`
    INSERT INTO tasks (
      uuid, group_id, profile_id, script_id, status,
      attempts, repeat_count, timeout_ms, next_run_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'waiting', 0, ?, ?, ?, ?, ?)
  `);
  let profileIdsToSchedule = [...params.profile_ids];
  if (randomize) {
    for (let i = profileIdsToSchedule.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [profileIdsToSchedule[i], profileIdsToSchedule[j]] = [profileIdsToSchedule[j], profileIdsToSchedule[i]];
    }
  }

  for (const profileId of profileIdsToSchedule) {
    const taskUuid = randomUUID();
    insertTaskStmt.run(
      taskUuid,
      id,
      profileId,
      params.script_id,
      repeatCount,
      perTaskTimeoutMs,
      now,
      now,
      now
    );
  }

  return {
    id,
    name: params.name,
    script_id: params.script_id,
    profile_ids: params.profile_ids,
    active_session_cap: activeSessionCap,
    per_task_timeout_ms: perTaskTimeoutMs,
    repeat_count: repeatCount,
    randomize_profile_order: randomize,
    time_window_cron: timeWindowCron,
    status: 'waiting',
    created_at: now,
    updated_at: now,
  };
}

export function getTaskGroup(id: string): TaskGroup | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as TaskGroupDbRow | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    script_id: String(row.script_id),
    profile_ids: JSON.parse(String(row.profile_ids || '[]')),
    active_session_cap: Number(row.active_session_cap) || 1,
    per_task_timeout_ms: Number(row.per_task_timeout_ms) || 60000,
    repeat_count: Number(row.repeat_count) || 0,
    randomize_profile_order: Boolean(row.randomize_profile_order),
    time_window_cron: row.time_window_cron ? String(row.time_window_cron) : null,
    status: String(row.status) as TaskGroupStatus,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
  };
}

export function listTaskGroups(): TaskGroup[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM task_groups ORDER BY created_at DESC').all() as TaskGroupDbRow[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    script_id: String(row.script_id),
    profile_ids: JSON.parse(String(row.profile_ids || '[]')),
    active_session_cap: Number(row.active_session_cap) || 1,
    per_task_timeout_ms: Number(row.per_task_timeout_ms) || 60000,
    repeat_count: Number(row.repeat_count) || 0,
    randomize_profile_order: Boolean(row.randomize_profile_order),
    time_window_cron: row.time_window_cron ? String(row.time_window_cron) : null,
    status: String(row.status) as TaskGroupStatus,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
  }));
}

export function updateTaskGroupStatus(id: string, status: TaskGroupStatus): void {
  const db = getDb();
  db.prepare('UPDATE task_groups SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
}

export function getGroupTasks(groupId: string): Task[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tasks WHERE group_id = ? ORDER BY created_at ASC').all(groupId) as TaskDbRow[];
  return rows.map((row) => ({
    uuid: String(row.uuid),
    group_id: String(row.group_id),
    profile_id: String(row.profile_id),
    script_id: String(row.script_id),
    status: String(row.status) as TaskStatus,
    attempts: Number(row.attempts) || 0,
    repeat_count: Number(row.repeat_count) || 0,
    timeout_ms: Number(row.timeout_ms) || 60000,
    next_run_at: Number(row.next_run_at) || 0,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
    finished_at: row.finished_at ? Number(row.finished_at) : null,
    error: row.error ? String(row.error) : null,
  }));
}

export function getTaskByUuid(uuid: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE uuid = ?').get(uuid) as TaskDbRow | undefined;
  if (!row) return null;
  return {
    uuid: String(row.uuid),
    group_id: String(row.group_id),
    profile_id: String(row.profile_id),
    script_id: String(row.script_id),
    status: String(row.status) as TaskStatus,
    attempts: Number(row.attempts) || 0,
    repeat_count: Number(row.repeat_count) || 0,
    timeout_ms: Number(row.timeout_ms) || 60000,
    next_run_at: Number(row.next_run_at) || 0,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
    finished_at: row.finished_at ? Number(row.finished_at) : null,
    error: row.error ? String(row.error) : null,
  };
}
export function updateTaskProgress(
  uuid: string,
  updates: {
    status: TaskStatus;
    attempts?: number;
    finished_at?: number | null;
    error?: string | null;
    next_run_at?: number;
  }
): void {
  const db = getDb();
  const now = Date.now();
  const existing = getTaskByUuid(uuid);
  if (!existing) return;

  const attempts = updates.attempts !== undefined ? updates.attempts : existing.attempts;
  const finishedAt = updates.finished_at !== undefined ? updates.finished_at : existing.finished_at;
  const error = updates.error !== undefined ? updates.error : existing.error;
  const nextRunAt = updates.next_run_at !== undefined ? updates.next_run_at : existing.next_run_at;

  db.prepare(`
    UPDATE tasks
    SET status = ?, attempts = ?, finished_at = ?, error = ?, next_run_at = ?, updated_at = ?
    WHERE uuid = ?
  `).run(updates.status, attempts, finishedAt, error, nextRunAt, now, uuid);
}

export function insertTaskRun(run: {
  id: string;
  task_uuid: string;
  attempt: number;
  status: TaskStatus;
  started_at: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO task_runs (id, task_uuid, attempt, status, started_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(run.id, run.task_uuid, run.attempt, run.status, run.started_at);
}

export function updateTaskRun(
  id: string,
  updates: { status: TaskStatus; log_tail?: string; finished_at: number; error?: string | null }
): void {
  const db = getDb();
  db.prepare(`
    UPDATE task_runs
    SET status = ?, log_tail = ?, finished_at = ?, error = ?
    WHERE id = ?
  `).run(updates.status, updates.log_tail ?? null, updates.finished_at, updates.error ?? null, id);
}

export function getTaskRuns(taskUuid: string): TaskRun[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM task_runs WHERE task_uuid = ? ORDER BY started_at ASC').all(taskUuid) as TaskRunDbRow[];
  return rows.map((row) => ({
    id: String(row.id),
    task_uuid: String(row.task_uuid),
    attempt: Number(row.attempt) || 1,
    status: String(row.status) as TaskStatus,
    log_tail: row.log_tail ? String(row.log_tail) : null,
    started_at: Number(row.started_at) || 0,
    finished_at: row.finished_at ? Number(row.finished_at) : null,
    error: row.error ? String(row.error) : null,
  }));
}

export function appendTaskLog(taskUuid: string, line: string, runId?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO task_logs (task_uuid, run_id, line, created_at)
    VALUES (?, ?, ?, ?)
  `).run(taskUuid, runId ?? null, line, Date.now());
}

export function getTaskLogs(taskUuid: string, limit = 500): TaskLog[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM task_logs WHERE task_uuid = ? ORDER BY id ASC LIMIT ?
  `).all(taskUuid, limit) as TaskLogDbRow[];
  return rows.map((r) => ({
    id: Number(r.id),
    task_uuid: String(r.task_uuid),
    run_id: r.run_id ? String(r.run_id) : null,
    line: String(r.line),
    created_at: Number(r.created_at) || 0,
  }));
}
