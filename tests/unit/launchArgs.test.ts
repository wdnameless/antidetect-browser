import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  appendProfileArgs,
  validateLaunchArgs,
  DENIED_LAUNCH_ARGS,
  createProfile,
  updateProfile,
  getProfileDetails,
  resolveLaunchConfig,
} from '../../src/main/profiles/profileManager';
import { buildChromiumArgs } from '../../src/main/launcher/chromium';
import { initDb, closeDb } from '../../src/main/db';
import type { LaunchConfig } from '../../src/main/profiles/profileManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';


describe('launchArgs - pure appendProfileArgs', () => {
  it('appends user args LAST in override order', () => {
    const base = ['--enable-features=A', '--window-size=800,600'];
    const extra = ['--window-size=1280,720', '--enable-features=B'];
    const result = appendProfileArgs(base, extra);
    expect(result).toEqual([
      '--enable-features=A',
      '--window-size=800,600',
      '--window-size=1280,720',
      '--enable-features=B',
    ]);
    expect(result.slice(-2)).toEqual(extra);
  });

  it('handles empty or undefined extra args with passthrough', () => {
    const base = ['--flag-a', '--flag-b'];
    expect(appendProfileArgs(base, undefined)).toEqual(base);
    expect(appendProfileArgs(base, null)).toEqual(base);
    expect(appendProfileArgs(base, [])).toEqual(base);
  });

  it('passes --flag=value and bare flags verbatim in argv', () => {
    const base = ['--base-flag'];
    const extra = [
      '--disable-gpu-rasterization',
      '--force-device-scale-factor=1.5',
      '--js-flags="--max-old-space-size=4096"',
    ];
    const result = appendProfileArgs(base, extra);
    expect(result).toEqual([
      '--base-flag',
      '--disable-gpu-rasterization',
      '--force-device-scale-factor=1.5',
      '--js-flags="--max-old-space-size=4096"',
    ]);
  });
});

