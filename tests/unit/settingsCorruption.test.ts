// Regression guard for a corrupt settings file.
//
// THE BUG THIS PINS
// `readSettings()` caught a parse failure and returned `{}`. The next `writeSettings` then
// persisted those defaults over the file, so a truncated write — a crash mid-save, a power
// cut — silently destroyed the operator's chosen data directory, ports and paths, with no
// copy left to recover them from.
//
// The assertion is that the broken bytes SURVIVE the recovery, not merely that defaults are
// returned: the previous behaviour also returned defaults, which is precisely why the loss
// went unnoticed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-settings-guard-'));
  // `ANTIDETECT_SETTINGS_DIR` is the override the app itself uses; pointing it at a scratch
  // directory keeps the operator's real settings out of the test.
  process.env.ANTIDETECT_SETTINGS_DIR = dir;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ANTIDETECT_SETTINGS_DIR;
});

/** Re-import the module so the settings path is re-resolved for this test's directory. */
async function freshConfig() {
  const mod = await import('../../src/main/config?t=' + Date.now());
  return mod as typeof import('../../src/main/config');
}

describe('a corrupt settings file is preserved, not discarded', () => {
  it('keeps a copy of the unparseable file and still returns defaults', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    const broken = '{"dataDir": "/home/operator/profiles", "port": 50325';
    fs.writeFileSync(settingsPath, broken, 'utf8');

    const { readSettings } = await freshConfig();
    expect(readSettings()).toEqual({});

    // The damaged contents must still exist somewhere, or the operator has no way to recover
    // the path they had chosen.
    const rescued = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(rescued.length, 'the unreadable settings file must be kept aside').toBe(1);
    expect(fs.readFileSync(path.join(dir, rescued[0]), 'utf8')).toBe(broken);
  });

  it('does not create a .corrupt file on a first run', async () => {
    // A missing file is not damage. Quarantining it would litter the directory on every
    // fresh install and make a real corruption harder to spot.
    const { readSettings } = await freshConfig();
    expect(readSettings()).toEqual({});
    expect(fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))).toEqual([]);
  });

  it('reads a valid file unchanged', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ dataDir: '/tmp/profiles', port: 1234 }), 'utf8');
    const { readSettings } = await freshConfig();
    expect(readSettings()).toEqual({ dataDir: '/tmp/profiles', port: 1234 });
    expect(fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))).toEqual([]);
  });
});
