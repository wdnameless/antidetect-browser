// Verify Phase 4: data directory setting persists across restarts (settings.json).
// Run: npx tsx scripts/verify-data-dir.ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SETTINGS_DIR = path.join(os.tmpdir(), 'ab-settings-' + Date.now());
const NEW_DIR = path.join(os.tmpdir(), 'ab-data-' + Date.now());

function run(mode: string): string {
  const script = `
    process.env.ANTIDETECT_SETTINGS_DIR = ${JSON.stringify(SETTINGS_DIR)};
    delete process.env.ANTIDETECT_DATA_DIR;
    const { getDataDir, setDataDir } = require(${JSON.stringify(path.resolve('dist/src/main/config.js'))});
    if (${JSON.stringify(mode)} === 'set') {
      const before = getDataDir();
      setDataDir(${JSON.stringify(NEW_DIR)});
      console.log('BEFORE=' + before);
    } else {
      console.log('AFTER=' + getDataDir());
    }
  `;
  return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  // Phase A: fresh settings dir -> default <settings>/data; then setDataDir(NEW_DIR).
  const outA = run('set');
  console.log(outA);
  const before = outA.match(/BEFORE=(.+)/)?.[1] ?? '';
  const defaultOk = before === path.join(SETTINGS_DIR, 'data');
  console.log('DEFAULT DIR (settings/data):', defaultOk ? 'PASS' : 'FAIL', before);

  // setDataDir persists to settings.json (applies after restart).
  const settings = JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR, 'settings.json'), 'utf8'));
  const setOk = settings.dataDir === NEW_DIR;
  console.log('SET DIR (settings.json):', setOk ? 'PASS' : 'FAIL', settings.dataDir);

  // Phase B: fresh process, same settings dir -> must resolve to NEW_DIR.
  const outB = run('check');
  console.log(outB);
  const after = outB.match(/AFTER=(.+)/)?.[1] ?? '';
  const persistOk = after === NEW_DIR;
  console.log('PERSISTED ACROSS RESTART:', persistOk ? 'PASS' : 'FAIL', after);

  // Cleanup
  try { fs.rmSync(SETTINGS_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(NEW_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  process.exit(defaultOk && setOk && persistOk ? 0 : 2);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
