// Minimal browser-level CDP client for the Motion input path (parity program:
// form-filling-helper). Auto-attaches to the first page target so the Input
// domain lands on the page, mirroring routes/motion.ts connectRawCdp. The
// Motion typing plan dispatches real Input.dispatchKeyEvent frames — values
// never touch element.value and no DOM events are synthesised.
import { getCdpEndpoint } from '../launcher/chromium';

const LOOPBACK = '127.0.0.1';

interface RawWsSocket {
  once(event: 'open', handler: () => void): void;
  once(event: 'error', handler: (err: Error) => void): void;
  on(event: 'message', handler: (data: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface CdpHandle {
  send(method: string, params?: Record<string, unknown>, isPageScoped?: boolean): Promise<Record<string, unknown>>;
  close(): void;
}

export function connectProfileCdp(profileId: string): Promise<CdpHandle> {
  const ep = getCdpEndpoint(profileId);
  if (!ep) {
    return Promise.reject(new Error('profile is not running'));
  }
  const WebSocket = (require('ws') as { WebSocket: new (url: string) => RawWsSocket }).WebSocket;
  const ws = new WebSocket(`ws://${LOOPBACK}:${ep.port}${ep.wsPath}`);
  return new Promise<CdpHandle>((resolve, reject) => {
    let pageSessionId: string | null = null;
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

    const rawSend = (frame: Record<string, unknown>): void => {
      ws.send(JSON.stringify(frame));
    };
    const call = <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> => {
      const id = nextId++;
      return new Promise<T>((resolveInner, rejectInner) => {
        pending.set(id, { resolve: resolveInner as (v: Record<string, unknown>) => void, reject: rejectInner });
        rawSend({ id, method, params: params ?? {} });
      });
    };

    ws.once('open', () => {
      void (async () => {
        try {
          const { targetInfos } = await call<{ targetInfos: Array<{ targetId: string; type: string }> }>(
            'Target.getTargets'
          );
          const page = targetInfos.find((t) => t.type === 'page');
          if (!page) {
            ws.close();
            reject(new Error('no page target in browser'));
            return;
          }
          await call('Target.attachToTarget', { targetId: page.targetId, flatten: true });
          if (!pageSessionId) {
            ws.close();
            reject(new Error('failed to attach to page target'));
            return;
          }
          const handle: CdpHandle = {
            send(method, params, isPageScoped = false) {
              const id = nextId++;
              const frame: Record<string, unknown> = { id, method, params: params ?? {} };
              if (pageSessionId && (isPageScoped || method.startsWith('Input.') || method.startsWith('Page.'))) {
                frame.sessionId = pageSessionId;
              }
              return new Promise<Record<string, unknown>>((res, rej) => {
                pending.set(id, { resolve: res, reject: rej });
                rawSend(frame);
              });
            },
            close() {
              ws.close();
            },
          };
          resolve(handle);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
    ws.once('error', (err: Error) => reject(err));
    ws.on('message', (data: unknown) => {
      try {
        const msg = JSON.parse(String(data)) as {
          id?: number;
          error?: unknown;
          result?: Record<string, unknown>;
          params?: { sessionId: string; targetInfo: { type: string } };
        };
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(JSON.stringify(msg.error)));
          } else {
            p.resolve((msg.result ?? {}) as Record<string, unknown>);
          }
          return;
        }
        if (msg.params?.targetInfo?.type === 'page') {
          pageSessionId = msg.params.sessionId;
        }
      } catch {
        // ignore malformed frames
      }
    });
  });
}
