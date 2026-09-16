// First-run data-folder choice.
//
// The operator picks where profiles, the kernel and backups live, once, before any of them
// exist. Two things have to hold for that to be worth anything:
//
//   1. The prompt appears for a genuinely fresh install and never again afterwards —
//      re-asking someone who already has 40 GB of profiles would be a bug, and offering to
//      move a live database underneath a running service would be worse.
//   2. It does NOT appear where the location is imposed rather than chosen: a pinned
//      ANTIDETECT_DATA_DIR (CI, tests, managed deployments) or a headless server.
//
// The rule lives next to the resolution order in config.ts, so the prompt and the resolver
// cannot disagree about whether data already has a home.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  needsFirstRunDataChoice,
  setFirstRunDataChoice,
  defaultDataDir,
  isUsableDataDir,
  dataDirCollidesWithSettings,
  resolveDataDir,
  readSettings,
} from '../../src/main/config';

let tmpRoot: string;
let settingsDir: string;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nulltrace-firstrun-'));
  settingsDir = path.join(tmpRoot, 'settings');
  setEnv('ANTIDETECT_SETTINGS_DIR', settingsDir);
  setEnv('ANTIDETECT_DATA_DIR', undefined);
  setEnv('ANTIDETECT_SERVER_MODE', undefined);
  setEnv('ANTIDETECT_DATA_DIR_FROM_SHELL', undefined);
  setEnv('PORTABLE_EXECUTABLE_DIR', undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('when the first-run prompt is due', () => {
  it('is not due for an install upgraded from a version that recorded no choice', () => {
    // The dangerous case: the prompt ships in an upgrade, the operator already has data in
    // the default location, and nothing recorded that fact. Asking would invite them to pick
    // a fresh folder, and the app would then open an empty library — indistinguishable from
    // having lost everything. Existing data settles the question.
    //
    // The location must NOT be pinned here: `ANTIDETECT_DATA_DIR` short-circuits the prompt
    // on its own, which would make this pass no matter what the data check does.
    const dataDir = resolveDataDir();
    expect(process.env.ANTIDETECT_DATA_DIR).toBeUndefined();
    fs.mkdirSync(path.join(dataDir, 'profiles', 'abc123'), { recursive: true });
    expect(needsFirstRunDataChoice()).toBe(false);
  });

  it('is due on an install that only ran its bootstrap', () => {
    // What the app creates for itself on first start — the data dir, an empty profiles
    // folder, an empty database — must NOT count as an answer. An earlier revision treated
    // the folder's existence as "data present" and the prompt therefore never appeared.
    const dataDir = resolveDataDir();
    fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'antidetect.db'), '', 'utf8');
    expect(needsFirstRunDataChoice()).toBe(true);
  });

  it('is due on a fresh install', () => {
    // The state before any answer: no settings file at all.
    expect(needsFirstRunDataChoice()).toBe(true);
  });

  it('is not due once a directory has been recorded', () => {
    setFirstRunDataChoice({ dir: path.join(tmpRoot, 'data') });
    expect(needsFirstRunDataChoice()).toBe(false);
  });

  it('is not due once a portable/system mode has been recorded', () => {
    setFirstRunDataChoice({ mode: 'system' });
    expect(needsFirstRunDataChoice()).toBe(false);
  });

  it('is not due when the location is pinned by the environment', () => {
    // CI and tests pin the path; prompting there would hang an unattended run.
    setEnv('ANTIDETECT_DATA_DIR', path.join(tmpRoot, 'pinned'));
    expect(needsFirstRunDataChoice()).toBe(false);
  });

  it('is still due when the DESKTOP SHELL exported the data dir', () => {
    // The shell always exports a resolved ANTIDETECT_DATA_DIR so the sidecar agrees with it.
    // Treating that as an external pin suppressed the prompt on every desktop launch — the
    // feature would have shipped dead, which is exactly what a real install showed.
    setEnv('ANTIDETECT_DATA_DIR', path.join(tmpRoot, 'shell-resolved'));
    setEnv('ANTIDETECT_DATA_DIR_FROM_SHELL', '1');
    expect(needsFirstRunDataChoice()).toBe(true);
  });

  it('is not due when the shell exported a dir that already holds profiles', () => {
    // The mark makes the env var non-authoritative, so the real signals still decide.
    const shellDir = path.join(tmpRoot, 'shell-with-data');
    setEnv('ANTIDETECT_DATA_DIR', shellDir);
    setEnv('ANTIDETECT_DATA_DIR_FROM_SHELL', '1');
    fs.mkdirSync(path.join(shellDir, 'profiles', 'p1'), { recursive: true });
    expect(needsFirstRunDataChoice()).toBe(false);
  });

  it('is not due in server mode, where there is nobody to click', async () => {
    // Server mode is a property of the deployment, read once when the module loads (see
    // `SERVER_MODE` in config.ts), so the flag has to be set before the module is evaluated.
    setEnv('ANTIDETECT_SERVER_MODE', '1');
    vi.resetModules();
    const fresh = await import('../../src/main/config');
    expect(fresh.SERVER_MODE).toBe(true);
    expect(fresh.needsFirstRunDataChoice()).toBe(false);
  });

  it('is due on a portable launch whose answer was never recorded', () => {
    // Portable is the case the prompt was originally written for: the app sits on a stick
    // or a folder, and nothing has said whether data follows the app or the machine.
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    expect(needsFirstRunDataChoice()).toBe(true);
    // The proposed default follows the executable, so accepting it keeps the artefact
    // relocatable rather than anchoring it to this machine's user profile.
    expect(defaultDataDir()).toBe(path.join(tmpRoot, 'data'));
  });

  it('stops asking after a portable mode is chosen and resolves data beside the app', () => {
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    setFirstRunDataChoice({ mode: 'portable' });
    expect(readSettings().dataMode).toBe('portable');
    expect(needsFirstRunDataChoice()).toBe(false);
    expect(resolveDataDir()).toBe(path.join(tmpRoot, 'data'));
  });

  it('stops asking after a system mode is chosen and resolves data under the profile', () => {
    setEnv('PORTABLE_EXECUTABLE_DIR', tmpRoot);
    setFirstRunDataChoice({ mode: 'system' });
    expect(needsFirstRunDataChoice()).toBe(false);
    expect(resolveDataDir()).toBe(path.join(settingsDir, 'data'));
  });
});

