import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { API_HOST, API_PORT } from '../config';
import { authMiddleware } from './auth';
import { rateLimitMiddleware } from './rateLimit';
import browserRoutes from './routes/browser';
import proxyRoutes from './routes/proxy';
import deviceRoutes from './routes/device';
import cookiesRoutes from './routes/cookies';
import extensionsRoutes from './routes/extensions';
import batchRoutes from './routes/batch';
import logsRoutes from './routes/logs';
import kernelRoutes from './routes/kernel';

export function startApi(): Promise<void> {
  const app: Express = express();
  app.use(cors());
  app.use(express.json());

  // DNS-rebinding protection: only loopback Host headers are accepted.
  // Legitimate clients (Electron renderer, local scripts, SDK) always target
  // 127.0.0.1 / localhost; a rebound foreign domain would fail here.
  app.use((req, res, next) => {
    const host = String(req.headers.host || '');
    if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) {
      next();
      return;
    }
    res.status(403).json({ code: -1, msg: 'forbidden host', data: {} });
  });

  // Health check (no auth)
  app.get('/status', (_req, res) => {
    res.json({ code: 0, msg: 'success', data: { status: 'ok', version: '0.0.1' } });
  });

  // Everything below requires Bearer auth
  app.use(authMiddleware);
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

  return new Promise((resolve) => {
    app.listen(API_PORT, API_HOST, () => {
      console.log(`[antidetect] Local API listening on http://${API_HOST}:${API_PORT}`);
      resolve();
    });
  });
}
