import * as path from 'path';
import { DbManager } from './db';
import { createServer } from './server';

const PORT = parseInt(process.env.PORT || '8787', 10);
const DATA_DIR = process.env.SYNC_DATA_DIR || path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'sync.db');

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || '60000',
  10
);

async function main() {
  const dbManager = new DbManager();
  const db = await dbManager.init(DB_FILE);

  const app = createServer({
    db,
    rateLimitMax: RATE_LIMIT_MAX,
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
    onPersist: () => dbManager.persist(),
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[sync-server] Listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    console.log('[sync-server] Shutting down...');
    server.close(() => {
      dbManager.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[sync-server] Fatal startup error:', err);
    process.exit(1);
  });
}

export { createServer, DbManager };
