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
import { createMotionUpgradeHandler } from './motionBridge';
import { createRecorderUpgradeHandler } from '../recorder/bridge';
import { PANEL_HTML } from './uiPanel';
import { panelAuthRouter } from './panelAuth';
import { getCdpEndpoint } from '../launcher/chromium';
import { getApiKey } from '../config';
import browserRoutes from './routes/browser';
import proxyRoutes from './routes/proxy';
import proxyHealthRoutes from './routes/proxyHealth';
import deviceRoutes from './routes/device';
import emailRoutes from './routes/email';
import cookiesRoutes from './routes/cookies';
import extensionsRoutes from './routes/extensions';
import batchRoutes from './routes/batch';
import logsRoutes from './routes/logs';
import kernelRoutes from './routes/kernel';
import cloudRoutes from './routes/cloud';
import teamsRoutes from './routes/teams';
import syncRoutes from './routes/sync';
import licensingRoutes from './routes/licensing';
import vaultRoutes from './routes/vault';
import diagnosticsRoutes from './routes/diagnostics';
import tagsRoutes from './routes/tags';
import trashRoutes from './routes/trash';
import profilesRoutes from './routes/profiles';
import syncerRoutes from './routes/syncer';
import scriptsRoutes from './routes/scripts';
import keysRoutes from './routes/keys';
import triggersRoutes from './routes/triggers';
import taskGroupsRoutes from './routes/taskGroups';
import flowsRoutes from './routes/flows';
import catalogRoutes from './routes/catalog';
import preflightRoutes from './routes/preflight';
import cookieRobotRoutes from './routes/cookieRobot';
import settingsRoutes from './routes/settings';
import { motionRouter } from './routes/motion';

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
export function createApp(): Express {
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

  const rendererDir = [
    path.resolve(process.cwd(), 'dist/renderer'),
    path.resolve(__dirname, '../../../dist/renderer'),
    path.resolve(__dirname, '../../dist/renderer'),
    path.resolve(__dirname, '../renderer'),
  ].find((p) => fs.existsSync(p)) || path.resolve(process.cwd(), 'dist/renderer');

  const brandFaviconPath = [
    path.resolve(process.cwd(), 'assets/brand/favicon.ico'),
    path.resolve(__dirname, '../../../assets/brand/favicon.ico'),
  ].find((p) => fs.existsSync(p));

  // Favicon (unauthenticated)
  app.get('/favicon.ico', (_req, res) => {
    if (brandFaviconPath && fs.existsSync(brandFaviconPath)) {
      res.sendFile(brandFaviconPath);
      return;
    }
    const distFavicon = path.join(rendererDir, 'favicon.ico');
    if (fs.existsSync(distFavicon)) {
      res.sendFile(distFavicon);
      return;
    }
    res.status(204).end();
  });

  // Web panel (legacy /ui html)
  app.get('/ui', (_req, res) => {
    res.type('html').send(PANEL_HTML);
  });

  // Static assets from built renderer (unauthenticated)
  if (fs.existsSync(rendererDir)) {
    app.use(express.static(rendererDir, { index: false }));
  } else {
    console.warn('[antidetect] Web renderer build not found at dist/renderer. Static UI will not be served.');
  }

  // SPA route fallback: serve index.html before authMiddleware for non-API/non-UI GET requests
  const isApiOrInternalPath = (urlPath: string): boolean => {
    return (
      urlPath.startsWith('/api/') ||
      urlPath.startsWith('/api') ||
      urlPath.startsWith('/ui/') ||
      urlPath.startsWith('/ui') ||
      urlPath.startsWith('/cdp') ||
      urlPath.startsWith('/browser') ||
      urlPath.startsWith('/status') ||
      urlPath.startsWith('/motion') ||
      urlPath.startsWith('/recorder') ||
      urlPath.startsWith('/fingerprint') ||
      urlPath.startsWith('/proxy') ||
      urlPath.startsWith('/profiles') ||
      urlPath.startsWith('/groups') ||
      urlPath.startsWith('/task-queue') ||
      urlPath.startsWith('/task-groups') ||
      urlPath.startsWith('/flows') ||
      urlPath.startsWith('/catalog') ||
      urlPath.startsWith('/preflight') ||
      urlPath.startsWith('/cookie-robot') ||
      urlPath.startsWith('/settings') ||
      urlPath.startsWith('/trash') ||
      urlPath.startsWith('/scripts') ||
      urlPath.startsWith('/teams') ||
      urlPath.startsWith('/cloud-sync')
    );
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const p = req.path || '';
    if (isApiOrInternalPath(p)) {
      next();
      return;
    }
    const indexPath = path.join(rendererDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    next();
  });
  // Panel login (username/password -> session token). Public routes with
  // their own brute-force protection.
  app.use(panelAuthRouter);

  // Everything below requires Bearer auth
  app.use(authMiddleware);
  // CDP tunnel before rate limiting — automation traffic streams through it
  // continuously and must not be throttled.
  app.use(createCdpRouter(getCdpEndpoint));
  // AdsPower-parity rate limits (1 req/s on list/cookies endpoints).
  app.use(rateLimitMiddleware);
  app.use(browserRoutes);
  app.use(proxyRoutes);
  app.use(proxyHealthRoutes);
  app.use(deviceRoutes);
  app.use('/api/v1/email', emailRoutes);
  app.use(cookiesRoutes);
  app.use(extensionsRoutes);
  app.use(batchRoutes);
app.use(logsRoutes);
app.use(kernelRoutes);
app.use(cloudRoutes);
app.use(teamsRoutes);
app.use(syncRoutes);
app.use(licensingRoutes);
app.use(vaultRoutes);
app.use(diagnosticsRoutes);
app.use(tagsRoutes);
app.use(trashRoutes);
app.use(profilesRoutes);
app.use(syncerRoutes);
app.use(scriptsRoutes);
app.use(keysRoutes);
app.use(triggersRoutes);
app.use(taskGroupsRoutes);
app.use(flowsRoutes);
app.use(catalogRoutes);
app.use(preflightRoutes);
app.use(cookieRobotRoutes);
app.use(settingsRoutes);
app.use(motionRouter);

  // JSON 404 for unknown routes (Express default would return HTML).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: -1, msg: 'not found', data: {} });
  });

  // Central error handler: always answer JSON, never the Express HTML error page.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[antidetect] API error:', err);
    res.status(500).json({ code: -1, msg: err?.message ?? 'internal error', data: {} });
  });
  return app;
}

export function startApi(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);
  // Single upgrade dispatcher: CDP tunnel and remote viewer share the port.
  const viewerUpgrade = createViewerUpgradeHandler(getApiKey);
  const motionUpgrade = createMotionUpgradeHandler(getApiKey);
  const recorderUpgrade = createRecorderUpgradeHandler(getApiKey);
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url.startsWith('/cdp-view/')) {
      viewerUpgrade(req, socket, head);
      return;
    }
    if (url.startsWith('/motion/')) {
      if (motionUpgrade(req, socket, head)) return;
      socket.destroy();
      return;
    }
    if (url.startsWith('/recorder/')) {
      if (recorderUpgrade(req, socket, head)) return;
      socket.destroy();
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
