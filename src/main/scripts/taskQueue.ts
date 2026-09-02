import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { getDb } from '../db';
import { logger } from '../util/logger';
import {
  invokeScriptTask,
  TaskInvocationHandle,
} from './scriptEngine';
import {
  getTaskGroup,
  updateTaskGroupStatus,
  appendTaskLog,
  insertTaskRun,
  updateTaskRun,
  TaskStatus,
} from './taskGroups';

export function isWithinCronWindow(cronExpr: string, date: Date = new Date()): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return true;

  const [minPart, hourPart, domPart, monthPart, dowPart] = parts;

  function matchField(field: string, value: number): boolean {
    if (field === '*') return true;
    for (const piece of field.split(',')) {
      if (piece.includes('/')) {
        const [sub, stepStr] = piece.split('/');
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) return false;
        let start = 0;
        let end = 59;
        if (sub !== '*') {
          if (sub.includes('-')) {
            const [s, e] = sub.split('-').map(Number);
            start = s;
            end = e;
          } else {
            start = Number(sub);
          }
        }
        if (value >= start && value <= end && (value - start) % step === 0) return true;
      } else if (piece.includes('-')) {
        const [start, end] = piece.split('-').map(Number);
        if (value >= start && value <= end) return true;
      } else {
        if (Number(piece) === value) return true;
      }
    }
    return false;
  }

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dayOfWeek = date.getDay(); // 0-6 (Sun=0)

  if (!matchField(minPart, minute)) return false;
  if (!matchField(hourPart, hour)) return false;
  if (!matchField(domPart, dayOfMonth)) return false;
  if (!matchField(monthPart, month)) return false;
  if (!matchField(dowPart, dayOfWeek)) return false;

  return true;
}
export function isWithinTimeWindow(windowExpr: string, date: Date = new Date()): boolean {
  const trimmed = windowExpr.trim();
  const rangeMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (rangeMatch) {
    const startH = parseInt(rangeMatch[1], 10);
    const startM = parseInt(rangeMatch[2], 10);
    const endH = parseInt(rangeMatch[3], 10);
    const endM = parseInt(rangeMatch[4], 10);

    const curMinutes = date.getHours() * 60 + date.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return curMinutes >= startMinutes && curMinutes <= endMinutes;
    } else {
      // Overnight window e.g. 20:00-04:00
      return curMinutes >= startMinutes || curMinutes <= endMinutes;
    }
  }

  return isWithinCronWindow(trimmed, date);
}

export { TaskQueueCoordinator as TaskQueue };

export function shuffleProfiles<T>(array: T[], randomFn: () => number = Math.random): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function computeBackoffDelay(attempt: number, baseMs = 2000): number {
  const cappedAttempt = Math.min(attempt, 6);
  return Math.min(baseMs * Math.pow(2, cappedAttempt - 1), 60000);
}

export interface LiveTaskStream {
  emitter: EventEmitter;
  unsubscribe: () => void;
}

interface GroupRow {
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

interface TaskRow {
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

export class TaskQueueCoordinator extends EventEmitter {
  private activeHandles = new Map<string, TaskInvocationHandle>();
  private activeGroupSessionCount = new Map<string, number>();
  private liveStreams = new Map<string, Set<EventEmitter>>();
  private loopTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(options?: { pollIntervalMs?: number }) {
    super();
    this.startLoop(options?.pollIntervalMs ?? 500);
  }

  public getActiveCount(groupId?: string): number {
    if (groupId) {
      return this.activeGroupSessionCount.get(groupId) || 0;
    }
    return this.activeHandles.size;
  }

  public startLoop(intervalMs = 500): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.loopTimer.unref();
  }

  public stopLoop(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  public destroy(): void {
    this.stopLoop();
    for (const handle of this.activeHandles.values()) {
      try {
        void handle.terminate();
      } catch {}
    }
    this.activeHandles.clear();
    this.activeGroupSessionCount.clear();
    this.liveStreams.clear();
    this.removeAllListeners();
  }

  public subscribeLogs(taskUuid: string): LiveTaskStream {
    let set = this.liveStreams.get(taskUuid);
    if (!set) {
      set = new Set();
      this.liveStreams.set(taskUuid, set);
    }
    const emitter = new EventEmitter();
    set.add(emitter);

    const unsubscribe = () => {
      const s = this.liveStreams.get(taskUuid);
      if (s) {
        s.delete(emitter);
        if (s.size === 0) {
          this.liveStreams.delete(taskUuid);
        }
      }
    };

    return { emitter, unsubscribe };
  }

  public broadcastLog(taskUuid: string, line: string): void {
    const s = this.liveStreams.get(taskUuid);
    if (s) {
      for (const em of s) {
        try {
          em.emit('log', line);
        } catch {}
      }
    }
  }

  public broadcastEvent(taskUuid: string, event: 'done' | 'error', payload: unknown): void {
    const s = this.liveStreams.get(taskUuid);
    if (s) {
      for (const em of s) {
        try {
          em.emit(event, payload);
        } catch {}
      }
    }
  }

  public async startGroup(groupId: string): Promise<void> {
    const group = getTaskGroup(groupId);
    if (!group) throw new Error(`Task group not found: ${groupId}`);

    const db = getDb();

    // Check if tasks already exist for this group
    const existingCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE group_id = ?').get(groupId) as { cnt: number }
    ).cnt;

    if (existingCount === 0) {
      let profiles = [...group.profile_ids];
      if (group.randomize_profile_order) {
        profiles = shuffleProfiles(profiles);
      }

      const now = Date.now();
      const insertTaskStmt = db.prepare(`
        INSERT INTO tasks (
          uuid, group_id, profile_id, script_id, status,
          attempts, repeat_count, timeout_ms, next_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'waiting', 0, ?, ?, ?, ?, ?)
      `);

      for (const pid of profiles) {
        const uuid = randomUUID();
        insertTaskStmt.run(
          uuid,
          groupId,
          pid,
          group.script_id,
          group.repeat_count,
          group.per_task_timeout_ms,
          now,
          now,
          now
        );
      }
    } else {
      // Resume stopped or error tasks if restarting
      db.prepare(`
        UPDATE tasks
        SET status = 'waiting', next_run_at = ?, updated_at = ?
        WHERE group_id = ? AND status IN ('stop', 'waiting')
      `).run(Date.now(), Date.now(), groupId);
    }

    updateTaskGroupStatus(groupId, 'working');
    void this.tick();
  }

