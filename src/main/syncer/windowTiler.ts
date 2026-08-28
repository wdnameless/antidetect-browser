// Window tiler (Sprint 3.3): arrange session windows into a grid through CDP
// Browser.setWindowBounds. Layouts: 2x2, 3x3, auto (smallest fitting grid).
//
// The work area is approximated from the first participant's screen metrics
// (CDP Browser.getWindowBounds + Runtime screen info); windows are placed in
// equal cells. Every call is best-effort per window — one unresponsive window
// never blocks the rest.
import puppeteer from 'puppeteer-core';
import { getRunningWs } from '../launcher/chromium';
import { logger } from '../util/logger';

export type TileLayout = '2x2' | '3x3' | 'auto';

export interface TileResult {
  tiled: string[];
  failed: Array<{ profile_id: string; error: string }>;
}

interface Grid {
  cols: number;
  rows: number;
}

function resolveGrid(layout: TileLayout, count: number): Grid {
  if (layout === '2x2') return { cols: 2, rows: 2 };
  if (layout === '3x3') return { cols: 3, rows: 3 };
  // auto: smallest grid that fits
  if (count <= 2) return { cols: count, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 3 };
}

interface WindowInfo {
  windowId: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  state?: string;
}

/** Query the first page target's window via Browser.getWindowForTarget. */
async function getWindowInfo(ws: string): Promise<WindowInfo | null> {
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  try {
    const targets = await browser.targets();
    const pageTarget = targets.find((t) => t.type() === 'page');
    if (!pageTarget) return null;
    const session = await pageTarget.createCDPSession();
    const res = (await session.send('Browser.getWindowForTarget')) as {
      windowId: number;
      bounds?: { left?: number; top?: number; width?: number; height?: number; windowState?: string };
    };
    await session.detach().catch(() => undefined);
    return {
      windowId: res.windowId,
      x: res.bounds?.left,
      y: res.bounds?.top,
      width: res.bounds?.width,
      height: res.bounds?.height,
      state: res.bounds?.windowState,
    };
  } finally {
    browser.disconnect();
  }
}

/** Screen metrics of the browser's current monitor (via CDP Runtime). */
async function getScreenMetrics(ws: string): Promise<{ left: number; top: number; width: number; height: number }> {
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  try {
    const targets = await browser.targets();
    const pageTarget = targets.find((t) => t.type() === 'page');
    if (!pageTarget) return { left: 0, top: 0, width: 1920, height: 1080 };
    const session = await pageTarget.createCDPSession();
    try {
      const r = (await session.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          l: (window.screen.availLeft != null ? window.screen.availLeft : 0),
          t: (window.screen.availTop != null ? window.screen.availTop : 0),
          w: window.screen.availWidth, h: window.screen.availHeight
        })`,
        returnByValue: true,
      })) as { result?: { value?: string } };
      const m = JSON.parse(r.result?.value || '{}') as { l?: number; t?: number; w?: number; h?: number };
      if (m.w && m.w > 0 && m.h && m.h > 0) {
        return { left: m.l ?? 0, top: m.t ?? 0, width: m.w, height: m.h };
      }
    } finally {
      await session.detach().catch(() => undefined);
    }
  } finally {
    browser.disconnect();
  }
  return { left: 0, top: 0, width: 1920, height: 1080 };
}

async function applyBounds(
  ws: string,
  windowId: number,
  bounds: { left: number; top: number; width: number; height: number }
): Promise<void> {
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  try {
    const targets = await browser.targets();
    const pageTarget = targets.find((t) => t.type() === 'page');
    if (!pageTarget) throw new Error('no page target');
    const session = await pageTarget.createCDPSession();
    try {
      // Restore a maximized/minimized window first so bounds apply.
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: Math.round(bounds.left), top: Math.round(bounds.top), width: Math.round(bounds.width), height: Math.round(bounds.height) },
      });
    } finally {
      await session.detach().catch(() => undefined);
    }
  } finally {
    browser.disconnect();
  }
}

export async function tileSession(profileIds: string[], layout: TileLayout): Promise<TileResult> {
  const grid = resolveGrid(layout, profileIds.length);
  const result: TileResult = { tiled: [], failed: [] };

  const infos: Array<{ profileId: string; ws: string; win: WindowInfo; screen: { left: number; top: number; width: number; height: number } }> = [];
  for (const pid of profileIds) {
    const ws = getRunningWs(pid);
    if (!ws) {
      result.failed.push({ profile_id: pid, error: 'not running' });
      continue;
    }
    try {
      const win = await getWindowInfo(ws);
      if (!win) {
        result.failed.push({ profile_id: pid, error: 'no window' });
        continue;
      }
      const screen = await getScreenMetrics(ws);
      infos.push({ profileId: pid, ws, win, screen });
    } catch (err) {
      result.failed.push({ profile_id: pid, error: (err as Error).message });
    }
  }
  if (infos.length === 0) return result;

  // Work area: shared screen of the first window.
  const screen = infos[0].screen;
  const cellW = screen.width / grid.cols;
  const cellH = screen.height / grid.rows;

  for (let i = 0; i < infos.length && i < grid.cols * grid.rows; i++) {
    const info = infos[i];
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    const bounds = {
      left: screen.left + col * cellW,
      top: screen.top + row * cellH,
      width: cellW,
      height: cellH,
    };
    try {
      await applyBounds(info.ws, info.win.windowId, bounds);
      result.tiled.push(info.profileId);
    } catch (err) {
      logger.warn('syncer tile failed', { profileId: info.profileId, error: (err as Error).message });
      result.failed.push({ profile_id: info.profileId, error: (err as Error).message });
    }
  }
  return result;
}