import express, { Express, Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import cors from 'cors';
import { API_HOST, API_PORT, DATA_DIR, SERVER_MODE, TRUSTED_HOSTS } from '../config';
import { authMiddleware } from './auth';
import { rateLimitMiddleware } from './rateLimit';
import { createCdpRouter, tryHandleCdpUpgrade } from './cdpTunnel';
import { createViewerUpgradeHandler } from './viewer';
import { PANEL_HTML } from './uiPanel';
import { getCdpEndpoint } from '../launcher/chromium';
import { getApiKey } from '../config';
import browserRoutes from './routes/browser';
import proxyRoutes from './routes/proxy';
import deviceRoutes from './routes/device';
import cookiesRoutes from './routes/cookies';
import extensionsRoutes from './routes/extensions';
import batchRoutes from './routes/batch';
import logsRoutes from './routes/logs';
import kernelRoutes from './routes/kernel';

const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function hostAllowed(host: string): boolean {
  if (LOOPBACK_HOST_RE.test(host)) return true;
  if (!SERVER_MODE) return false;
  const bare = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  return TRUSTED_HOSTS.includes(bare);
}

/** Minimal append-only request log for server mode (DATA_DIR/server.log). */
function logRequest(req: Request, res: Response, ms: number): void {
  try {
    const line = `${new Date().toISOString()} ${req.ip || '-'} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms\n`;
    fs.appendFileSync(path.join(DATA_DIR, 'server.log'), line, 'utf8');
  } catch {
    // logging must never break the API
  }
}

export function startApi(): Promise<void> {
  const app: Express = express();
  app.use(express.json());

  if (SERVER_MODE) {
    // Behind a reverse proxy on a trusted network: same-origin only (the web
    // panel is served by this service), every call logged to file.
    app.use((req, res, next) => {
      const t0 = Date.now();
      res.on('finish', () => logRequest(req, res, Date.now() - t0));
      next();
    });
  } else {
    app.use(cors());
  }

  // DNS-rebinding protection: only loopback Host headers are accepted locally.
  // In server mode, explicitly trusted hosts (reverse proxy / VPN entry points)
  // are allowed too — configure via ANTIDETECT_TRUSTED_HOSTS.
  app.use((req, res, next) => {
    const host = String(req.headers.host || '');
    if (hostAllowed(host)) {
      next();
      return;
    }
    res.status(403).json({ code: -1, msg: 'forbidden host', data: {} });
  });

  // Health check (no auth)
  app.get('/status', (_req, res) => {
    res.json({ code: 0, msg: 'success', data: { status: 'ok', version: '0.0.1' } });
  });

  // Web panel (public assets; API calls inside carry the key themselves)
  app.get('/ui', (_req, res) => {
    res.type('html').send(PANEL_HTML);
  });

  // Everything below requires Bearer auth
  app.use(authMiddleware);
  // CDP tunnel before rate limiting — automation traffic streams through it
  // continuously and must not be throttled.
  app.use(createCdpRouter(getCdpEndpoint));
  // AdsPower-parity rate limits (1 req/s on list/cookies endpoints).
  app.use(rateLimitMiddleware);
  app.use(browserRoutes);
  app.use(proxyRoutes);
  app.use(deviceRoutes);
  app.use(cookiesRoutes);
  app.use(extensionsRoutes);
  app.use(batchRoutes);
  app.use(logsRoutes);
  app.use(kernelRoutes);

  // JSON 404 for unknown routes (Express default would return HTML).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: -1, msg: 'not found', data: {} });
  });

  // Central error handler: always answer JSON, never the Express HTML error page.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[antidetect] API error:', err);
    res.status(500).json({ code: -1, msg: err?.message ?? 'internal error', data: {} });
  });

  const server = http.createServer(app);
  // Single upgrade dispatcher: CDP tunnel and remote viewer share the port.
  const viewerUpgrade = createViewerUpgradeHandler(getApiKey);
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url.startsWith('/cdp-view/')) {
      viewerUpgrade(req, socket, head);
      return;
    }
    if (tryHandleCdpUpgrade(req, socket, head, getCdpEndpoint, getApiKey)) return;
    socket.destroy();
  });

  return new Promise((resolve) => {
    server.listen(API_PORT, API_HOST, () => {
      console.log(
        `[antidetect] Local API listening on http://${API_HOST}:${API_PORT}` +
          (SERVER_MODE ? ' (server mode)' : '')
      );
      resolve();
    });
  });
}