  public async stopGroup(groupId: string): Promise<void> {
    const db = getDb();
    const group = getTaskGroup(groupId);
    if (!group) return;

    // 1. Mark waiting tasks as stop
    db.prepare(`
      UPDATE tasks
      SET status = 'stop', updated_at = ?
      WHERE group_id = ? AND status = 'waiting'
    `).run(Date.now(), groupId);

    // 2. Terminate all active running workers belonging to this group
    const activeTasksInGroup = db.prepare(`
      SELECT uuid FROM tasks WHERE group_id = ? AND status = 'working'
    `).all(groupId) as Array<{ uuid: string }>;

    for (const { uuid } of activeTasksInGroup) {
      const handle = this.activeHandles.get(uuid);
      if (handle) {
        try {
          await handle.terminate();
        } catch {}
      }
      db.prepare(`
        UPDATE tasks
        SET status = 'stop', updated_at = ?, finished_at = ?
        WHERE uuid = ?
      `).run(Date.now(), Date.now(), uuid);

      this.activeHandles.delete(uuid);
      this.broadcastLog(uuid, '[SYSTEM] Task terminated due to group stop');
      this.broadcastEvent(uuid, 'error', { error: 'group stopped' });
    }

    this.activeGroupSessionCount.set(groupId, 0);
    updateTaskGroupStatus(groupId, 'stop');
  }

  public async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const db = getDb();
      const activeGroups = db.prepare(`
        SELECT * FROM task_groups WHERE status = 'working'
      `).all() as GroupRow[];

      for (const grp of activeGroups) {
        const groupId = String(grp.id);
        const cap = Number(grp.active_session_cap) || 1;
        const cron = grp.time_window_cron ? String(grp.time_window_cron) : null;

        // Check time window cron
        if (cron && !isWithinCronWindow(cron)) {
          // Outside window, do not dispatch new tasks for this group
          continue;
        }

        const currentRunning = this.activeGroupSessionCount.get(groupId) || 0;
        const availableSlots = cap - currentRunning;

        if (availableSlots <= 0) {
          continue;
        }

        const now = Date.now();
        // Fetch up to availableSlots tasks in 'waiting' state whose next_run_at <= now
        const waitingTasks = db.prepare(`
          SELECT * FROM tasks
          WHERE group_id = ? AND status = 'waiting' AND next_run_at <= ?
          ORDER BY next_run_at ASC, created_at ASC
          LIMIT ?
        `).all(groupId, now, availableSlots) as TaskRow[];

        for (const t of waitingTasks) {
          this.dispatchTask(grp, t);
        }
      }

