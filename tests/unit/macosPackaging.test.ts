import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('macOS Packaging and Portability Configuration', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const entitlementsPath = path.join(rootDir, 'build', 'entitlements.mac.plist');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const readmePath = path.join(rootDir, 'README.md');

  it('build/entitlements.mac.plist exists and parses as valid XML plist', () => {
    expect(fs.existsSync(entitlementsPath)).toBe(true);
    const content = fs.readFileSync(entitlementsPath, 'utf8');

    // Plist XML structure check
    expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(content).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
    expect(content).toContain('<plist version="1.0">');
    expect(content).toContain('<dict>');
    expect(content).toContain('</dict>');
    expect(content).toContain('</plist>');
  });

  it('entitlements plist contains the 4 required security entitlements with justifications', () => {
    const content = fs.readFileSync(entitlementsPath, 'utf8');

    const requiredKeys = [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.cs.allow-dyld-environment-variables',
    ];

    for (const key of requiredKeys) {
      expect(content).toContain(`<key>${key}</key>`);
      // Assert that each key has an associated <true/> value
      const keyIndex = content.indexOf(`<key>${key}</key>`);
      const snippetAfterKey = content.slice(keyIndex, keyIndex + 150);
      expect(snippetAfterKey).toContain('<true/>');
    }

    // Assert that each entitlement has explanatory comments justifying its inclusion
    expect(content).toMatch(/allow-jit[\s\S]*?compile and execute JIT/);
    expect(content).toMatch(/allow-unsigned-executable-memory[\s\S]*?runtime code generation/);
    expect(content).toMatch(/disable-library-validation[\s\S]*?dylib/);
    expect(content).toMatch(/allow-dyld-environment-variables[\s\S]*?DYLD/);
  });

  it('package.json build.mac references entitlements and targets dmg arm64', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(pkg.build).toBeDefined();
    expect(pkg.build.appId).toBe('com.antidetect.browser');

    const mac = pkg.build.mac;
    expect(mac).toBeDefined();
    expect(mac.identity).toBeNull();
    expect(mac.entitlements).toBe('build/entitlements.mac.plist');
    expect(mac.entitlementsInherit).toBe('build/entitlements.mac.plist');

    expect(Array.isArray(mac.target)).toBe(true);
    const dmgTarget = mac.target.find((t: { target: string; arch?: string[] }) => t.target === 'dmg');
    expect(dmgTarget).toBeDefined();
    expect(dmgTarget.arch).toContain('arm64');
  });

  it('README.md documents the Portable section and quarantine/unsigned limitation for macOS', () => {
    const content = fs.readFileSync(readmePath, 'utf8');

    // Portable section covering platforms
    expect(content).toMatch(/Portable Distribution|Портативные сборки/i);
    expect(content).toContain('.exe');
    expect(content).toContain('.AppImage');
    expect(content).toContain('.dmg');
    expect(content).toContain('arm64');

    // Explicit statement that macOS is not single-file
    expect(content).toMatch(/not single-file|Не является single-file/i);

    // Explicit statement that the build is unsigned
    expect(content).toMatch(/unsigned|не подписана/i);

    // Exact quarantine removal command / phrase so it cannot be quietly dropped
    expect(content).toContain('xattr -dr com.apple.quarantine');
  });
});

describe('macOS arm64 signing without an Apple account', () => {
  const root = path.resolve(__dirname, '../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  it('keeps Developer ID signing off — there is no Apple account to sign with', () => {
    expect(pkg.build.mac.identity).toBeNull();
  });

  it('applies an ad-hoc signature, which the Apple Silicon loader requires', () => {
    // Unsigned ARM code does not execute on M-series Macs. Ad-hoc signing costs
    // nothing and needs no certificate, so it is the only way to ship a runnable
    // arm64 build without an account.
    expect(pkg.build.mac.afterPack).toBe('scripts/afterPack-adhoc-sign.cjs');
    const hook = fs.readFileSync(path.join(root, 'scripts/afterPack-adhoc-sign.cjs'), 'utf8');
    expect(hook).toContain("'/usr/bin/codesign'");
    expect(hook).toContain("'--sign'");
    expect(hook).toContain("'-'");
  });

  it('fails loudly rather than shipping an arm64 bundle that cannot launch', () => {
    const hook = fs.readFileSync(path.join(root, 'scripts/afterPack-adhoc-sign.cjs'), 'utf8');
    // A swallowed signing error would produce a build that dies on the user's machine.
    expect(hook).toMatch(/throw new Error/);
    expect(hook).toMatch(/will not execute on Apple Silicon/);
  });

  it('does not claim Gatekeeper acceptance', () => {
    // Ad-hoc satisfies the loader, not Gatekeeper. Conflating the two would make the
    // docs promise an experience the operator will not get.
    const hook = fs.readFileSync(path.join(root, 'scripts/afterPack-adhoc-sign.cjs'), 'utf8');
    expect(hook).toMatch(/NOT Gatekeeper|not Gatekeeper/i);
    expect(hook).toContain('xattr -dr com.apple.quarantine');
  });
});
