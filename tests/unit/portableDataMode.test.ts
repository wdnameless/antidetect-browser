// Portable data-mode resolution.
//
// The portable artefact must be relocatable: copy the folder to another drive or
// machine and the profiles come with it. That only works if the data path is
// derived from where the executable is running NOW, never from an absolute path
// captured on first run.
//
// electron-builder's `portable` target exports PORTABLE_EXECUTABLE_DIR; that env
// var is the signal for both "we are portable" and "where the folder lives".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveDataDir,
  isPortableMode,
  portableBaseDir,
} from '../../src/main/config';

let tmpRoot: string;
let settingsDir: string;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function writeSettingsFile(obj: Record<string, unknown>): void {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify(obj), 'utf8');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nulltrace-portable-'));
  settingsDir = path.join(tmpRoot, 'settings');
  setEnv('ANTIDETECT_SETTINGS_DIR', settingsDir);
  setEnv('ANTIDETECT_DATA_DIR', undefined);
  setEnv('PORTABLE_EXECUTABLE_DIR', undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('portable mode detection', () => {
  it('is off when the portable variable is absent', () => {
    expect(isPortableMode()).toBe(false);
    expect(portableBaseDir()).toBeNull();
  });

  it('is on when the portable variable is set', () => {
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    expect(isPortableMode()).toBe(true);
    expect(portableBaseDir()).toBe(tmpRoot);
  });
});

describe('data directory resolution order', () => {
  it('lets the explicit env override win over portable mode', () => {
    const override = path.join(tmpRoot, 'override');
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    setEnv('ANTIDETECT_DATA_DIR', override);
    expect(resolveDataDir()).toBe(override);
  });

  it('keeps a user-chosen directory winning over portable mode', () => {
    const chosen = path.join(tmpRoot, 'chosen');
    // The folder must look like an installation: `resolveDataDir` honours a recorded path only
    // while it exists AND holds data, because a moved USB stick carries the OLD machine's path
    // and treating it as valid would open an empty library there.
    fs.mkdirSync(path.join(chosen, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(chosen, 'antidetect.db'), 'fixture');
    writeSettingsFile({ dataDir: chosen });
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    expect(resolveDataDir()).toBe(chosen);
  });

  it('falls back to the portable folder when the recorded path belongs to another machine', () => {
    // The moved-stick case: the recorded folder is absent here, so the folder beside the
    // executable wins instead of resolving to a path that does not exist.
    writeSettingsFile({ dataDir: path.join(tmpRoot, 'not-here-on-this-machine') });
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    expect(resolveDataDir()).toBe(path.join(tmpRoot, 'data'));
  });

  it('resolves beside the executable in portable mode', () => {
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    expect(resolveDataDir()).toBe(path.join(tmpRoot, 'data'));
  });

  it('uses the system location when the operator chose system', () => {
    writeSettingsFile({ dataMode: 'system' });
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    expect(resolveDataDir()).toBe(path.join(settingsDir, 'data'));
  });

  it('uses the system default when not portable at all', () => {
    expect(resolveDataDir()).toBe(path.join(settingsDir, 'data'));
  });

  it('is relocatable: a different executable directory resolves to its own data', () => {
    // The point of portable: moving the folder moves the data with it, because the
    // path derives from the current location rather than a remembered absolute path.
    const a = path.join(tmpRoot, 'machine-a');
    const b = path.join(tmpRoot, 'machine-b');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });

    setEnv('PORTABLE_EXECUTABLE_DIR', a);
    const onA = resolveDataDir();
    expect(onA).toBe(path.join(a, 'data'));

    setEnv('PORTABLE_EXECUTABLE_DIR', b);
    const onB = resolveDataDir();
    expect(onB).toBe(path.join(b, 'data'));
    expect(onB).not.toBe(onA);
  });
});