      // Check for group completion
      for (const grp of activeGroups) {
        const groupId = String(grp.id);
        const remaining = db.prepare(`
          SELECT COUNT(*) as count FROM tasks
          WHERE group_id = ? AND status IN ('waiting', 'working')
        `).get(groupId) as { count: number };

        if (remaining.count === 0) {
          const errors = db.prepare(`
            SELECT COUNT(*) as count FROM tasks
            WHERE group_id = ? AND status = 'error'
          `).get(groupId) as { count: number };

          const finalStatus = errors.count > 0 ? 'error' : 'finished';
          updateTaskGroupStatus(groupId, finalStatus);
          this.emit('group-finished', groupId, finalStatus);
        }
      }
    } catch (err) {
      logger.error('Error in TaskQueueCoordinator tick', { err });
    } finally {
      this.isProcessing = false;
    }
  }

  private dispatchTask(grp: GroupRow, taskRow: TaskRow): void {
    const db = getDb();
    const taskUuid = String(taskRow.uuid);
    const groupId = String(grp.id);
    const attempt = (Number(taskRow.attempts) || 0) + 1;
    const now = Date.now();

    // Mark task working
    db.prepare(`
      UPDATE tasks
      SET status = 'working', attempts = ?, updated_at = ?
      WHERE uuid = ?
    `).run(attempt, now, taskUuid);

    const currentRunning = (this.activeGroupSessionCount.get(groupId) || 0) + 1;
    this.activeGroupSessionCount.set(groupId, currentRunning);

    const runId = 'tr_' + randomUUID();
    insertTaskRun({
      id: runId,
      task_uuid: taskUuid,
      attempt,
      status: 'working',
      started_at: now,
    });

    const timeoutMs = Number(taskRow.timeout_ms) || Number(grp.per_task_timeout_ms) || 60000;

    let handle: TaskInvocationHandle;
    try {
      handle = invokeScriptTask({
        taskUuid,
        scriptId: String(grp.script_id),
        profileId: String(taskRow.profile_id),
        timeoutMs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.finishTaskFailure(taskRow, runId, attempt, `Failed to invoke script: ${msg}`, []);
      return;
    }
    let timer: NodeJS.Timeout | null = null;
    if (timeoutMs > 0 && timeoutMs < 2147483647) {
      timer = setTimeout(() => {
        try {
          void handle.terminate();
        } catch {}
        this.finishTaskFailure(taskRow, runId, attempt, `Task execution timed out after ${timeoutMs}ms`, capturedLogs);
      }, timeoutMs);
    }

    this.activeHandles.set(taskUuid, handle);

    const capturedLogs: string[] = [];

    handle.logStream.on('log', (line: string) => {
      capturedLogs.push(line);
      appendTaskLog(taskUuid, line, runId);
      this.broadcastLog(taskUuid, line);
    });

    handle.logStream.once('done', ({ logs }: { logs?: string[] }) => {
      clearTimeout(timer!);
      this.activeHandles.delete(taskUuid);
      const decr = Math.max(0, (this.activeGroupSessionCount.get(groupId) || 1) - 1);
      this.activeGroupSessionCount.set(groupId, decr);

      const allLogs = logs && logs.length > 0 ? logs : capturedLogs;
      const logTail = allLogs.slice(-20).join('\n');
      const finishedAt = Date.now();

      updateTaskRun(runId, {
        status: 'finished',
        log_tail: logTail,
        finished_at: finishedAt,
      });

      db.prepare(`
        UPDATE tasks
        SET status = 'finished', updated_at = ?, finished_at = ?, error = NULL
        WHERE uuid = ?
      `).run(finishedAt, finishedAt, taskUuid);

      this.broadcastEvent(taskUuid, 'done', { logs: allLogs });
      void this.tick();
    });

    handle.logStream.once('error', ({ error, logs }: { error: string; logs?: string[] }) => {
      clearTimeout(timer!);
      this.activeHandles.delete(taskUuid);
      const decr = Math.max(0, (this.activeGroupSessionCount.get(groupId) || 1) - 1);
      this.activeGroupSessionCount.set(groupId, decr);

      const allLogs = logs && logs.length > 0 ? logs : capturedLogs;
      this.finishTaskFailure(taskRow, runId, attempt, error, allLogs);
      void this.tick();
    });
  }

  private finishTaskFailure(
    taskRow: TaskRow,
    runId: string,
    attempt: number,
    error: string,
    logs: string[]
  ): void {
    const db = getDb();
    const taskUuid = String(taskRow.uuid);
    const repeatCount = Number(taskRow.repeat_count) || 0;
    const now = Date.now();
    const logTail = logs.slice(-20).join('\n');

    updateTaskRun(runId, {
      status: 'error',
      log_tail: logTail,
      finished_at: now,
      error,
    });

    appendTaskLog(taskUuid, `[ERROR] ${error}`, runId);
    this.broadcastLog(taskUuid, `[ERROR] ${error}`);

    // If attempt <= repeatCount, we retry with exponential backoff
    if (attempt <= repeatCount) {
      const backoffMs = computeBackoffDelay(attempt);
      const nextRunAt = now + backoffMs;

      db.prepare(`
        UPDATE tasks
        SET status = 'waiting', next_run_at = ?, updated_at = ?, error = ?
        WHERE uuid = ?
      `).run(nextRunAt, now, error, taskUuid);

      appendTaskLog(taskUuid, `[RETRY] Scheduled attempt ${attempt + 1} after ${backoffMs}ms backoff`, runId);
    } else {
      // Exceeded repeatCount, terminal error
      db.prepare(`
        UPDATE tasks
        SET status = 'error', updated_at = ?, finished_at = ?, error = ?
        WHERE uuid = ?
      `).run(now, now, error, taskUuid);

      this.broadcastEvent(taskUuid, 'error', { error, logs });
    }
  }
}

// Global coordinator singleton
let coordinator: TaskQueueCoordinator | null = null;

export function getTaskQueueCoordinator(): TaskQueueCoordinator {
  if (!coordinator) {
    coordinator = new TaskQueueCoordinator();
  }
  return coordinator;
}

export function resetTaskQueueCoordinator(): void {
  if (coordinator) {
    coordinator.stopLoop();
    coordinator = null;
  }
}
