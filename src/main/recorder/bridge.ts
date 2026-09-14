// Flow recorder bridge (Wave 2, gap B1): a per-profile WebSocket endpoint at
// /recorder/:profileId that carries captured browsing actions to the renderer.
//
//   server -> {type: 'recording_started'} | {type: 'record', record: {...}}
//             | {type: 'picked', pick: {...}} | {type: 'recording_stopped'}
//   client -> {type: 'start', human?: boolean} | {type: 'stop'}
//             | {type: 'mode', mode: 'recording'|'picker'|'off'}
//
// Exactly ONE recording session exists at a time (a second connect replaces
// the first). Nothing flows when recording is off: the page listener is only
// injected and switched into 'recording' mode after an explicit 'start' frame,
// so there is no injection and no endpoint traffic for profiles that are not
// being recorded.
import type { Duplex } from 'stream';
import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import puppeteer, { type Browser } from 'puppeteer-core';
import type { CDPSession } from 'puppeteer-core';
import { getCdpEndpoint, getRunningWs } from '../launcher/chromium';
import { logger } from '../util/logger';
import { checkTunnelAuth } from '../api/cdpTunnel';
import {
  buildRecorderListenerSource,
  RECORDER_BINDING,
  RECORDER_MODE_RECORDING,
  RECORDER_MODE_OFF,
  ListenerRecord,
  PickerRecord,
} from './listener';

interface RecorderSession {
  ws: WebSocket | null;
  profileId: string | null;
  human: boolean;
}

let session: RecorderSession | null = null;
let wss: WebSocketServer | null = null;

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function runBridge(ws: WebSocket, profileId: string): Promise<void> {
  // One profile at a time: a new recorder connection replaces any previous one
  // (its disconnect tears the old page listener down).
  if (session?.ws && session.ws !== ws) {
    session.ws.close();
  }
  session = { ws, profileId, human: false };

  const ep = getCdpEndpoint(profileId);
  if (!ep) {
    send(ws, { type: 'error', message: 'profile is not running' });
    ws.close();
    return;
  }

  let browser: Browser | undefined;
  let page: CDPSession | undefined;
  let cleaned = false;

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      page?.removeAllListeners();
    } catch {
      // already gone
    }
    try {
      browser?.disconnect();
    } catch {
      // already gone
    }
    if (session?.ws === ws) {
      session.ws = null;
      session.profileId = null;
      session.human = false;
    }
  };

  try {
    const wsUrl = getRunningWs(profileId);
    if (!wsUrl) throw new Error('profile browser not reachable');
    browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
    const targets = browser.targets();
    const pageTarget = targets.find((t) => t.type() === 'page');
    if (!pageTarget) throw new Error('profile has no page target');
    page = await pageTarget.createCDPSession();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Runtime.addBinding', { name: RECORDER_BINDING });

    // Install the capture listener on the current document AND every future
    // document. A chrome:// start page may reject the evaluate — the
    // new-document injection still applies for the user's sites.
    const source = buildRecorderListenerSource();
    try {
      await page.send('Runtime.evaluate', { expression: source });
    } catch {
      // current document may be chrome://; new-document injection covers future ones
    }
    await page
      .send('Page.addScriptToEvaluateOnNewDocument', { source })
      .catch(() => undefined);

    // Page -> bridge: capture records and picker reports.
    page.on('Runtime.bindingCalled', (ev: { name?: string; payload?: string }) => {
      if (ev.name !== RECORDER_BINDING || !ev.payload) return;
      let parsed: ListenerRecord | PickerRecord;
      try {
        parsed = JSON.parse(ev.payload) as ListenerRecord | PickerRecord;
      } catch {
        return;
      }
      if (parsed.kind === 'pick') {
        const pick = parsed as PickerRecord;
        send(ws, { type: 'picked', pick });
        logger.info('recorder picker', { profileId, selector: pick.selector });
      } else {
        const record = parsed as ListenerRecord;
        send(ws, { type: 'record', record });
        logger.info('recorder record', { profileId, kind: record.kind });
      }
    });

    // Client -> bridge: start/stop/mode. The listener is inert (mode 'off')
    // until an explicit 'start' or 'mode' frame arrives.
    ws.on('message', (data: unknown) => {
      if (cleaned) return;
      let message: { type?: string; human?: boolean; mode?: string };
      try {
        message = JSON.parse(String(data)) as { type?: string; human?: boolean; mode?: string };
      } catch {
        return;
      }
      const flipMode = (mode: string, human: boolean): Promise<void> => {
        if (session?.ws === ws) session.human = human;
        return modeFlip(page, mode);
      };
      void (async () => {
        if (message.type === 'mode') {
          const mode = message.mode ?? RECORDER_MODE_OFF;
          const human = mode === RECORDER_MODE_RECORDING && message.human === true;
          await flipMode(mode, human);
          return;
        }
        if (message.type === 'start') {
          await flipMode(RECORDER_MODE_RECORDING, message.human === true);
          send(ws, { type: 'recording_started' });
          return;
        }
        if (message.type === 'stop') {
          await flipMode(RECORDER_MODE_OFF, false);
          send(ws, { type: 'recording_stopped' });
          return;
        }
      })().catch((err: Error) => {
        send(ws, { type: 'error', message: `bridge error: ${err.message}` });
      });
    });

    ws.on('close', () => cleanup());
    ws.on('error', () => cleanup());
    page.on('disconnected', () => cleanup());
    browser.on('disconnected', () => cleanup());

    // Page navigated to a fresh document: reapply the current mode so capture
    // keeps working across user navigation (a fresh document starts 'off').
    page.on('Page.frameNavigated', (frame: { frame?: { url?: string; parentId?: string } }) => {
      const url = frame?.frame?.url;
      if (!url || frame?.frame?.parentId) return;
      const human = session?.ws === ws && session.human === true;
      void modeFlip(page, human ? RECORDER_MODE_RECORDING : RECORDER_MODE_OFF).catch(() => undefined);
    });

    send(ws, { type: 'recording_started' });
  } catch (err) {
    send(ws, { type: 'error', message: `recorder bridge failed: ${(err as Error).message}` });
    ws.close();
    cleanup();
  }
}

