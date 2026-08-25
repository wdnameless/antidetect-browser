// Remote viewer: streams a running profile's browser into the web panel via
// CDP Page.startScreencast and forwards mouse/keyboard input back through the
// same CDP session. One WS connection per viewed profile.
//
//   client -> {t:'m', ev:'move'|'down'|'up'|'wheel', x?, y?, b?, c?, dx?, dy?}
//             (x/y are in device pixels of the last received frame)
//             {t:'k', ev:'down'|'up', key, code, text?, vk?}
//   server -> {t:'frame', d:<base64 jpeg>, w, h} | {t:'error', msg} | {t:'closed'}
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import puppeteer, { type Browser, type CDPSession, type CDPSessionEvent } from 'puppeteer-core';
import { getCdpEndpoint } from '../launcher/chromium';
import { checkTunnelAuth } from './cdpTunnel';

const MOUSE_BUTTONS: Record<string, { button: 'left' | 'right' | 'middle'; bits: number }> = {
  left: { button: 'left', bits: 1 },
  middle: { button: 'middle', bits: 4 },
  right: { button: 'right', bits: 2 },
};

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function runViewer(ws: WebSocket, profileId: string): Promise<void> {
  const ep = getCdpEndpoint(profileId);
  if (!ep) {
    send(ws, { t: 'error', msg: 'profile is not running' });
    ws.close();
    return;
  }

  let browser: Browser | undefined;
  let session: CDPSession | undefined;
  let cleaned = false;

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      void session?.send('Page.stopScreencast').catch(() => undefined);
      void session?.detach().catch(() => undefined);
    } catch {
      // ignore
    }
    try {
      browser?.disconnect();
    } catch {
      // ignore
    }
  };

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:${ep.port}${ep.wsPath}`,
      defaultViewport: null,
    });
  } catch {
    send(ws, { t: 'error', msg: 'cannot connect to browser' });
    ws.close();
    return;
  }

  browser.on('disconnected', () => {
    send(ws, { t: 'closed' });
    ws.close();
    cleanup();
  });

  const targets = await browser.targets();
  const page = targets.find((t) => t.type() === 'page');
  if (!page) {
    send(ws, { t: 'error', msg: 'no open page' });
    ws.close();
    cleanup();
    return;
  }

  session = await page.createCDPSession();

  session.on('Page.screencastFrame', (ev) => {
    send(ws, {
      t: 'frame',
      d: ev.data,
      w: ev.metadata.deviceWidth ?? 0,
      h: ev.metadata.deviceHeight ?? 0,
    });
    void session?.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
  });

  try {
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1600,
      maxHeight: 1000,
      everyNthFrame: 1,
    });
  } catch {
    send(ws, { t: 'error', msg: 'screencast failed' });
    ws.close();
    cleanup();
    return;
  }

  ws.on('message', (raw: Buffer) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!session) return;

    if (msg.t === 'm') {
      const x = Number(msg.x || 0);
      const y = Number(msg.y || 0);
      const btnName = String(msg.b || 'left');
      const btn = MOUSE_BUTTONS[btnName] ?? MOUSE_BUTTONS.left;
      switch (String(msg.ev)) {
        case 'move':
          void session
            .send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: Number(msg.buttons || 0) })
            .catch(() => undefined);
          break;
        case 'down':
          void session
            .send('Input.dispatchMouseEvent', {
              type: 'mousePressed',
              x,
              y,
              button: btn.button,
              buttons: btn.bits,
              clickCount: Number(msg.c || 1),
            })
            .catch(() => undefined);
          break;
        case 'up':
          void session
            .send('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x,
              y,
              button: btn.button,
              buttons: 0,
              clickCount: Number(msg.c || 1),
            })
            .catch(() => undefined);
          break;
        case 'wheel':
          void session
            .send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x,
              y,
              deltaX: Number(msg.dx || 0),
              deltaY: Number(msg.dy || 0),
              button: 'none',
              buttons: 0,
            })
            .catch(() => undefined);
          break;
        default:
          break;
      }
      return;
    }

    if (msg.t === 'k') {
      const key = String(msg.key || '');
      const code = String(msg.code || '');
      const vk = Number(msg.vk || 0);
      const text = typeof msg.text === 'string' && msg.text.length > 0 ? msg.text : undefined;
      const down = String(msg.ev) === 'down';
      void session
        .send('Input.dispatchKeyEvent', {
          type: down ? (text ? 'keyDown' : 'rawKeyDown') : 'keyUp',
          key,
          code,
          windowsVirtualKeyCode: vk,
          nativeVirtualKeyCode: vk,
          ...(text ? { text } : {}),
        })
        .catch(() => undefined);
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

/**
 * Create an upgrade handler for `/cdp-view/:sessionId`.
 * Auth mirrors the CDP tunnel (`?key=` query param or Bearer header).
 * The caller owns the single server-level 'upgrade' dispatcher.
 */
export function createViewerUpgradeHandler(
  getExpectedKey: () => string
): (req: import('http').IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({ noServer: true });
  return (req, socket, head) => {
    const url = req.url || '';
    const m = url.match(/^\/cdp-view\/([^/?]+)/);
    if (!m) {
      socket.destroy();
      return;
    }
    if (!checkTunnelAuth(req, getExpectedKey())) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    const profileId = decodeURIComponent(m[1]);
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      void runViewer(ws, profileId);
    });
  };
}
