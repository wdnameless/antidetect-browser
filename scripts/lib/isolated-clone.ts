import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CloneManifest {
  schemaVersion: '1';
  cloneId: string;
  sourceRoot: string;
  cloneRoot: string;
  createdAt: string;
  sourceBeforeSha256: string;
  sourceAfterSha256: string;
  cloneInventorySha256: string;
  fixtureDataDir: string;
  fixtureSettingsDir: string;
  fixtureExecutable: string;
  productionUnchanged: boolean;
  fixtureCanaryCloneOnly: boolean;
}

const SNAPSHOT_PATHS = ['dist', 'data/antidetect.db', 'data/profiles', 'data/chromium/camoufox'] as const;

function hashInventory(root: string, entries: readonly string[]): string {
  const hash = createHash('sha256');
  const visit = (relative: string): void => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) {
      hash.update(`missing\0${relative}\0`);
      return;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`symbolic links are forbidden in snapshot inputs: ${absolute}`);
    if (stat.isDirectory()) {
      hash.update(`dir\0${relative}\0`);
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
      return;
    }
    hash.update(`file\0${relative}\0${stat.size}\0`);
    hash.update(fs.readFileSync(absolute));
  };
  for (const entry of entries) visit(entry);
  return hash.digest('hex');
}

function copyRequired(sourceRoot: string, cloneRoot: string): void {
  for (const relative of SNAPSHOT_PATHS) {
    const source = path.join(sourceRoot, relative);
    if (!fs.existsSync(source)) throw new Error(`required pre-denial snapshot input is missing: ${source}`);
    const destination = path.join(cloneRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  }
}

export function assertClonePath(cloneRoot: string, candidate: string): void {
  const root = path.resolve(cloneRoot);
  const target = path.resolve(candidate);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`fixture path escapes isolated clone: ${target}`);
  }
}

export function createIsolatedClone(sourceRootInput: string, cloneRootInput: string): CloneManifest {
  const sourceRoot = path.resolve(sourceRootInput);
  const cloneRoot = path.resolve(cloneRootInput);
  if (cloneRoot === sourceRoot || cloneRoot.startsWith(sourceRoot + path.sep)) {
    throw new Error('clone root must be outside the production/source tree');
  }
  if (fs.existsSync(cloneRoot)) throw new Error(`clone root already exists: ${cloneRoot}`);

  const sourceBeforeSha256 = hashInventory(sourceRoot, SNAPSHOT_PATHS);
  fs.mkdirSync(cloneRoot, { recursive: false });
  try {
    copyRequired(sourceRoot, cloneRoot);
    const fixtureDataDir = path.join(cloneRoot, 'data');
    const fixtureSettingsDir = path.join(cloneRoot, 'settings');
    const fixtureExecutable = path.join(cloneRoot, 'data', 'chromium', 'camoufox', 'extracted', 'camoufox.exe');
    assertClonePath(cloneRoot, fixtureDataDir);
    assertClonePath(cloneRoot, fixtureSettingsDir);
    assertClonePath(cloneRoot, fixtureExecutable);
    if (!fs.existsSync(fixtureExecutable)) throw new Error(`clone executable missing: ${fixtureExecutable}`);

    fs.mkdirSync(fixtureSettingsDir, { recursive: true });
    const canary = path.join(fixtureDataDir, '.fixture-write-canary');
    const productionCanary = path.join(sourceRoot, 'data', '.fixture-write-canary');
    fs.writeFileSync(canary, 'clone-only', { flag: 'wx' });
    const fixtureCanaryCloneOnly = fs.existsSync(canary) && !fs.existsSync(productionCanary);
    fs.rmSync(canary, { force: true });

    const sourceAfterSha256 = hashInventory(sourceRoot, SNAPSHOT_PATHS);
    const productionUnchanged = sourceBeforeSha256 === sourceAfterSha256;
    if (!productionUnchanged || !fixtureCanaryCloneOnly) throw new Error('clone isolation proof failed');

    const manifest: CloneManifest = {
      schemaVersion: '1', cloneId: randomUUID(), sourceRoot, cloneRoot,
      createdAt: new Date().toISOString(), sourceBeforeSha256, sourceAfterSha256,
      cloneInventorySha256: hashInventory(cloneRoot, SNAPSHOT_PATHS),
      fixtureDataDir, fixtureSettingsDir, fixtureExecutable,
      productionUnchanged, fixtureCanaryCloneOnly,
    };
    fs.writeFileSync(path.join(cloneRoot, 'clone-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(cloneRoot, 'fixture-env.json'), JSON.stringify({
      ANTIDETECT_DATA_DIR: fixtureDataDir,
      ANTIDETECT_SETTINGS_DIR: fixtureSettingsDir,
      CAMOUFOX_PATH: fixtureExecutable,
      ANTIDETECT_ISOLATED_CLONE_ROOT: cloneRoot,
    }, null, 2) + '\n', { flag: 'wx' });
    return manifest;
  } catch (error) {
    fs.rmSync(cloneRoot, { recursive: true, force: true });
    throw error;
  }
}
