import { describe, it, expect } from 'vitest';
import { reduceFleetRunState, fleetProgress } from '../../src/renderer/src/flowLiveRun';
import type { FleetRunState, FleetRunEvent } from '../../src/renderer/src/flowLiveRun';

function initEv(
  taskUuid: string,
  profileId: string,
  opts: { totalNodes?: number; activeSessionCap?: number; slotIndex?: number; snapshotStatus?: string } = {}
): Extract<FleetRunEvent, { kind: 'init' }> {
  return {
    kind: 'init',
    taskUuid,
    profileId,
    totalNodes: opts.totalNodes ?? 5,
    activeSessionCap: opts.activeSessionCap ?? 2,
    slotIndex: opts.slotIndex ?? 0,
    snapshotStatus: opts.snapshotStatus,
  };
}

function payload(taskUuid: string, payloadText: string): FleetRunEvent {
  return { kind: 'payload', taskUuid, payload: payloadText };
}

function endPayload(status: string, error?: string): string {
  return JSON.stringify({ event: 'end', status, ...(error !== undefined ? { error } : {}) });
}

describe('fleet run view reducer', () => {
  it('folds N streams into N independent per-profile states without cross-talk', () => {
    let state: FleetRunState = reduceFleetRunState(
      null,
      initEv('task-a', 'prof-1', { slotIndex: 0, activeSessionCap: 2 })
    );
    state = reduceFleetRunState(state, initEv('task-b', 'prof-2', { slotIndex: 1, activeSessionCap: 2 }));
    state = reduceFleetRunState(state, initEv('task-c', 'prof-3', { slotIndex: 2, activeSessionCap: 2 }));

    expect(state.profiles.map(p => p.taskUuid)).toEqual(['task-a', 'task-b', 'task-c']);

    state = reduceFleetRunState(state, payload('task-a', '[FLOW_SPAN_START] node-1'));
    state = reduceFleetRunState(state, payload('task-c', '[FLOW_SPAN_START] node-9'));

    const a = state.profiles.find(p => p.taskUuid === 'task-a')!;
    const b = state.profiles.find(p => p.taskUuid === 'task-b')!;
    const c = state.profiles.find(p => p.taskUuid === 'task-c')!;

    expect(a.logs.map(l => l.line)).toEqual(['[FLOW_SPAN_START] node-1']);
    expect(a.currentNodeId).toBe('node-1');
    expect(c.logs.map(l => l.line)).toEqual(['[FLOW_SPAN_START] node-9']);
    expect(c.currentNodeId).toBe('node-9');
    // The untouched profile receives nothing from its siblings.
    expect(b.logs).toHaveLength(0);
    expect(b.currentNodeId).toBeNull();
    expect(b.completedCount).toBe(0);
  });

  it('derives partial progress from FLOW_SPAN_END lines against totalNodes', () => {
    let state: FleetRunState = reduceFleetRunState(
      null,
      initEv('task-a', 'prof-1', { totalNodes: 5, activeSessionCap: 1, slotIndex: 0 })
    );
    // Before any span completes the progress is exactly 0, never NaN/negative.
    expect(fleetProgress(state.profiles[0]).completed).toBe(0);
    expect(fleetProgress(state.profiles[0]).fraction).toBe(0);

    state = reduceFleetRunState(state, payload('task-a', '[FLOW_SPAN_START] node-1'));
    state = reduceFleetRunState(state, payload('task-a', '[FLOW_SPAN_END] node-1'));
    state = reduceFleetRunState(state, payload('task-a', '[FLOW_SPAN_END] node-2'));
    state = reduceFleetRunState(state, payload('task-a', '[FLOW_SPAN_START] node-3'));
    // The same node completing twice must not double-count.
    state = reduceFleetRunState(state, payload('task-a', '[FLOW_SPAN_END] node-2'));

    const profile = state.profiles[0];
    const progress = fleetProgress(profile);
    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(2);
    expect(progress.fraction).toBeCloseTo(2 / 5);
    // A partial stream is strictly between 0 and complete.
    expect(progress.fraction).toBeGreaterThan(0);
    expect(progress.fraction).toBeLessThan(1);
    // Most recent span start is the current node.
    expect(profile.currentNodeId).toBe('node-3');
    expect(profile.completedCount).toBe(2);
  });

  it('handles zero-node flows without division issues', () => {
    const state: FleetRunState = reduceFleetRunState(
      null,
      initEv('task-a', 'prof-1', { totalNodes: 0, activeSessionCap: 1, slotIndex: 0 })
    );
    const progress = fleetProgress(state.profiles[0]);
    expect(progress.total).toBe(0);
    expect(progress.completed).toBe(0);
    expect(progress.fraction).toBe(0);
  });

  it('marks one failed profile as error while the others keep their own outcomes', () => {
    let state: FleetRunState = reduceFleetRunState(
      null,
      initEv('task-a', 'prof-1', { slotIndex: 0, activeSessionCap: 2, snapshotStatus: 'working' })
    );
    state = reduceFleetRunState(state, initEv('task-b', 'prof-2', { slotIndex: 1, activeSessionCap: 2, snapshotStatus: 'working' }));
    state = reduceFleetRunState(state, initEv('task-c', 'prof-3', { slotIndex: 2, activeSessionCap: 2, snapshotStatus: 'waiting' }));

    state = reduceFleetRunState(state, payload('task-a', endPayload('error', 'boom')));

    const a = state.profiles.find(p => p.taskUuid === 'task-a')!;
    expect(a.status).toBe('error');
    expect(a.error).toBe('boom');
    // The run is NOT finished while others are still queued/working.
    expect(state.finished).toBe(false);

    state = reduceFleetRunState(state, payload('task-b', endPayload('finished')));
    expect(state.profiles.find(p => p.taskUuid === 'task-b')!.status).toBe('finished');
    expect(state.finished).toBe(false); // c is still queued

    state = reduceFleetRunState(state, payload('task-c', endPayload('finished')));
    expect(state.profiles.find(p => p.taskUuid === 'task-c')!.status).toBe('finished');
    expect(state.finished).toBe(true);
    // The failed profile stays error even after the run completes.
    expect(state.profiles.find(p => p.taskUuid === 'task-a')!.status).toBe('error');
  });

  it('shows profiles beyond activeSessionCap as queued, not working', () => {
    let state: FleetRunState = reduceFleetRunState(
      null,
      initEv('t0', 'p0', { slotIndex: 0, activeSessionCap: 2 })
    );
    for (let i = 1; i < 5; i++) {
      state = reduceFleetRunState(state, initEv(`t${i}`, `p${i}`, { slotIndex: i, activeSessionCap: 2 }));
    }

    expect(state.profiles).toHaveLength(5);
    expect(state.profiles.slice(0, 2).every(p => p.status === 'working')).toBe(true);
    expect(state.profiles.slice(2).every(p => p.status === 'queued')).toBe(true);

    // A queued profile flips to working only once its first log line arrives.
    state = reduceFleetRunState(state, payload('t4', '[FLOW_SPAN_START] node-1'));
    expect(state.profiles.find(p => p.taskUuid === 't4')!.status).toBe('working');
    expect(state.profiles.find(p => p.taskUuid === 't3')!.status).toBe('queued');
  });

  it('keeps per-profile logs un-interleaved when streams arrive in a mix', () => {
    let state: FleetRunState = reduceFleetRunState(
      null,
      initEv('task-a', 'prof-1', { slotIndex: 0, activeSessionCap: 2 })
    );
    state = reduceFleetRunState(state, initEv('task-b', 'prof-2', { slotIndex: 1, activeSessionCap: 2 }));

    const mixed: Array<[string, string]> = [
      ['task-a', '[FLOW_SPAN_START] node-1'],
      ['task-b', '[FLOW_SPAN_START] node-x'],
      ['task-a', '[FLOW_SPAN_END] node-1'],
      ['task-b', '[FLOW_SPAN_END] node-x'],
      ['task-a', 'first profile banner'],
      ['task-b', 'second profile banner'],
    ];
    for (const [uuid, line] of mixed) {
      state = reduceFleetRunState(state, payload(uuid, line));
    }

    const a = state.profiles.find(p => p.taskUuid === 'task-a')!;
    const b = state.profiles.find(p => p.taskUuid === 'task-b')!;
    expect(a.logs.map(l => l.line)).toEqual([
      '[FLOW_SPAN_START] node-1',
      '[FLOW_SPAN_END] node-1',
      'first profile banner',
    ]);
    expect(b.logs.map(l => l.line)).toEqual([
      '[FLOW_SPAN_START] node-x',
      '[FLOW_SPAN_END] node-x',
      'second profile banner',
    ]);
    expect(a.completedNodeIds).toEqual(['node-1']);
    expect(b.completedNodeIds).toEqual(['node-x']);
  });

  it('stopAll marks queued and working profiles stopped; a late payload cannot restart them', () => {
    let state: FleetRunState = reduceFleetRunState(
      null,
      initEv('t0', 'p0', { slotIndex: 0, activeSessionCap: 2 })
    );
    for (let i = 1; i < 4; i++) {
      state = reduceFleetRunState(state, initEv(`t${i}`, `p${i}`, { slotIndex: i, activeSessionCap: 2 }));
    }

    state = reduceFleetRunState(state, { kind: 'stopAll' });
    expect(state.profiles.every(p => p.status === 'stopped')).toBe(true);
    expect(state.finished).toBe(true);

    // Queued profiles must not start after the stop: even a log line cannot
    // flip a stopped profile back to working.
    state = reduceFleetRunState(state, payload('t3', '[FLOW_SPAN_START] node-9'));
    expect(state.profiles.find(p => p.taskUuid === 't3')!.status).toBe('stopped');
  });

  it('resets to an empty state when the caller starts a fresh run', () => {
    let state: FleetRunState | null = reduceFleetRunState(
      null,
      initEv('old-a', 'prof-1', { slotIndex: 0, activeSessionCap: 1 })
    );
    expect(state.profiles).toHaveLength(1);
    // A new run starts from a clean slate: the reducer is fed `null` again,
    // which is exactly what the run view does when it resets between runs.
    state = reduceFleetRunState(null, initEv('new-b', 'prof-2', { slotIndex: 0, activeSessionCap: 1 }));
    expect(state.profiles.map(p => p.taskUuid)).toEqual(['new-b']);
    expect(state.profiles.map(p => p.profileId)).toEqual(['prof-2']);
  });

  it('clearLogs empties only the requested profile log', () => {
    let state: FleetRunState = reduceFleetRunState(
      null,
      initEv('task-a', 'prof-1', { slotIndex: 0, activeSessionCap: 2 })
    );
    state = reduceFleetRunState(state, initEv('task-b', 'prof-2', { slotIndex: 1, activeSessionCap: 2 }));
    state = reduceFleetRunState(state, payload('task-a', '[FLOW_SPAN_START] node-1'));
    state = reduceFleetRunState(state, payload('task-b', '[FLOW_SPAN_START] node-2'));

    state = reduceFleetRunState(state, { kind: 'clearLogs', taskUuid: 'task-a' });

    expect(state.profiles.find(p => p.taskUuid === 'task-a')!.logs).toHaveLength(0);
    expect(state.profiles.find(p => p.taskUuid === 'task-b')!.logs.map(l => l.line)).toEqual([
      '[FLOW_SPAN_START] node-2',
    ]);
  });
});
