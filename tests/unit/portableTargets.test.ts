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
    it('ships portable AND an NSIS installer', () => {
      const winTarget = pkg.build.win?.target;
      expect(winTarget).toBeDefined();
      const targetNames = Array.isArray(winTarget)
        ? winTarget.map((t: { target: string }) => (typeof t === 'string' ? t : t.target))
        : [winTarget];

      // Both are required, and the reason is not cosmetic:
      //  - `portable` is the installer-free single file the operator already uses.
      //  - `nsis` is the ONLY Windows target electron-builder can auto-update from
      //    (macOS uses dmg+zip, Linux AppImage/deb). Without it, in-app update cannot work
      //    at all, and the app would report "latest" while a newer release existed.
      // Shipping only `portable` was a regression: an earlier commit had configured NSIS
      // for auto-update, and the rebrand commit replaced it.
      expect(targetNames).toContain('portable');
      expect(targetNames).toContain('nsis');
      // The installer must be configured, not left to defaults — an updater silently
      // depends on it being a real, installed build rather than a self-extracting one.
      expect(pkg.build.nsis).toBeDefined();
      expect(pkg.build.nsis.oneClick).toBe(false);
    });

    it('gives the installer and the portable file distinct, self-describing names', () => {
      // The two artifacts land in the same release directory. If both derived their name
      // from one `win.artifactName`, one would overwrite the other and the release would
      // silently lose an artifact.
      const nsisName = pkg.build.nsis?.artifactName;
      const portableName = pkg.build.portable?.artifactName;
      expect(nsisName).toBeDefined();
      expect(portableName).toBeDefined();
      expect(nsisName).not.toBe(portableName);
      for (const name of [nsisName, portableName]) {
        expect(name).toContain('NullTrace');
        expect(name).toContain('${version}');
      }
      expect(portableName).toContain('portable');
      expect(portableName).toContain('win');
      expect(portableName).toContain('x64');
      expect(nsisName).toContain('Setup');
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

describe('in-app auto-update is actually possible', () => {
  const root = path.resolve(__dirname, '../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  it('the release publishes the metadata electron-updater reads', () => {
    // electron-updater fetches `latest.yml` to learn a new version exists. A release with
    // only the .exe makes the in-app check report "latest" while a newer build is published,
    // which is worse than no update feature: it lies.
    //
    // This asserts on the `softprops/action-gh-release` step's own `files:` list, not on the
    // file as a whole. A whole-file substring check passes on a mention in a comment — which
    // it did, when I tested it by deleting the real entry.
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const step = workflow.indexOf('softprops/action-gh-release');
    expect(step, 'the release publishing step must exist').toBeGreaterThan(-1);
    const stepBody = workflow.slice(step, step + 400);
    expect(stepBody).toMatch(/latest\*?\.yml/);
    expect(stepBody).toContain('.blockmap');
  });

  it('publishing config points at a real GitHub repo', () => {
    // Without this, the packaged app has no feed to query and update silently never works.
    const publish = Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : pkg.build.publish;
    expect(publish).toBeDefined();
    expect(publish.provider).toBe('github');
    expect(publish.owner).toBeTruthy();
    expect(publish.repo).toBeTruthy();
  });

  it('keeps autoDownload off so an update is never fetched behind the operator', () => {
    // The UI offers a deliberate Check -> Download -> Restart flow. Silently downloading a
    // 260MB installer on a metered connection is not a decision the app should make.
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    expect(main).toMatch(/autoUpdater\.autoDownload\s*=\s*false/);
  });
});
