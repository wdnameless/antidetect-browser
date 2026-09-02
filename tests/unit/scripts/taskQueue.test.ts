import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDb, closeDb } from '../../../src/main/db';
import { createTaskGroup, getGroupTasks, getTaskGroup } from '../../../src/main/scripts/taskGroups';
import { TaskQueue, isWithinTimeWindow } from '../../../src/main/scripts/taskQueue';
import * as scriptEngineModule from '../../../src/main/scripts/scriptEngine';
import { EventEmitter } from 'events';

describe('TaskQueue and taskGroup execution', () => {
  let queue: TaskQueue;

  beforeEach(async () => {
    await initDb(':memory:');
    queue = new TaskQueue({ pollIntervalMs: 20 });
  });

  afterEach(() => {
    queue.destroy();
    closeDb();
    vi.restoreAllMocks();
  });

  it('verifies time window parsing correctly', () => {
    const testDate = new Date(2026, 8, 2, 14, 30); // 14:30
    expect(isWithinTimeWindow('10:00-16:00', testDate)).toBe(true);
    expect(isWithinTimeWindow('15:00-18:00', testDate)).toBe(false);
    expect(isWithinTimeWindow('20:00-04:00', testDate)).toBe(false);

    const nightDate = new Date(2026, 8, 2, 23, 0); // 23:00
    expect(isWithinTimeWindow('20:00-04:00', nightDate)).toBe(true);

    const earlyMorning = new Date(2026, 8, 2, 2, 0); // 02:00
    expect(isWithinTimeWindow('20:00-04:00', earlyMorning)).toBe(true);

    expect(isWithinTimeWindow('* * * * *', testDate)).toBe(true);
  });

  it('respects active session semaphore cap', async () => {
    let activeWorkers = 0;
    let maxObservedWorkers = 0;

    vi.spyOn(scriptEngineModule, 'invokeScriptTask').mockImplementation(() => {
      activeWorkers++;
      if (activeWorkers > maxObservedWorkers) {
        maxObservedWorkers = activeWorkers;
      }
      const emitter = new EventEmitter();
      setTimeout(() => {
        activeWorkers--;
        emitter.emit('done', { logs: ['worker finished'] });
      }, 30);

      return {
        taskUuid: 'stub-uuid',
        logStream: emitter,
        terminate: async () => {
          activeWorkers--;
        },
      };
    });

    const group = createTaskGroup({
      name: 'Cap Test',
      script_id: 'script-1',
      profile_ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      active_session_cap: 2,
    });

    await queue.startGroup(group.id);

    await new Promise<void>((resolve) => {
      queue.on('group-finished', (gId) => {
        if (gId === group.id) resolve();
      });
    });

    expect(maxObservedWorkers).toBeLessThanOrEqual(2);
    const tasks = getGroupTasks(group.id);
    expect(tasks.every((t) => t.status === 'finished')).toBe(true);
    expect(getTaskGroup(group.id)?.status).toBe('finished');
  });

  it('handles retry with exponential backoff on failure', async () => {
    let attempts = 0;
    const timestamps: number[] = [];

    vi.spyOn(scriptEngineModule, 'invokeScriptTask').mockImplementation(() => {
      attempts++;
      timestamps.push(Date.now());
      const emitter = new EventEmitter();

      setTimeout(() => {
        if (attempts <= 2) {
          emitter.emit('error', { error: 'Transient failure', logs: ['error log'] });
        } else {
          // 3rd attempt succeeds
          emitter.emit('done', { logs: ['success'] });
        }
      }, 10);

      return {
        taskUuid: 'stub-uuid',
        logStream: emitter,
        terminate: async () => {},
      };
    });

    const group = createTaskGroup({
      name: 'Retry Test',
      script_id: 'script-1',
      profile_ids: ['p1'],
      active_session_cap: 1,
      repeat_count: 3,
    });

    await queue.startGroup(group.id);

    await new Promise<void>((resolve) => {
      queue.on('group-finished', (gId) => {
        if (gId === group.id) resolve();
      });
    });

    expect(attempts).toBe(3);
    const tasks = getGroupTasks(group.id);
    expect(tasks[0].status).toBe('finished');
    expect(tasks[0].attempts).toBe(3);
  });

  it('times out task if execution exceeds timeout_ms', async () => {
    vi.spyOn(scriptEngineModule, 'invokeScriptTask').mockImplementation(() => {
      const emitter = new EventEmitter();
      return {
        taskUuid: 'stub-uuid',
        logStream: emitter,
        terminate: async () => {
          emitter.emit('error', { error: 'Terminated due to timeout', logs: ['timeout'] });
        },
      };
    });

    const group = createTaskGroup({
      name: 'Timeout Test',
      script_id: 'script-1',
      profile_ids: ['p1'],
      active_session_cap: 1,
      repeat_count: 0,
      per_task_timeout_ms: 100,
    });

    await queue.startGroup(group.id);

    await new Promise<void>((resolve) => {
      queue.on('group-finished', (gId) => {
        if (gId === group.id) resolve();
      });
    });

    const tasks = getGroupTasks(group.id);
    expect(tasks[0].status).toBe('error');
    expect(tasks[0].error).toContain('timed out');
  });

  it('stops group gracefully: working terminated, queued -> stop', async () => {
    let terminateInvoked = false;

    vi.spyOn(scriptEngineModule, 'invokeScriptTask').mockImplementation(() => {
      const emitter = new EventEmitter();
      return {
        taskUuid: 'stub-uuid',
        logStream: emitter,
        terminate: async () => {
          terminateInvoked = true;
          emitter.emit('error', { error: 'Terminated', logs: [] });
        },
      };
    });

    const group = createTaskGroup({
      name: 'Stop Test',
      script_id: 'script-1',
      profile_ids: ['p1', 'p2', 'p3'],
      active_session_cap: 1,
    });

    await queue.startGroup(group.id);

    // Wait until 1 task starts
    await new Promise((r) => setTimeout(r, 50));

    await queue.stopGroup(group.id);

    expect(terminateInvoked).toBe(true);
    expect(getTaskGroup(group.id)?.status).toBe('stop');

    const tasks = getGroupTasks(group.id);
    expect(tasks.every((t) => t.status === 'stop')).toBe(true);
  });

  it('randomizes profile order when randomize_profile_order is enabled', () => {
    const originalProfiles = Array.from({ length: 30 }, (_, i) => `p_${i}`);

    const group1 = createTaskGroup({
      name: 'Order 1',
      script_id: 'script-1',
      profile_ids: originalProfiles,
      randomize_profile_order: true,
    });

    const tasks1 = getGroupTasks(group1.id).map((t) => t.profile_id);
    expect(tasks1).not.toEqual(originalProfiles);
    expect([...tasks1].sort()).toEqual([...originalProfiles].sort());
  });
});
