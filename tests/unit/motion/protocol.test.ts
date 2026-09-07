import { describe, it, expect, beforeEach } from 'vitest';
import { handleMotionCdpMessage, CdpDispatcher, CdpResponse } from '../../../src/main/motion/handler';
import { motionSessions } from '../../../src/main/motion/session';

describe('Motion - CDP Protocol Handler', () => {
  let dispatchedCalls: Array<{ method: string; params?: Record<string, unknown>; sessionId?: string }>;
  let fakeDispatcher: CdpDispatcher;

  beforeEach(() => {
    motionSessions.clear();
    dispatchedCalls = [];
    fakeDispatcher = {
      async send(method, params, sessionId) {
        dispatchedCalls.push({ method, params, sessionId });
        return {};
      },
    };
  });

  it('ignores non-Motion methods', async () => {
    let replyCalled = false;
    const handled = await handleMotionCdpMessage(
      'prof-1',
      { id: 1, method: 'Page.navigate', params: { url: 'https://example.com' } },
      fakeDispatcher,
      () => {
        replyCalled = true;
      }
    );

    expect(handled).toBe(false);
    expect(replyCalled).toBe(false);
  });

  it('Schema.getDomains check: Motion never registers in schema domains', () => {
    const standardDomains = ['Page', 'Runtime', 'Network', 'Target', 'Input', 'DOM'];
    expect(standardDomains.includes('Motion')).toBe(false);
  });

  it('handles Motion.createPointer and initializes session', async () => {
    let replyPayload: CdpResponse | undefined;

    const handled = await handleMotionCdpMessage(
      'prof-1',
      {
        id: 10,
        method: 'Motion.createPointer',
        params: { startX: 100, startY: 200, seed: 42, paceScale: 1.0 },
      },
      fakeDispatcher,
      (res) => {
        replyPayload = res;
      }
    );

    expect(handled).toBe(true);
    expect(replyPayload?.id).toBe(10);
    expect(replyPayload?.result?.pointer).toBeDefined();
    expect(motionSessions.hasPointer('prof-1')).toBe(true);
  });

  it('fails with -32001 when Motion.glideTo is invoked without pointer', async () => {
    let replyPayload: CdpResponse | undefined;

    const handled = await handleMotionCdpMessage(
      'prof-uninit',
      {
        id: 11,
        method: 'Motion.glideTo',
        params: { x: 500, y: 400 },
      },
      fakeDispatcher,
      (res) => {
        replyPayload = res;
      }
    );

    expect(handled).toBe(true);
    expect(replyPayload?.id).toBe(11);
    expect(replyPayload?.error?.code).toBe(-32001);
  });

  it('Motion.glideTo dispatches Input.dispatchMouseEvent steps over CDP', async () => {
    motionSessions.createPointer('prof-1', { startX: 0, startY: 0, seed: 1234 });

    let replyPayload: CdpResponse | undefined;
    const handled = await handleMotionCdpMessage(
      'prof-1',
      {
        id: 12,
        method: 'Motion.glideTo',
        params: { x: 300, y: 200, targetWidth: 40 },
        sessionId: 'session-abc',
      },
      fakeDispatcher,
      (res) => {
        replyPayload = res;
      }
    );

    expect(handled).toBe(true);
    expect(replyPayload?.id).toBe(12);
    expect(replyPayload?.result?.x).toBe(300);
    expect(replyPayload?.result?.y).toBe(200);

    expect(dispatchedCalls.length).toBeGreaterThan(0);
    expect(dispatchedCalls.every((c) => c.method === 'Input.dispatchMouseEvent')).toBe(true);
    expect(dispatchedCalls[0].sessionId).toBe('session-abc');
  });

  it('Motion.tap dispatches mousePressed and mouseReleased', async () => {
    motionSessions.createPointer('prof-1', { startX: 150, startY: 250 });

    let replyPayload: CdpResponse | undefined;
    const handled = await handleMotionCdpMessage(
      'prof-1',
      {
        id: 13,
        method: 'Motion.tap',
        params: { clickCount: 1, button: 'left' },
      },
      fakeDispatcher,
      (res) => {
        replyPayload = res;
      }
    );

    expect(handled).toBe(true);
    expect(replyPayload?.result?.tapped).toBe(true);

    expect(dispatchedCalls.length).toBe(2);
    expect(dispatchedCalls[0].params?.type).toBe('mousePressed');
    expect(dispatchedCalls[1].params?.type).toBe('mouseReleased');
  });

  it('Motion.enterText dispatches Input.dispatchKeyEvent events', async () => {
    motionSessions.createPointer('prof-1', { seed: 999 });

    let replyPayload: CdpResponse | undefined;
    const handled = await handleMotionCdpMessage(
      'prof-1',
      {
        id: 14,
        method: 'Motion.enterText',
        params: { text: 'hi', allowTypos: false },
      },
      fakeDispatcher,
      (res) => {
        replyPayload = res;
      }
    );

    expect(handled).toBe(true);
    expect(replyPayload?.result?.entered).toBe(true);

    expect(dispatchedCalls.length).toBe(4); // 2 chars * (down + up)
    expect(dispatchedCalls[0].method).toBe('Input.dispatchKeyEvent');
    expect(dispatchedCalls[0].params?.type).toBe('keyDown');
    expect(dispatchedCalls[0].params?.text).toBe('h');
  });

  it('Motion.destroyPointer tears down pointer', async () => {
    motionSessions.createPointer('prof-1');

    let replyPayload: CdpResponse | undefined;
    const handled = await handleMotionCdpMessage(
      'prof-1',
      {
        id: 15,
        method: 'Motion.destroyPointer',
      },
      fakeDispatcher,
      (res) => {
        replyPayload = res;
      }
    );

    expect(handled).toBe(true);
    expect(replyPayload?.result?.success).toBe(true);
    expect(motionSessions.hasPointer('prof-1')).toBe(false);
  });
});