describe('recording the choice', () => {
  it('stores the picked folder and the resolver honours it afterwards', () => {
    const picked = path.join(tmpRoot, 'my-profiles');
    setFirstRunDataChoice({ dir: picked });
    expect(readSettings().dataDir).toBe(picked);
    // The point of recording it: a later process resolves to the chosen folder.
    expect(resolveDataDir()).toBe(picked);
  });

  it('lets an explicit folder win over a previously recorded mode', () => {
    setFirstRunDataChoice({ mode: 'system' });
    const picked = path.join(tmpRoot, 'explicit');
    setFirstRunDataChoice({ dir: picked });
    expect(resolveDataDir()).toBe(picked);
  });

  it('lets a mode win over a previously recorded folder', () => {
    // Otherwise a stale path from an earlier choice would silently outrank the mode the
    // operator just picked, and the app would keep using a folder they moved away from.
    setFirstRunDataChoice({ dir: path.join(tmpRoot, 'old') });
    setFirstRunDataChoice({ mode: 'portable' });
    expect(readSettings().dataDir).toBeUndefined();
    expect(needsFirstRunDataChoice()).toBe(false);
  });

  it('proposes a default that is inside the app-owned base, not a bare root', () => {
    // The default has to be a path the app may create; proposing C:\ would be reckless.
    expect(defaultDataDir()).toContain(path.join(settingsDir, 'data'));
  });
});

describe('folder usability', () => {
  it('accepts a folder that can be created', () => {
    const target = path.join(tmpRoot, 'nested', 'dir');
    expect(isUsableDataDir(target).ok).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('accepts a folder that already exists', () => {
    const existing = path.join(tmpRoot, 'existing');
    fs.mkdirSync(existing, { recursive: true });
    expect(isUsableDataDir(existing).ok).toBe(true);
  });

  it('rejects a path that cannot be created', () => {
    // A file where a directory is expected is the portable case: mkdir fails with EEXIST
    // rather than the obscure database error a late failure would produce.
    const filePath = path.join(tmpRoot, 'a-file');
    fs.writeFileSync(filePath, 'x', 'utf8');
    const res = isUsableDataDir(filePath);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('creates NOTHING when asked to check without creating', () => {
    // The prompt checks on every blur while the operator is still typing. Creating the path
    // as a side effect meant a mistyped `.../settings.json` became a directory, which then
    // blocked writing the real settings file — the choice was lost and looked ignored.
    const target = path.join(tmpRoot, 'not-created');
    expect(isUsableDataDir(target, { create: false }).ok).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('still accepts an existing writable folder when checking without creating', () => {
    const existing = path.join(tmpRoot, 'existing-2');
    fs.mkdirSync(existing, { recursive: true });
    expect(isUsableDataDir(existing, { create: false }).ok).toBe(true);
  });

  it('rejects a file path when checking without creating', () => {
    const filePath = path.join(tmpRoot, 'a-file-2');
    fs.writeFileSync(filePath, 'x', 'utf8');
    const res = isUsableDataDir(filePath, { create: false });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('refuses a folder that would collide with the settings file', () => {
    // Choosing `.../settings.json` used to create a DIRECTORY with that name, which then
    // made settings permanently unwritable — including the record of the choice itself.
    expect(dataDirCollidesWithSettings(path.join(settingsDir, 'settings.json'))).toBe(true);
  });

  it('refuses a parent that would swallow the settings directory', () => {
    expect(dataDirCollidesWithSettings(path.dirname(settingsDir))).toBe(true);
  });

  it('accepts an unrelated folder', () => {
    expect(dataDirCollidesWithSettings(path.join(tmpRoot, 'fine'))).toBe(false);
  });
});

describe('reporting whether the choice was really saved', () => {
  it('reports success and the value survives', () => {
    const picked = path.join(tmpRoot, 'saved-ok');
    expect(setFirstRunDataChoice({ dir: picked }).ok).toBe(true);
    expect(readSettings().dataDir).toBe(picked);
  });

  it('reports failure instead of claiming success when settings cannot be written', () => {
    // A directory where settings.json should be makes the write fail. `writeSettings`
    // swallows that by design (settings are best-effort), but a first-run choice is not:
    // reporting success would send the operator into a restart that silently resolves to
    // the default folder — indistinguishable from the choice being ignored.
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.mkdirSync(path.join(settingsDir, 'settings.json'), { recursive: true });
    const res = setFirstRunDataChoice({ dir: path.join(tmpRoot, 'never-saved') });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('rejects an empty choice rather than pretending to record one', () => {
    expect(setFirstRunDataChoice({}).ok).toBe(false);
  });
});
