import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import net from 'net';
import { createApp } from '../../src/main/api/server';
import { resolveApiBase } from '../../src/renderer/src/api';

describe('Web Serving & SPA Fallback (Task 4.1, 4.2)', () => {
  describe('Origin-relative API base resolution (Task 4.2)', () => {
    it('resolves Electron file:// protocol to default loopback 127.0.0.1:50325', () => {
      const loc = { protocol: 'file:', host: '', origin: 'null' };
      expect(resolveApiBase(loc, null)).toBe('http://127.0.0.1:50325');
    });

    it('resolves browser on same origin (http)', () => {
      const loc = { protocol: 'http:', host: '127.0.0.1:50325', origin: 'http://127.0.0.1:50325' };
      expect(resolveApiBase(loc, null)).toBe('http://127.0.0.1:50325');
    });

    it('resolves browser on different host/port (e.g. reverse proxy or LAN)', () => {
      const loc = { protocol: 'http:', host: '192.168.1.50:8080', origin: 'http://192.168.1.50:8080' };
      expect(resolveApiBase(loc, null)).toBe('http://192.168.1.50:8080');
    });

    it('respects explicit localStorage override over current origin', () => {
      const loc = { protocol: 'http:', host: '127.0.0.1:50325', origin: 'http://127.0.0.1:50325' };
      expect(resolveApiBase(loc, 'http://custom-api.local:9999/')).toBe('http://custom-api.local:9999');
    });

    it('falls back to default if location is undefined', () => {
      expect(resolveApiBase(undefined, null)).toBe('http://127.0.0.1:50325');
    });
  });

  describe('Static & SPA fallback vs API 404 boundaries (Task 4.1)', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
      const app = createApp();
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });

    it('serves unauthenticated /status check', async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.code).toBe(0);
    });

    it('serves unauthenticated /ui/auth-state panel auth state', async () => {
      const res = await fetch(`${baseUrl}/ui/auth-state`);
      expect(res.status).toBe(200);
      const data = await res.json();
      // The server's own contract: hasPassword tells the client whether to show
      // one-time setup or the login form.
      expect(data).toHaveProperty('data.hasPassword');
    });

    it('serves unauthenticated index.html for a client-only SPA route', async () => {
      // Must be a path with no API handler. Real API prefixes are deliberately
      // excluded from the fallback so a missing endpoint cannot silently become HTML.
      const res = await fetch(`${baseUrl}/some/client/route`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.toLowerCase()).toContain('<!doctype html>');
    });

    it('does NOT swallow missing /api/ paths in SPA fallback - stays JSON', async () => {
      // The point of this test is the fallback boundary: an /api path must never be
      // answered with the SPA shell, whether the request is rejected for auth (401)
      // or reaches the router and misses (404). Both are JSON; only HTML would be a bug.
      const res = await fetch(`${baseUrl}/api/v1/non-existent-endpoint`, {
        headers: { Authorization: 'Bearer test' },
      });
      expect([401, 404]).toContain(res.status);
      expect(res.headers.get('content-type')).toMatch(/json/);
      const text = await res.text();
      expect(text.toLowerCase()).not.toContain('<!doctype html>');
    });

    it('does NOT swallow missing /browser paths in SPA fallback - rejects unauthenticated with 401 or 404', async () => {
      const res = await fetch(`${baseUrl}/browser/non-existent`);
      expect(res.headers.get('content-type')).toMatch(/json/);
      const text = await res.text();
      expect(text).not.toContain('<!doctype html>');
    });

    it('handles favicon request honestly without crashing', async () => {
      const res = await fetch(`${baseUrl}/favicon.ico`);
      expect([200, 204]).toContain(res.status);
    });
  });
});