describe('launchArgs - denylist rejection at save', () => {
  const deniedCases = [
    { arg: '--fingerprint', expectedToken: '--fingerprint' },
    { arg: '--fingerprint=seed123', expectedToken: '--fingerprint' },
    { arg: '--fingerprint-spoof', expectedToken: '--fingerprint' },
    { arg: '--remote-debugging-port=9222', expectedToken: '--remote-debugging' },
    { arg: '--remote-debugging-pipe', expectedToken: '--remote-debugging' },
    { arg: '--user-data-dir=/tmp/foo', expectedToken: '--user-data-dir' },
    { arg: '--user-data-dir', expectedToken: '--user-data-dir' },
    { arg: '--proxy-server=http://127.0.0.1:8080', expectedToken: '--proxy-server' },
    { arg: '--proxy-server', expectedToken: '--proxy-server' },
    { arg: '--load-extension=/path/to/ext', expectedToken: '--load-extension' },
    { arg: '--load-extension', expectedToken: '--load-extension' },
    { arg: '--disable-extensions', expectedToken: '--disable-extensions' },
    { arg: '--disable-extensions=true', expectedToken: '--disable-extensions' },
  ];

  for (const { arg, expectedToken } of deniedCases) {
    it(`rejects ${arg} and error names the denied token ${expectedToken}`, () => {
      expect(() => validateLaunchArgs([arg])).toThrowError(
        new RegExp(expectedToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      );
    });
  }

  it('accepts benign chromium arguments', () => {
    expect(() =>
      validateLaunchArgs([
        '--enable-features=NetworkService',
        '--disable-blink-features=AutomationControlled',
        '--force-dark-mode',
      ])
    ).not.toThrow();
  });
});

describe('launchArgs - profileManager save & DB persistence', () => {
  beforeEach(async () => {
    await initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  it('persists launch_args on createProfile and reads via getProfileDetails and resolveLaunchConfig', () => {
    const validArgs = ['--disable-background-timer-throttling', '--renderer-process-limit=4'];
    const id = createProfile({
      name: 'LaunchArgs Test Profile',
      launch_args: validArgs,
    });

    const details = getProfileDetails(id);
    expect(details?.launch_args).toEqual(validArgs);

    const cfg = resolveLaunchConfig(id);
    expect(cfg.launch_args).toEqual(validArgs);
  });

  it('rejects denied launch_args on createProfile with error naming denied token', () => {
    expect(() =>
      createProfile({
        name: 'Bad Profile',
        launch_args: ['--user-data-dir=/custom/dir'],
      })
    ).toThrowError(/--user-data-dir/);
  });

  it('updates launch_args via updateProfile and rejects denied args', () => {
    const id = createProfile({
      name: 'Updatable Profile',
    });

    const validArgs = ['--disable-notifications'];
    const ok = updateProfile(id, { launch_args: validArgs });
    expect(ok).toBe(true);

    const details = getProfileDetails(id);
    expect(details?.launch_args).toEqual(validArgs);

    expect(() =>
      updateProfile(id, {
        launch_args: ['--remote-debugging-port=9222'],
      })
    ).toThrowError(/--remote-debugging/);
  });
});

describe('launchArgs - buildChromiumArgs composition', () => {
  it('appends profile launch_args last in buildChromiumArgs', async () => {
    const cfg: LaunchConfig = {
      profileId: 'test-profile',
      userDataDir: '/tmp/profile-data',
      launch_args: ['--custom-override-flag=1', '--no-first-run'],
    };

    const args = await buildChromiumArgs(cfg);
    const len = args.length;
    expect(args[len - 2]).toBe('--custom-override-flag=1');
    expect(args[len - 1]).toBe('--no-first-run');
  });
});

// The privacy knobs are only worth having if they reach the command line. Each switch name
// below was verified against the pinned kernel binary (`chrome.dll`): Chromium accepts an
// unknown switch and ignores it silently, so a wrong spelling looks implemented forever.
describe('per-profile privacy knobs reach the browser', () => {
  it('blocks ports through host-resolver-rules', async () => {
    const args = await buildChromiumArgs({
      profileId: 'p',
      userDataDir: '/tmp/p',
      blocked_ports: [3389, 5900],
    });
    const rule = args.find((a) => a.startsWith('--host-resolver-rules='));
    expect(rule).toBeDefined();
    expect(rule).toContain('MAP *:3389 ~NOTFOUND');
    expect(rule).toContain('MAP *:5900 ~NOTFOUND');
  });

  it('emits nothing for ports when none are set', async () => {
    const args = await buildChromiumArgs({ profileId: 'p', userDataDir: '/tmp/p' });
    expect(args.some((a) => a.startsWith('--host-resolver-rules='))).toBe(false);
  });

  it('applies the WebRTC policy under the name the kernel knows', async () => {
    const args = await buildChromiumArgs({
      profileId: 'p',
      userDataDir: '/tmp/p',
      webrtc_policy: 'disable_non_proxied_udp',
    });
    expect(args).toContain('--webrtc-ip-handling-policy=disable_non_proxied_udp');
    // The `force-` prefix does not exist in the binary; using it would be a silent no-op.
    expect(args.some((a) => a.startsWith('--force-webrtc'))).toBe(false);
  });

  it('leaves WebRTC alone on the default policy', async () => {
    const args = await buildChromiumArgs({
      profileId: 'p',
      userDataDir: '/tmp/p',
      webrtc_policy: 'default',
    });
    expect(args.some((a) => a.includes('webrtc-ip-handling-policy'))).toBe(false);
  });

  it('never passes a Do Not Track switch, because the kernel has none', async () => {
    // DNT is a preference, applied in `startProfile` via `applyDoNotTrackPref`. Adding a
    // switch here would be dead weight the browser ignores.
    const args = await buildChromiumArgs({
      profileId: 'p',
      userDataDir: '/tmp/p',
      do_not_track: 'on',
    });
    expect(args.some((a) => a.includes('do-not-track'))).toBe(false);
  });

  it('keeps user launch_args able to override a privacy knob', async () => {
    // Documented last-wins rule: the operator's own switches are appended after ours.
    const args = await buildChromiumArgs({
      profileId: 'p',
      userDataDir: '/tmp/p',
      webrtc_policy: 'proxy',
      launch_args: ['--webrtc-ip-handling-policy=default'],
    });
    expect(args.indexOf('--webrtc-ip-handling-policy=default')).toBeGreaterThan(
      args.indexOf('--webrtc-ip-handling-policy=proxy')
    );
  });
});

describe('stealth-engine-profile switch (add-engine-level-hardening 4.1)', () => {
  it('emits --stealth-engine-profile and dumps the profile JSON when set', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-prof-'));
    const cfg: LaunchConfig = {
      profileId: 'engine-profile-test',
      userDataDir: tmpDir,
      fingerprintSeed: 12345,
      stealthEngineProfileId: 'engine-148-01',
      fingerprint: { seed: 12345, platform: 'windows' },
    };

    const args = await buildChromiumArgs(cfg);
    const switchArg = args.find((a) => a.startsWith('--stealth-engine-profile='));
    expect(switchArg).toBe('--stealth-engine-profile=engine-148-01');

    const dumpPath = path.join(tmpDir, 'stealth-engine-profile.json');
    expect(fs.existsSync(dumpPath)).toBe(true);
    const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    expect(dump.id).toBe('engine-148-01');
    expect(dump.fingerprint.seed).toBe(12345);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits nothing without the engine profile set (zero behavior change)', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-prof-off-'));
    const args = await buildChromiumArgs({
      profileId: 'no-engine',
      userDataDir: tmpDir2,
      fingerprintSeed: 1,
    });
    expect(args.some((a) => a.startsWith('--stealth-engine-profile'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir2, 'stealth-engine-profile.json'))).toBe(false);
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });
});
