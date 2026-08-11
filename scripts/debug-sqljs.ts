// Debug: isolate sql.js adapter failure.
import { initDb, getDb } from '../src/main/db';
import { createProfile, listProfiles } from '../src/main/profiles/profileManager';

async function main(): Promise<void> {
  await initDb();
  console.log('db initialized');
  const id = createProfile({ name: 'debug-test' });
  console.log('profile created:', id);
  const list = listProfiles(1, 10);
  console.log('list total:', list.total);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
