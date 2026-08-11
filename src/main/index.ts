import { initDb } from './db';
import { startApi } from './api/server';
import { getApiKey, API_HOST, API_PORT } from './config';
import { seedDevices } from './devices/deviceManager';

export async function startService(): Promise<void> {
  await initDb();
  seedDevices();
  await startApi();
  console.log(`[antidetect] ready. API key: ${getApiKey()}`);
  console.log(`[antidetect] try: curl http://${API_HOST}:${API_PORT}/status`);
}

// Allow running the backend standalone (without Electron): `npm run service`
if (require.main === module) {
  startService().catch((err) => {
    console.error('[antidetect] fatal', err);
    process.exit(1);
  });
}
