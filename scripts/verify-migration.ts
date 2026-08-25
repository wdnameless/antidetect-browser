// Verify data-folder migration logic (v0.2.28): copy data dir -> DB intact.
import { initDb, getDb, closeDb, flushDb } from '../src/main/db';
import { createProfile, listProfiles } from '../src/main/profiles/profileManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main(): Promise<void> {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-b-'));
  process.env.ANTIDETECT_DATA_DIR = dirA;

  await initDb();
  const id = createProfile({ name: 'migration-test', fingerprint_seed: 999111 });
  // also a fake user-data-dir + backup to prove folder copy
  fs.mkdirSync(path.join(dirA, 'profiles', id), { recursive: true });
  fs.writeFileSync(path.join(dirA, 'profiles', id, 'Cookies'), 'fake');
  fs.writeFileSync(path.join(dirA, 'junk.tmp'), 'must-not-copy');
  flushDb();
  closeDb();

  // migrate: copy A -> B (same filter as the IPC handler)
  await fs.promises.cp(dirA, dirB, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (src) => {
      const base = path.basename(src);
      return !base.endsWith('.tmp') && base !== 'service.lock' && !base.endsWith('.restore-tmp');
    },
  });

  // open the copied DB and verify
  process.env.ANTIDETECT_DATA_DIR = dirB;
  await initDb();
  const rows = listProfiles(1, 50);
  const found = rows.list.find((p) => p.user_id === id);
  const cookieCopied = fs.existsSync(path.join(dirB, 'profiles', id, 'Cookies'));
  const tmpExcluded = !fs.existsSync(path.join(dirB, 'junk.tmp'));

  console.log('PROFILE SURVIVES MIGRATION:', found?.name === 'migration-test' ? 'PASS' : 'FAIL');
  console.log('PROFILE USER-DATA-DIR COPIED:', cookieCopied ? 'PASS' : 'FAIL');
  console.log('TEMP FILES EXCLUDED:', tmpExcluded ? 'PASS' : 'FAIL');
  closeDb();
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
  process.exit(found && cookieCopied && tmpExcluded ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
