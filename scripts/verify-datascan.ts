import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const h = { Authorization: `Bearer ${getApiKey()}` };
  const r = await fetch(`http://${API_HOST}:${API_PORT}/api/v1/data/scan`, { headers: h }).then((x) => x.json());
  console.log('current:', r.data.current);
  for (const f of r.data.found) {
    console.log(`${f.profiles} profiles | ${f.dir} | ${new Date(f.modified).toISOString()} | ${(f.dbSize / 1024).toFixed(0)}KB`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
