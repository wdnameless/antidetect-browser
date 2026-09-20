// Reopening a profile must continue where the operator left off.
//
// The mechanism is a launch SWITCH, not a Preference, and that distinction cost a wrong first
// attempt: writing `session.restore_on_startup` into the profile's `Preferences` looked correct
// and changed nothing, because Chromium owns that file and rewrites it while it runs. Measured
// after a launch: the file came back with `session: {}` and `exit_type: "Crashed"` even though
// both had been written moments earlier.
//
// So the restore is requested with `--restore-last-session`. Switches are only useful if the
// kernel knows them — an unknown one is accepted and silently ignored — so these tests check the
// flags AND that they are actually passed by the argument builder.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildChromiumArgs } from '../../src/main/launcher/chromium';

const LAUNCHER = path.resolve(__dirname, '../../src/main/launcher/chromium.ts');

/** The minimal config the argument builder needs. */
const cfg = (overrides: Record<string, unknown> = {}) =>
  ({
    profileId: 'p-session-test',
    userDataDir: path.resolve(__dirname, 'does-not-need-to-exist'),
    browserType: 'chromium' as const,
    ...overrides,
  }) as Parameters<typeof buildChromiumArgs>[0];

describe('session restore on relaunch', () => {
  it('asks the browser to reopen the last session', async () => {
    const args = await buildChromiumArgs(cfg());
    expect(args).toContain('--restore-last-session');
  });

  it('hides the crash-restore bubble, so the session arrives as a session', async () => {
    // A profile killed by force is recorded as having crashed. Without this switch the restore
    // turns into a "restore pages?" prompt, which does not read as "it continued where I left off".
    const args = await buildChromiumArgs(cfg());
    expect(args).toContain('--hide-crash-restore-bubble');
  });

  it('passes both flags alongside the per-profile switches, not instead of them', async () => {
    const args = await buildChromiumArgs(cfg({ launch_args: ['--renderer-process-limit=4'] }));
    expect(args).toContain('--restore-last-session');
    expect(args).toContain('--renderer-process-limit=4');
  });

  it('does not rely on writing Preferences, which Chromium overwrites', () => {
    // Guards the wrong approach from coming back: a Preference written before launch is discarded
    // by the browser during its own startup, so any restore built on it silently does nothing.
    const source = fs.readFileSync(LAUNCHER, 'utf8');
    expect(
      /session\.restore_on_startup\s*=/.test(source),
      'the restore must be a launch switch — Chromium rewrites Preferences while it runs, so a ' +
        'preference written before launch is gone before the browser reads it',
    ).toBe(false);
  });
});

// The flags are only real if the shipped kernel implements them. `grep` over the kernel binary is
// the check this project uses for every switch in the launcher, because Chromium accepts an
// unknown flag and ignores it — a control wired to a non-existent switch looks implemented while
// doing nothing.
describe('the kernel implements the session switches', () => {
  const KERNEL_DLL = 'D:/NULLTRACE/chromium/fingerprint-chromium/ungoogled-chromium_148.0.7778.215-1.1_windows_x64/chrome.dll';

  it('carries restore-last-session and hide-crash-restore-bubble', () => {
    if (!fs.existsSync(KERNEL_DLL)) {
      // The kernel lives in the operator's data directory; on a fresh checkout this cannot be
      // checked, and pretending otherwise would be a green test that proves nothing.
      console.warn('[sessionRestore] kernel binary not present; skipping the switch probe');
      return;
    }
    const bytes = fs.readFileSync(KERNEL_DLL).toString('latin1');
    expect(bytes.includes('restore-last-session'), 'kernel must implement --restore-last-session').toBe(true);
    expect(bytes.includes('hide-crash-restore-bubble'), 'kernel must implement --hide-crash-restore-bubble').toBe(true);
  });
});
