import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('portable state resolution and data root contract', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-state-test-'));
  });

  afterEach(() => {
    // Restore environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    // Clean up temporary files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.resetModules();
  });

  it('a) portable launch resolves settings and data inside the portable folder', async () => {
    const portableExeDir = path.join(tmpDir, 'portable-app');
    fs.mkdirSync(portableExeDir, { recursive: true });

    delete process.env.ANTIDETECT_DATA_DIR;
    delete process.env.ANTIDETECT_SETTINGS_DIR;
    // Point the pre-move settings location at an empty directory. `readSettings` falls back to
    // it (so a migrated installation keeps the data folder it recorded there), which would
    // otherwise make this assertion depend on the machine running the test.
    process.env.APPDATA = path.join(tmpDir, 'empty-appdata');
    process.env.PORTABLE_EXECUTABLE_DIR = portableExeDir;

    const config = await import('../../src/main/config');

    // Settings base should be portableExeDir
    expect(config.isPortableMode()).toBe(true);
    expect(config.portableBaseDir()).toBe(portableExeDir);
    expect(config.defaultDataDir()).toBe(path.join(portableExeDir, 'data'));

    // Without saved settings, dataDir should resolve to <portableExeDir>/data
    expect(config.resolveDataDir()).toBe(path.join(portableExeDir, 'data'));

    // Writing settings should write to <portableExeDir>/settings.json
    config.setFirstRunDataChoice({ mode: 'portable' });
    const settingsFilePath = path.join(portableExeDir, 'settings.json');
    expect(fs.existsSync(settingsFilePath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    expect(written.dataMode).toBe('portable');
  });

  it('b) a recorded path that does not exist falls through to the portable folder (moved-stick case)', async () => {
    const portableExeDir = path.join(tmpDir, 'portable-app');
    fs.mkdirSync(portableExeDir, { recursive: true });

    const nonExistentPath = path.join(tmpDir, 'old-machine', 'does-not-exist');
    fs.writeFileSync(
      path.join(portableExeDir, 'settings.json'),
      JSON.stringify({ dataDir: nonExistentPath }),
      'utf8'
    );

    delete process.env.ANTIDETECT_DATA_DIR;
    delete process.env.ANTIDETECT_SETTINGS_DIR;
    // Point the pre-move settings location at an empty directory. `readSettings` falls back to
    // it (so a migrated installation keeps the data folder it recorded there), which would
    // otherwise make this assertion depend on the machine running the test.
    process.env.APPDATA = path.join(tmpDir, 'empty-appdata');
    process.env.PORTABLE_EXECUTABLE_DIR = portableExeDir;

    const config = await import('../../src/main/config');

    expect(config.resolveDataDir()).toBe(path.join(portableExeDir, 'data'));
  });

  it('c) a recorded path that exists but has no data also falls through', async () => {
    const portableExeDir = path.join(tmpDir, 'portable-app');
    fs.mkdirSync(portableExeDir, { recursive: true });

    const emptyDir = path.join(tmpDir, 'empty-data-dir');
    fs.mkdirSync(emptyDir, { recursive: true });
    // An empty profiles dir also does not count as holding data
    fs.mkdirSync(path.join(emptyDir, 'profiles'), { recursive: true });

    fs.writeFileSync(
      path.join(portableExeDir, 'settings.json'),
      JSON.stringify({ dataDir: emptyDir }),
      'utf8'
    );

    delete process.env.ANTIDETECT_DATA_DIR;
    delete process.env.ANTIDETECT_SETTINGS_DIR;
    // Point the pre-move settings location at an empty directory. `readSettings` falls back to
    // it (so a migrated installation keeps the data folder it recorded there), which would
    // otherwise make this assertion depend on the machine running the test.
    process.env.APPDATA = path.join(tmpDir, 'empty-appdata');
    process.env.PORTABLE_EXECUTABLE_DIR = portableExeDir;

    const config = await import('../../src/main/config');

    expect(config.dataDirHoldsData(emptyDir)).toBe(false);
    expect(config.resolveDataDir()).toBe(path.join(portableExeDir, 'data'));
  });

  it('d) a recorded path that exists WITH data is still honoured (with antidetect.db or non-empty profiles)', async () => {
    const portableExeDir = path.join(tmpDir, 'portable-app');
    fs.mkdirSync(portableExeDir, { recursive: true });

    // Case 1: with antidetect.db
    const dataDirWithDb = path.join(tmpDir, 'existing-data-with-db');
    fs.mkdirSync(dataDirWithDb, { recursive: true });
    fs.writeFileSync(path.join(dataDirWithDb, 'antidetect.db'), 'mock-db-content', 'utf8');

    fs.writeFileSync(
      path.join(portableExeDir, 'settings.json'),
      JSON.stringify({ dataDir: dataDirWithDb }),
      'utf8'
    );

    delete process.env.ANTIDETECT_DATA_DIR;
    delete process.env.ANTIDETECT_SETTINGS_DIR;
    // Point the pre-move settings location at an empty directory. `readSettings` falls back to
    // it (so a migrated installation keeps the data folder it recorded there), which would
    // otherwise make this assertion depend on the machine running the test.
    process.env.APPDATA = path.join(tmpDir, 'empty-appdata');
    process.env.PORTABLE_EXECUTABLE_DIR = portableExeDir;

    let config = await import('../../src/main/config');
    expect(config.dataDirHoldsData(dataDirWithDb)).toBe(true);
    expect(config.resolveDataDir()).toBe(dataDirWithDb);

    // Case 2: with non-empty profiles directory
    vi.resetModules();
    const dataDirWithProfiles = path.join(tmpDir, 'existing-data-with-profiles');
    const profilesSubDir = path.join(dataDirWithProfiles, 'profiles', 'profile-1');
    fs.mkdirSync(profilesSubDir, { recursive: true });

    fs.writeFileSync(
      path.join(portableExeDir, 'settings.json'),
      JSON.stringify({ dataDir: dataDirWithProfiles }),
      'utf8'
    );

    config = await import('../../src/main/config');
    expect(config.dataDirHoldsData(dataDirWithProfiles)).toBe(true);
    expect(config.resolveDataDir()).toBe(dataDirWithProfiles);
  });

  it('e) ANTIDETECT_DATA_DIR still beats everything', async () => {
    const portableExeDir = path.join(tmpDir, 'portable-app');
    fs.mkdirSync(portableExeDir, { recursive: true });

    const overrideDir = path.join(tmpDir, 'explicit-override-dir');
    const dataDirWithDb = path.join(tmpDir, 'existing-data-with-db');
    fs.mkdirSync(dataDirWithDb, { recursive: true });
    fs.writeFileSync(path.join(dataDirWithDb, 'antidetect.db'), 'mock-db', 'utf8');

    fs.writeFileSync(
      path.join(portableExeDir, 'settings.json'),
      JSON.stringify({ dataDir: dataDirWithDb }),
      'utf8'
    );

    process.env.PORTABLE_EXECUTABLE_DIR = portableExeDir;
    process.env.ANTIDETECT_DATA_DIR = overrideDir;

    const config = await import('../../src/main/config');
    expect(config.resolveDataDir()).toBe(overrideDir);
  });

  it('resolves McpAuditLogger audit log path under data directory', async () => {
    const customDataDir = path.join(tmpDir, 'custom-data');
    fs.mkdirSync(customDataDir, { recursive: true });

    process.env.ANTIDETECT_DATA_DIR = customDataDir;
    delete process.env.ANTIDETECT_MCP_AUDIT_PATH;

    const { McpAuditLogger } = await import('../../mcp/src/audit');
    const logger = new McpAuditLogger();

    expect(logger.getFilePath()).toBe(path.join(customDataDir, 'mcp-audit.jsonl'));
  });
});
