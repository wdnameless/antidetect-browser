import { Router, Request, Response } from 'express';
import { motionSessions } from '../../motion/session';
import type { GlidePlan, MoveStep } from '../../motion/trajectory';
import type { TypingPlan } from '../../motion/typing';

export const motionRouter = Router();

const LOOPBACK = '127.0.0.1';

interface RunningCdp {
  port: string;
  wsPath: string;
}

interface RawWsSocket {
  once(event: 'open' | 'error', handler: () => void): void;
  on(event: 'message', handler: (data: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

interface RawCdp {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

/** Minimal browser-level CDP client over the DevTools WebSocket. */
async function connectRawCdp(profileId: string): Promise<RawCdp> {
  const { getCdpEndpoint } = require('../launcher/chromium') as {
    getCdpEndpoint(profileId: string): { port: string; wsPath: string } | undefined;
  };
  const ep = getCdpEndpoint(profileId);
  if (!ep) {
    throw new Error('profile is not running');
  }
  const WebSocket = (require('ws') as { WebSocket: new (url: string) => RawWsSocket }).WebSocket;
  const ws = new WebSocket(`ws://${LOOPBACK}:${ep.port}/devtools/browser/${ep.wsPath}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  ws.on('message', (data: unknown) => {
    try {
      const msg = JSON.parse(String(data)) as { id?: number; error?: unknown; result?: Record<string, unknown> };
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result ?? {});
        }
      }
    } catch {
      // ignore malformed frames
    }
  });
  return {
    send(method, params) {
      const id = nextId++;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params: params ?? {} }));
      });
    },
    close() {
      ws.close();
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function executeGlide(profileId: string, cdp: RawCdp, plan: GlidePlan): Promise<void> {
  for (const move of plan.moves) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: move.x,
      y: move.y,
      button: 'none',
    });
    if (move.delayMs > 0) await sleep(move.delayMs);
  }
}

async function executeTyping(profileId: string, cdp: RawCdp, plan: TypingPlan): Promise<void> {
  for (const key of plan.keys) {
    await sleep(key.delayMs);
    if (key.type === 'down') {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: key.key });
    } else {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key });
    }
  }
}

// POST /api/v1/motion/:profileId/:command
motionRouter.post('/api/v1/motion/:profileId/:command', async (req: Request, res: Response) => {
  const profileId = String(req.params.profileId || '');
  const command = String(req.params.command || '');
  const params = (req.body || {}) as Record<string, unknown>;

  try {
    let cdp: RawCdp | null = null;
    const needCdp = command !== 'createPointer' && command !== 'destroyPointer';
    if (needCdp) {
      cdp = await connectRawCdp(profileId);
    }

    switch (`Motion.${command}`) {
      case 'Motion.createPointer': {
        const pointer = motionSessions.createPointer(profileId, {
          seed: typeof params.seed === 'number' ? params.seed : undefined,
          paceScale: typeof params.paceScale === 'number' ? params.paceScale : undefined,
          profileSeed: typeof params.profileSeed === 'number' ? params.profileSeed : undefined,
          startX: typeof params.startX === 'number' ? params.startX : undefined,
          startY: typeof params.startY === 'number' ? params.startY : undefined,
        });
        res.json({
          code: 0,
          msg: 'success',
          data: { pointer: { x: pointer.x, y: pointer.y, seed: pointer.seed, paceScale: pointer.paceScale } },
        });
        break;
      }
      case 'Motion.glideTo': {
        const { plan, pointer } = motionSessions.glideTo(
          profileId,
          { x: Number(params.x) || 0, y: Number(params.y) || 0 },
          typeof params.targetWidth === 'number' ? params.targetWidth : 32
        );
        await executeGlide(profileId, cdp!, plan);
        res.json({ code: 0, msg: 'success', data: { durationMs: plan.durationMs, x: pointer.x, y: pointer.y } });
        break;
      }
      case 'Motion.tap': {
        const tap = motionSessions.tap(profileId, {
          clickCount: typeof params.clickCount === 'number' ? params.clickCount : undefined,
          button: typeof params.button === 'string' ? (params.button as 'left' | 'right' | 'middle') : undefined,
          delayMs: typeof params.delayMs === 'number' ? params.delayMs : undefined,
        });
        const clicks = tap.clicks;
        for (let i = 0; i < clicks; i++) {
          await cdp!.send('Input.dispatchMouseEvent', {
            type: clicks > 1 ? (i === 0 ? 'mousePressed' : 'mousePressed') : 'mousePressed',
            x: tap.x,
            y: tap.y,
            button: tap.button,
            clickCount: i + 1,
          });
          await sleep(Math.round(tap.delayMs / 2));
          await cdp!.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: tap.x,
            y: tap.y,
            button: tap.button,
            clickCount: i + 1,
          });
          if (i < clicks - 1) await sleep(Math.round(tap.delayMs / 2));
        }
        res.json({ code: 0, msg: 'success', data: { x: tap.x, y: tap.y, clicks, button: tap.button } });
        break;
      }
      case 'Motion.enterText': {
        const { plan } = motionSessions.enterText(
          profileId,
          String(params.text ?? ''),
          params.allowTypos === true
        );
        await executeTyping(profileId, cdp!, plan);
        res.json({ code: 0, msg: 'success', data: { durationMs: plan.durationMs } });
        break;
      }
      case 'Motion.destroyPointer': {
        const removed = motionSessions.destroyPointer(profileId);
        res.json({ code: 0, msg: 'success', data: { destroyed: removed } });
        break;
      }
      default:
        res.json({ code: -1, msg: `unknown Motion command: ${command}`, data: {} });
    }

    cdp?.close();
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});