/** Flip the in-page listener mode (recording / picker / off) via CDP. */
async function modeFlip(page: CDPSession | undefined, mode: string): Promise<void> {
  if (!page) return;
  const expr = `(function () { try { window.__flowRecorderSetMode(${JSON.stringify(mode)}); } catch (e) {} })()`;
  await page.send('Runtime.evaluate', { expression: expr, returnByValue: true });
}

/**
 * Registers the recorder WS upgrade handler on the API HTTP server.
 * Auth: the same tunnel key contract as the CDP tunnel / motion bridge.
 */
export function createRecorderUpgradeHandler(getExpectedKey: () => string) {
  const server = new WebSocketServer({ noServer: true });
  wss = server;

  return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    const m = url.match(/^\/recorder\/([^/?]+)(\?.*)?$/);
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
    if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }
    server.handleUpgrade(req as never, socket, head, (ws) => {
      void runBridge(ws as WebSocket, profileId);
    });
    return true;
  };
}

/** Active recording state, for status queries and teardown. */
export function getRecorderState(): { wsOpen: boolean; profileId: string | null; human: boolean } {
  if (!session) return { wsOpen: false, profileId: null, human: false };
  return {
    wsOpen: !!session.ws && session.ws.readyState === WebSocket.OPEN,
    profileId: session.profileId,
    human: session.human === true,
  };
}

/** Close any active recorder session (service shutdown / test teardown). */
export function closeRecorderSession(): void {
  if (!session) return;
  try {
    session.ws?.close();
  } catch {
    // already gone
  }
  session = null;
  wss = null;
}
