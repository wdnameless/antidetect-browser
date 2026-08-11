import express, { Express } from 'express';
import cors from 'cors';
import { API_HOST, API_PORT } from '../config';
import { authMiddleware } from './auth';
import browserRoutes from './routes/browser';
import proxyRoutes from './routes/proxy';
import deviceRoutes from './routes/device';
import cookiesRoutes from './routes/cookies';
import extensionsRoutes from './routes/extensions';
import batchRoutes from './routes/batch';

export function startApi(): Promise<void> {
  const app: Express = express();
  app.use(cors());
  app.use(express.json());

  // Health check (no auth)
  app.get('/status', (_req, res) => {
    res.json({ code: 0, msg: 'success', data: { status: 'ok', version: '0.0.1' } });
  });

  // Everything below requires Bearer auth
  app.use(authMiddleware);
  app.use(browserRoutes);
  app.use(proxyRoutes);
  app.use(deviceRoutes);
  app.use(cookiesRoutes);
  app.use(extensionsRoutes);
  app.use(batchRoutes);

  return new Promise((resolve) => {
    app.listen(API_PORT, API_HOST, () => {
      console.log(`[antidetect] Local API listening on http://${API_HOST}:${API_PORT}`);
      resolve();
    });
  });
}
