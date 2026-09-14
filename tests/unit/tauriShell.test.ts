import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Tauri Desktop Shell', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const tauriConfPath = path.join(rootDir, 'src-tauri/tauri.conf.json');
  const cargoTomlPath = path.join(rootDir, 'src-tauri/Cargo.toml');
  const readmePath = path.join(rootDir, 'README.md');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');

  it('tauri.conf.json exists and parses as valid JSON', () => {
    expect(fs.existsSync(tauriConfPath)).toBe(true);
    const content = fs.readFileSync(tauriConfPath, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('identifier matches package.json appId (com.antidetect.browser)', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    expect(pkg.build?.appId).toBe('com.antidetect.browser');
    expect(tauriConf.identifier).toBe(pkg.build.appId);
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
    expect(bundle.macos).toBeDefined();
    
    // macOS must remain unsigned
    expect(bundle.macos.signingIdentity).toBeNull();
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
    expect(conf.bundle?.macOS?.signingIdentity).toBe('-');
  });
});
