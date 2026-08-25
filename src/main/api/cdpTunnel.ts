// CDP tunnel: exposes per-profile Chromium DevTools endpoints (bound to
// 127.0.0.1 on a random port) through the single API port, so remote
// automation (Puppeteer / Playwright) can connect over VPN/reverse proxy.
//
//   HTTP:  /cdp/:sessionId/<devtools path>  -> streamed to 127.0.0.1:<port>
//   WS:    upgrade on the same prefix       -> raw TCP pipe to 127.0.0.1:<port>
//
// Auth: HTTP requests pass the regular Bearer middleware; WebSocket upgrades
// are not covered by Express middleware, so they accept `?key=<API key>`
// (Puppeteer cannot send custom Authorization headers on ws connect).
import { Router, Request, Response } from 'express';
import * as http from 'http';
import * as net from 'net';
import { timingSafeEqual } from 'crypto';
import type { Duplex } from 'stream';

export interface CdpResolver {
  (sessionId: string): { port: string; wsPath: string } | undefined;
}

const LOOPBACK = '127.0.0.1';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Extract `key` query param or Bearer header; timing-safe compare against expected. */
export function checkTunnelAuth(req: http.IncomingMessage, expectedKey: string): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const qk = url.searchParams.get('key') || '';
  if (qk && safeEqual(qk, expectedKey)) return true;
  const header = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return header.length > 0 && safeEqual(header, expectedKey);
}

function proxyHttp(req: Request, res: Response, sessionId: string, port: string): void {
  // Strip the /cdp/:sessionId prefix; keep the rest of path + query verbatim
  // (but never forward the tunnel auth key upstream).
  const prefix = `/cdp/${encodeURIComponent(sessionId)}`;
  let target = req.originalUrl || req.url || '/';
  if (target.startsWith(prefix)) target = target.slice(prefix.length) || '/';
  const qi = target.indexOf('?');
  if (qi !== -1) {
    const q = new URLSearchParams(target.slice(qi + 1));
    if (q.has('key')) {
      q.delete('key');
      const qs = q.toString();
      target = target.slice(0, qi) + (qs ? `?${qs}` : '');
    }
  }
  const upstream = http.request(
    {
      host: LOOPBACK,
      port: Number(port),
      method: req.method,
      path: target,
      headers: { ...req.headers, host: `${LOOPBACK}:${port}` },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ code: -1, msg: 'cdp upstream error', data: {} });
    else res.destroy();
  });
  req.pipe(upstream);
}

export function createCdpRouter(resolve: CdpResolver): Router {
  const router = Router();
  router.all(['/cdp/:sessionId', '/cdp/:sessionId/*'], (req: Request, res: Response) => {
    const ep = resolve(req.params.sessionId);
    if (!ep) {
      res.status(404).json({ code: -1, msg: 'profile is not running', data: {} });
      return;
    }
    proxyHttp(req, res, decodeURIComponent(req.params.sessionId), ep.port);
  });
  return router;
}

/**
 * Handle WebSocket upgrades for `/cdp/:sessionId/...` by piping the raw client
 * Handle a WebSocket upgrade for `/cdp/:sessionId/...` by piping the raw client
 * socket to the loopback DevTools port. The browser endpoint speaks plain
 * HTTP + WebSocket, so a transparent byte pipe is sufficient.
 *
 * Returns false when the path is not a CDP tunnel path (caller should try the
 * next handler); true when the upgrade was handled (accepted or rejected).
 */
export function tryHandleCdpUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  resolve: CdpResolver,
  getExpectedKey: () => string
): boolean {
  const url = req.url || '';
  const m = url.match(/^\/cdp\/([^/?]+)(\/.*)?$/);
  if (!m) return false;
  try {
    if (!checkTunnelAuth(req, getExpectedKey())) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return true;
    }
      const ep = resolve(decodeURIComponent(m[1]));
      if (!ep) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return true;
      }

      // Forwarded URL: drop the tunnel auth key before rebuilding the request.
      let fwdUrl = url;
      const qi = fwdUrl.indexOf('?');
      if (qi !== -1) {
        const q = new URLSearchParams(fwdUrl.slice(qi + 1));
        q.delete('key');
        const qs = q.toString();
        fwdUrl = fwdUrl.slice(0, qi) + (qs ? `?${qs}` : '');
      }

      // Rebuild the request line + headers verbatim, then forward any
      // already-buffered bytes.
      const lines: string[] = [`${req.method} ${fwdUrl} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      const raw = Buffer.concat([Buffer.from(lines.join('\r\n') + '\r\n\r\n'), head]);

      const upstream = net.connect(Number(ep.port), LOOPBACK, () => {
        upstream.write(raw);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      const teardown = (): void => {
        socket.destroy();
        upstream.destroy();
      };
      upstream.on('error', teardown);
      socket.on('error', teardown);
      upstream.on('close', teardown);
      return true;
    } catch {
      socket.destroy();
      return true;
    }
  }

