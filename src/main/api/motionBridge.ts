// Motion CDP bridge (parity program: human-input-motion): a per-profile WS
// endpoint at /motion/:profileId that speaks the hidden Motion domain.
//
//   client -> CDP-shaped JSON-RPC frames: {id, method: 'Motion.<cmd>', params?}
//             (also forwards any non-Motion CDP methods to the browser target,
//              so automation clients can mix Motion with raw CDP)
//   server -> {id, result|error} CDP-shaped replies
//
// The domain is intentionally absent from Schema.getDomains and /json/protocol
// (add-motion-cdp-domain spec: hidden-domain requirement). The engine patch
// supersedes this launcher-side handler with a byte-stable wire contract.
import type { Duplex } from 'stream';
import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import puppeteer, { type Browser } from 'puppeteer-core';
import { getCdpEndpoint, getRunningPort } from '../launcher/chromium';
import { handleMotionCdpMessage } from '../motion/handler';
import { checkTunnelAuth } from './cdpTunnel';

const LOOPBACK = '127.0.0.1';

interface MotionBridgeState {
  wss: WebSocketServer;
}

let state: MotionBridgeState | null = null;

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function runBridge(ws: WebSocket, profileId: string): Promise<void> {
  const ep = getCdpEndpoint(profileId);
  if (!ep) {
    send(ws, { id: 0, error: { code: -32002, message: 'profile is not running' } });
    ws.close();
    return;
  }

  let browser: Browser | undefined;
  let cleaned = false;
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    for (const p of pending.values()) p.reject(new Error('motion bridge closed'));
    pending.clear();
    try {
      browser?.disconnect();
    } catch {
      // already gone
    }
  };

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: `ws://${LOOPBACK}:${ep.port}/devtools/browser/${ep.wsPath}`,
      defaultViewport: null,
    });

    // CDP dispatcher over the browser-level connection (raw wire protocol).
    const browserWsUrl = (browser as unknown as { wsEndpoint(): string }).wsEndpoint();
    const rawWs = new WebSocket(browserWsUrl);

    await new Promise<void>((resolve, reject) => {
      rawWs.once('open', resolve);
      rawWs.once('error', reject);
    });

    rawWs.on('message', (data: unknown) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      // Resolve a pending dispatcher call
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
      // Non-reply messages (events) are forwarded to the client verbatim
      send(ws, msg);
    });

    rawWs.on('close', () => cleanup());
    rawWs.on('error', () => cleanup());

    const dispatcher = {
      send(method: string, params?: Record<string, unknown>, sessionId?: string) {
        const id = nextId++;
        const frame: Record<string, unknown> = { id, method, params: params ?? {} };
        if (sessionId) frame.sessionId = sessionId;
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          rawWs.send(JSON.stringify(frame));
        });
      },
    };

    ws.on('message', (data: unknown) => {
      let message: unknown;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      void handleMotionCdpMessage(profileId, message, dispatcher, (response) => {
        send(ws, response);
      }).then((handled) => {
        if (!handled) {
          // Forward non-Motion CDP methods to the browser target as-is.
          const req = message as { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string };
          if (typeof req.id === 'number' && typeof req.method === 'string') {
            dispatcher
              .send(req.method, req.params, req.sessionId)
              .then((result) => send(ws, { id: req.id, result }))
              .catch((err: Error) =>
                send(ws, { id: req.id, error: { code: -32000, message: err.message } })
              );
          }
        }
      });
    });

    ws.on('close', () => cleanup());
    ws.on('error', () => cleanup());
    void browserWsUrl;
  } catch (err) {
    send(ws, {
      id: 0,
      error: { code: -32002, message: `motion bridge failed: ${(err as Error).message}` },
    });
    ws.close();
    cleanup();
  }
}

/**
 * Registers the Motion WS upgrade handler on the API HTTP server.
 * Auth: the same tunnel key contract as the CDP tunnel.
 */
export function createMotionUpgradeHandler(getExpectedKey: () => string) {
  const wss = new WebSocketServer({ noServer: true });
  state = { wss };

  return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    const m = url.match(/^\/motion\/([^/?]+)(\?.*)?$/);
    if (!m) return false;
    const profileId = decodeURIComponent(m[1]);
    if (!checkTunnelAuth(req, getExpectedKey())) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return true;
    }
    if (!getCdpEndpoint(profileId)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return true;
    }
    wss.handleUpgrade(req as never, socket, head, (ws) => {
      void runBridge(ws as WebSocket, profileId);
    });
    return true;
  };
}

export function getMotionBridgePort(): number | null {
  void state;
  return null; // bridge lives on the API port; kept for future dedicated port
}