import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../../src/main/db';
import {
  createTaskGroup,
  getTaskGroup,
  listTaskGroups,
  getGroupTasks,
  getTaskByUuid,
  getTaskLogs,
  appendTaskLog,
  insertTaskRun,
  updateTaskRun,
  getTaskRuns,
  updateTaskGroupStatus,
  updateTaskProgress,
} from '../../../src/main/scripts/taskGroups';

describe('taskGroups storage and model', () => {
  beforeEach(async () => {
    await initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  it('creates and retrieves task group with tasks', () => {
    const group = createTaskGroup({
      name: 'Test Campaign',
      script_id: 'script-123',
      profile_ids: ['prof-1', 'prof-2', 'prof-3'],
      active_session_cap: 2,
      per_task_timeout_ms: 60000,
      repeat_count: 3,
      randomize_profile_order: true,
      time_window_cron: '08:00-18:00',
    });

    expect(group.id).toBeDefined();
    expect(group.name).toBe('Test Campaign');
    expect(group.active_session_cap).toBe(2);
    expect(group.status).toBe('waiting');

    const fetched = getTaskGroup(group.id);
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('Test Campaign');
    expect(fetched?.randomize_profile_order).toBe(true);

    const tasks = getGroupTasks(group.id);
    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => t.status === 'waiting')).toBe(true);
    expect(tasks[0].uuid).toBeDefined();

    const byUuid = getTaskByUuid(tasks[0].uuid);
    expect(byUuid?.uuid).toBe(tasks[0].uuid);
    expect(byUuid?.group_id).toBe(group.id);
  });

  it('handles task run records and live log streams', () => {
    const group = createTaskGroup({
      name: 'Logs Campaign',
      script_id: 'script-xyz',
      profile_ids: ['prof-1'],
    });

    const tasks = getGroupTasks(group.id);
    const task = tasks[0];

    insertTaskRun({
      id: 'run-1',
      task_uuid: task.uuid,
      attempt: 1,
      status: 'working',
      started_at: Date.now(),
    });
    appendTaskLog(task.uuid, 'Starting browser profile...', 'run-1');
    appendTaskLog(task.uuid, 'Navigation complete', 'run-1');
    appendTaskLog(task.uuid, 'Error: selector timed out', 'run-1');
    updateTaskRun('run-1', {
      status: 'error',
      log_tail: 'Error: selector timed out',
      finished_at: Date.now(),
      error: 'selector timed out',
    });

    const logs = getTaskLogs(task.uuid);
    expect(logs).toHaveLength(3);
    expect(logs[0].line).toBe('Starting browser profile...');
    expect(logs[2].line).toBe('Error: selector timed out');

    const runs = getTaskRuns(task.uuid);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('error');
    expect(runs[0].error).toBe('selector timed out');
  });

  it('updates task group status and task statuses', () => {
    const group = createTaskGroup({
      name: 'Status Campaign',
      script_id: 'script-xyz',
      profile_ids: ['prof-1'],
    });

    updateTaskGroupStatus(group.id, 'working');
    expect(getTaskGroup(group.id)?.status).toBe('working');

    const tasks = getGroupTasks(group.id);
    updateTaskProgress(tasks[0].uuid, {
      status: 'finished',
      finished_at: Date.now(),
    });
    expect(getGroupTasks(group.id)[0].status).toBe('finished');

    const list = listTaskGroups();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.find((g) => g.id === group.id)?.status).toBe('working');
  });
});
