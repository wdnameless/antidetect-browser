import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Portable Packaging Targets (tasks 2.1-2.4)', () => {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);

  it('package.json is valid JSON and parses cleanly', () => {
    expect(pkg).toBeDefined();
    expect(pkg.build).toBeDefined();
  });

  it('keeps appId unchanged for backward compatibility and OS migration', () => {
    expect(pkg.build.appId).toBe('com.antidetect.browser');
    // Ensure comment or justification exists explaining why appId is unchanged
    const hasComment =
      Boolean(pkg['// appId']) ||
      Boolean(pkg.build['// appId']) ||
      pkgRaw.includes('com.antidetect.browser is locked') ||
      pkgRaw.includes('Unchanged (com.antidetect.browser)');
    expect(hasComment).toBe(true);
  });

  describe('Windows Target', () => {
    it('target is portable and NOT nsis (no installer produced)', () => {
      const winTarget = pkg.build.win?.target;
      expect(winTarget).toBeDefined();
      const targetNames = Array.isArray(winTarget)
        ? winTarget.map((t: { target: string }) => (typeof t === 'string' ? t : t.target))
        : [winTarget];

      expect(targetNames).toContain('portable');
      expect(targetNames).not.toContain('nsis');
      expect(pkg.build.nsis).toBeUndefined();
    });

    it('has self-describing artifactName containing NullTrace and version', () => {
      const artifact = pkg.build.win?.artifactName || pkg.build.artifactName;
      expect(artifact).toContain('NullTrace');
      expect(artifact).toContain('${version}');
      expect(artifact).toContain('portable');
      expect(artifact).toContain('win');
      expect(artifact).toContain('x64');
    });
  });

  describe('Linux Target', () => {
    it('target is AppImage with proper icon and category', () => {
      const linuxConfig = pkg.build.linux;
      expect(linuxConfig).toBeDefined();
      expect(linuxConfig.category).toBeDefined();
      expect(typeof linuxConfig.category).toBe('string');
      expect(linuxConfig.category.length).toBeGreaterThan(0);
      expect(linuxConfig.icon).toBeDefined();

      const linuxTarget = linuxConfig.target;
      const targetNames = Array.isArray(linuxTarget)
        ? linuxTarget.map((t: { target: string }) => (typeof t === 'string' ? t : t.target))
        : [linuxTarget];
      expect(targetNames).toContain('AppImage');
    });

    it('has self-describing artifactName containing NullTrace and version', () => {
      const artifact = pkg.build.linux?.artifactName || pkg.build.artifactName;
      expect(artifact).toContain('NullTrace');
      expect(artifact).toContain('${version}');
      expect(artifact).toContain('portable');
      expect(artifact).toContain('linux');
    });
  });

  describe('macOS Target', () => {
    it('target is dmg for arm64 architecture with icon and identity null', () => {
      const macConfig = pkg.build.mac;
      expect(macConfig).toBeDefined();
      expect(macConfig.icon).toBeDefined();
      expect(macConfig.identity).toBeNull();

      const macTarget = macConfig.target;
      expect(macTarget).toBeDefined();
      const targetList = Array.isArray(macTarget) ? macTarget : [macTarget];
      const hasDmgArm64 = targetList.some(
        (t: { target: string; arch?: string[] }) =>
          typeof t === 'object' && t.target === 'dmg' && Array.isArray(t.arch) && t.arch.includes('arm64')
      );
      expect(hasDmgArm64).toBe(true);
    });

    it('has self-describing artifactName containing NullTrace and version', () => {
      const artifact = pkg.build.mac?.artifactName || pkg.build.artifactName;
      expect(artifact).toContain('NullTrace');
      expect(artifact).toContain('${version}');
      expect(artifact).toContain('portable');
      expect(artifact).toContain('mac');
      expect(artifact).toContain('arm64');
    });
  });

  describe('General and dist npm scripts', () => {
    it('every platform artifactName contains NullTrace and ${version}', () => {
      const platforms = ['win', 'linux', 'mac'] as const;
      for (const platform of platforms) {
        const artifact = pkg.build[platform]?.artifactName || pkg.build.artifactName;
        expect(artifact).toContain('NullTrace');
        expect(artifact).toContain('${version}');
      }
    });

    it('defines dist:win, dist:linux, and dist:mac scripts targeting corresponding platforms', () => {
      expect(pkg.scripts['dist:win']).toBeDefined();
      expect(pkg.scripts['dist:win']).toContain('--win');

      expect(pkg.scripts['dist:linux']).toBeDefined();
      expect(pkg.scripts['dist:linux']).toContain('--linux');

      expect(pkg.scripts['dist:mac']).toBeDefined();
      expect(pkg.scripts['dist:mac']).toContain('--mac');
    });

    it('extraResources block is preserved untouched for kernel agent', () => {
      expect(pkg.build.extraResources).toBeDefined();
      expect(Array.isArray(pkg.build.extraResources)).toBe(true);
    });
  });
});

describe('electron-builder config is schema-valid', () => {
  it('contains no comment/placeholder keys that would fail schema validation', () => {
    // electron-builder rejects unknown top-level properties outright, so a
    // "// appId" annotation placed inside `build` breaks every build. Notes must
    // live as siblings of `build`, never inside it.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const offenders = Object.keys(pkg.build).filter((k) => k.startsWith('//') || k.startsWith('_'));
    expect(offenders, 'comments are not valid inside `build` — move them beside it').toEqual([]);
  });
});

describe('packaged build carries its browser kernel', () => {
  const root = path.resolve(__dirname, '../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  it('ships fingerprint-chromium where config.ts looks for it', () => {
    // config.ts scans <resourcesPath>/kernel/fingerprint-chromium for chrome.exe.
    // The rebrand commit dropped this entry while the lookup kept pointing at it, so
    // the packaged app silently fell back to system Chrome — which is not a
    // fingerprint-spoofing browser at all, just Chrome under a different name.
    const entry = pkg.build.extraResources.find(
      (e: { to?: string }) => e.to === 'kernel/fingerprint-chromium',
    );
    expect(entry).toBeDefined();
    expect(entry.from).toBe('data/chromium/fingerprint-chromium');
  });

  it('looks for the kernel at exactly that packaged path', () => {
    // Guards the pair: if the lookup path in config.ts changes, this fails and forces
    // the extraResources entry to move with it.
    const config = fs.readFileSync(path.join(root, 'src/main/config.ts'), 'utf8');
    expect(config).toContain("'kernel'");
    expect(config).toContain('fingerprint-chromium');
  });
});

describe('every platform build prepares the kernel first', () => {
  const root = path.resolve(__dirname, '../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  for (const target of ['win', 'linux', 'mac']) {
    it(`dist:${target} triggers its predist hook`, () => {
      // npm fires `pre<name>` only for the exact script name. `dist` had a predist
      // hook, but dist:win/linux/mac are different names — so nothing fetched the
      // kernel before packaging, and data/ is gitignored. A fresh clone therefore
      // built an app with no browser kernel and silently used system Chrome.
      expect(pkg.scripts[`predist:${target}`]).toBeDefined();
      expect(pkg.scripts[`predist:${target}`]).toContain('ensure-kernel');
    });
  }
});
