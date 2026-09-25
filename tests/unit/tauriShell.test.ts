import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Tauri Desktop Shell', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const tauriConfPath = path.join(rootDir, 'src-tauri/tauri.conf.json');
  const cargoTomlPath = path.join(rootDir, 'src-tauri/Cargo.toml');
  const readmePath = path.join(rootDir, 'README.md');
  const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');

  it('tauri.conf.json exists and parses as valid JSON', () => {
    expect(fs.existsSync(tauriConfPath)).toBe(true);
    const content = fs.readFileSync(tauriConfPath, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('identifier preserves the application id (com.antidetect.browser)', () => {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    expect(tauriConf.identifier).toBe('com.antidetect.browser');
  });

  it('points the webview at the served UI rather than a bundled renderer copy', () => {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    // The window or frontend url must reference http endpoint or localhost, not a bundled dist folder
    const frontendDist = tauriConf.build?.frontendDist;
    const windowUrl = tauriConf.app?.windows?.[0]?.url || tauriConf.windows?.[0]?.url;
    
    // Check that window URL or frontend target points to the served backend API/UI
    const targetUrl = windowUrl || frontendDist;
    expect(targetUrl).toBeDefined();
    expect(targetUrl).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):50325(\/ui|\/)?$/);
    
    // Ensure it does NOT point to a static bundled renderer folder like '../dist' or '../build'
    if (frontendDist && typeof frontendDist === 'string') {
      expect(frontendDist).not.toMatch(/^\.\.\/(dist|build|src)/);
    }
  });

  it('packaging configuration covers Windows, Linux, and macOS arm64 with consistent naming', () => {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    const bundle = tauriConf.bundle;
    expect(bundle).toBeDefined();
    
    // Targets / bundles configured
    expect(bundle.active).toBe(true);
    // Platform bundle sections
    expect(bundle.windows).toBeDefined();
    expect(bundle.linux).toBeDefined();
    const macos = bundle.macos || bundle.macOS;
    expect(macos).toBeDefined();

    // macOS must carry an AD-HOC identity ("-"), not a Developer ID. Unsigned arm64
    // code does not load on Apple Silicon, so `null` here would ship a build that
    // cannot start; a real certificate is unavailable without an Apple account.
    expect(macos.signingIdentity).toBe('-');
  });

  it('src-tauri/Cargo.toml defines nulltrace-tauri-shell crate', () => {
    expect(fs.existsSync(cargoTomlPath)).toBe(true);
    const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
    expect(cargoToml).toContain('name = "nulltrace-tauri-shell"');
    expect(cargoToml).toContain('tauri');
  });

  it('README states that shell is installed and web interface is what needs no installation', () => {
    const readme = fs.readFileSync(readmePath, 'utf8');
    // Must have a dedicated section for Tauri
    expect(readme).toMatch(/## .*Tauri/i);
    // Must be honest: shell is an installed application, web interface is the install-free option
    expect(readme).toMatch(/устанавливаем/i);
    expect(readme).toMatch(/веб-интерфейс/i);
    // Must clearly state macOS unsigned/quarantine status
    expect(readme).toMatch(/quarantine|карантин/i);
    expect(readme).toMatch(/не подписан|unsigned/i);
  });

  it('CI workflow contains additive non-blocking Tauri job', () => {
    const ciWorkflow = fs.readFileSync(ciWorkflowPath, 'utf8');
    expect(ciWorkflow).toContain('tauri');
    // Ensure release job does not gate on tauri job
    const releaseMatch = ciWorkflow.match(/release:\s+needs:\s*\[([^\]]+)\]/);
    if (releaseMatch) {
      expect(releaseMatch[1]).not.toContain('tauri');
    }
  });
});

describe('macOS ad-hoc signing is configured for the shell too', () => {
  it('sets an ad-hoc signing identity, which arm64 requires to load', () => {
    // Same reason as the Electron build: unsigned ARM code does not execute on Apple
    // Silicon. "-" is codesign's ad-hoc identity and needs no certificate.
    const raw = fs.readFileSync(path.join(__dirname, '../..', 'src-tauri/tauri.conf.json'), 'utf8');
    const conf = JSON.parse(raw);
    const macos = conf.bundle?.macos || conf.bundle?.macOS;
    expect(macos?.signingIdentity).toBe('-');
  });
});

describe('the shipped version is consistent across every file that carries one', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const read = (rel: string): string => fs.readFileSync(path.join(rootDir, rel), 'utf8');
  const packageJsonPath = path.join(rootDir, 'package.json');

  /** The `version` field of a parsed package manifest, or a failure naming the file. */
  const versionField = (rel: string): string => {
    const parsed: unknown = JSON.parse(read(rel));
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
      throw new Error(`${rel} has no version field`);
    }
    const value = parsed.version;
    if (typeof value !== 'string') throw new Error(`${rel} version is not a string`);
    return value;
  };

  /** The version in a JSON manifest read from an absolute path. */
  const versionAt = (abs: string): string => {
    const parsed: unknown = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
      throw new Error(`${abs} has no version field`);
    }
    const value = parsed.version;
    if (typeof value !== 'string') throw new Error(`${abs} version is not a string`);
    return value;
  };

  const cargoVersion = (): string => {
    const m = read('src-tauri/Cargo.toml').match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (!m) throw new Error('src-tauri/Cargo.toml has no package version');
    return m[1];
  };

  it('package.json, tauri.conf.json and Cargo.toml agree', () => {
    // Nothing enforced this before, and the drift is not cosmetic. `updater.rs` compiles
    // `env!("CARGO_PKG_VERSION")` into the anti-rollback check as the INSTALLED version, so a
    // Cargo.toml left behind at 0.6.42 makes a 0.6.44 build accept an update "to" 0.6.43 —
    // the downgrade guard silently stops working while the version shown to the user comes
    // from tauri.conf.json and looks perfectly correct. Every release before this one happened
    // to have all three in sync.
    const shipped = versionField('src-tauri/tauri.conf.json');
    expect(
      cargoVersion(),
      'Cargo.toml must match tauri.conf.json: updater.rs uses CARGO_PKG_VERSION as the ' +
        'installed version for the anti-rollback check, so a stale value disables it',
    ).toBe(shipped);
    expect(versionAt(packageJsonPath)).toBe(shipped);
  });

  it('the compiled crate entry in Cargo.lock carries the same version', () => {
    // Cargo rewrites this on build, but the committed lock is what CI resolves against.
    const m = read('src-tauri/Cargo.lock').match(
      /name = "nulltrace-tauri-shell"\r?\nversion = "([^"]+)"/,
    );
    if (!m) throw new Error('Cargo.lock has no entry for the shell crate');
    expect(m[1]).toBe(versionField('src-tauri/tauri.conf.json'));
  });
});
