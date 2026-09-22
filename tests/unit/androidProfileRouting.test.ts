// The shared profile launch surface must reach the Android runtime.
//
// Why this needs a test at all: `/api/v1/browser/start` is the surface automations already
// call, and `resolveLaunchConfig()` reports `chromium` for every profile that is not firefox —
// including `android`. So before this was wired, starting an Android profile through the
// documented surface launched a desktop browser for it, silently and successfully. The
// regression worth guarding is therefore not "does the emulator boot" but "is an android
// profile dispatched to the Android runtime instead of falling through to chromium".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';

interface Harness {
  url: (p: string) => string;
  close: () => Promise<void>;
  calls: { launched: string[]; stopped: string[]; chromiumStarted: number; firefoxStarted: number };
}

/**
 * Mounts the real browser router with its neighbours stubbed, so the test exercises the ROUTE's
 * dispatch decision without a database, an emulator, or a browser binary.
 */
async function mountBrowserRouter(opts: {
  browserType: 'chromium' | 'firefox' | 'android';
  launch?: (id: string) => Promise<unknown>;
}): Promise<Harness> {
  vi.resetModules();

  const calls = { launched: [] as string[], stopped: [] as string[], chromiumStarted: 0, firefoxStarted: 0 };

  vi.doMock('../../src/main/profiles/profileManager', () => ({
    getProfile: (id: string) => ({ id, browser_type: opts.browserType }),
    setStatus: () => true,
    // Deliberately reports chromium for anything non-firefox, which is exactly the trap: an
    // android profile that reaches this call is treated as a desktop browser.
    resolveLaunchConfig: (id: string) => ({ profileId: id, browserType: 'chromium' }),
    listProfiles: () => ({ list: [], total: 0 }),
  }));

  vi.doMock('../../src/main/launcher/chromium', () => ({
    startProfile: async () => {
      calls.chromiumStarted += 1;
      return { ws: {}, debug_port: '0' };
    },
    stopProfile: async () => undefined,
    getCdpEndpoint: () => undefined,
  }));

  vi.doMock('../../src/main/launcher/firefox', () => ({
    startFirefox: async () => {
      calls.firefoxStarted += 1;
      return { ok: true, url: 'about:blank', title: 'x' };
    },
    stopFirefox: async () => ({ ok: true }),
  }));

  vi.doMock('../../src/main/android/instance', () => ({
    launchAndroidProfile: async (id: string) => {
      if (!opts.launch) {
        calls.launched.push(id);
        return { profileId: id, state: 'running' };
      }
      return opts.launch(id);
    },
    stopAndroidProfile: async (id: string) => {
      calls.stopped.push(id);
      return true;
    },
  }));

  vi.doMock('../../src/main/proxy/proxyManager', () => ({ checkProxy: async () => ({ ok: true }) }));
  vi.doMock('../../src/main/config', () => ({ SERVER_MODE: false }));

  const { default: router } = await import('../../src/main/api/routes/browser');
  const app: Express = express();
  app.use(express.json());
  app.use(router);

  const server = http.createServer(app);
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    url: (p: string) => `http://127.0.0.1:${port}${p}`,
    close: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
    calls,
  };
}

describe('android profiles on the shared profile surface', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../../src/main/profiles/profileManager');
    vi.doUnmock('../../src/main/launcher/chromium');
    vi.doUnmock('../../src/main/launcher/firefox');
    vi.doUnmock('../../src/main/android/instance');
    vi.doUnmock('../../src/main/proxy/proxyManager');
    vi.doUnmock('../../src/main/config');
    vi.resetModules();
  });

  it('starts an android profile through /api/v1/browser/start instead of launching chromium', async () => {
    const s = await mountBrowserRouter({ browserType: 'android' });
    try {
      const url = s.url('/api/v1/browser/start?user_id=p-android');
      const res = await fetch(url);
      const body = (await res.json()) as { code: number; data: { browser_type?: string } };

      expect(body.code).toBe(0);
      expect(body.data.browser_type).toBe('android');
      expect(s.calls.launched).toEqual(['p-android']);
      expect(s.calls.chromiumStarted, 'an android profile must not reach the chromium launcher').toBe(0);
    } finally {
      await s.close();
    }
  });

  it('stops an android profile through /api/v1/browser/stop without calling the browser launcher', async () => {
    const s = await mountBrowserRouter({ browserType: 'android' });
    try {
      const url = s.url('/api/v1/browser/stop?user_id=p-android');
      const res = await fetch(url);
      expect(((await res.json()) as { code: number }).code).toBe(0);
      expect(s.calls.stopped).toEqual(['p-android']);
    } finally {
      await s.close();
    }
  });

  it('reports a not-ready engine as 409 rather than a generic failure', async () => {
    const s = await mountBrowserRouter({
      browserType: 'android',
      launch: async () => {
        const err = new Error('Android engine is not installed') as Error & { code: string };
        err.code = 'NOT_READY';
        throw err;
      },
    });
    try {
      const url = s.url('/api/v1/browser/start?user_id=p-android');
      const res = await fetch(url);
      const body = (await res.json()) as { code: string };
      expect(res.status).toBe(409);
      expect(body.code).toBe('NOT_READY');
    } finally {
      await s.close();
    }
  });

  it('leaves a chromium profile on the chromium path', async () => {
    const s = await mountBrowserRouter({ browserType: 'chromium' });
    try {
      const url = s.url('/api/v1/browser/start?user_id=p-desktop');
      const res = await fetch(url);
      expect(((await res.json()) as { code: number }).code).toBe(0);
      expect(s.calls.chromiumStarted).toBe(1);
      expect(s.calls.launched, 'a desktop profile must not be dispatched to the Android runtime').toEqual([]);
    } finally {
      await s.close();
    }
  });
});
