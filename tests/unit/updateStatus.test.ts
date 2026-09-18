// The update flow's decisions, in one tested place.
//
// These exist because the shape of the flow was the defect. The shell speaks the updater plugin's
// vocabulary (`update-available`, `download-progress`, `update-downloaded`), while the UI renders
// its own (`available`, `downloading`, `downloaded`). Two consumers translated that independently
// and both got it wrong in different ways:
//
//   * the footer dropped `download-progress`, so a download in flight could never show progress;
//   * Settings had no mapping at all and switched on `'available'`/`'downloading'` — strings the
//     shell never sends — so its update panel rendered nothing and its Download and Restart
//     buttons were unreachable.
//
// A third defect was structural rather than linguistic: clicking the footer control called only
// `update.check()`, so it reported "Update available" and stopped. The flow had no path to
// completion. `nextUpdateAction` is that path, expressed as a rule a test can hold onto.
import { describe, expect, it } from 'vitest';
import {
  isUpdatesUnconfigured,
  nextUpdateAction,
  normalizeUpdateStatus,
  presentUpdate,
  updateActionKey,
} from '../../src/renderer/src/updateStatus';
import type { UpdateStatus, UpdateStatusEventPayload } from '../../src/renderer/src/global';

describe('normalizeUpdateStatus', () => {
  it('translates every state the shell actually emits', () => {
    // The exact strings from `UpdateStatusEvent` constructions in src-tauri/src/updater.rs.
    const cases: Array<[UpdateStatusEventPayload, UpdateStatus['state']]> = [
      [{ state: 'checking-for-update' }, 'checking'],
      [{ state: 'update-available', info: { version: '0.7.0' } }, 'available'],
      [{ state: 'update-not-available' }, 'not-available'],
      [
        {
          state: 'download-progress',
          progress: { transferred: 50, total: 100, percent: 50 },
        },
        'downloading',
      ],
      [{ state: 'update-downloaded', info: { version: '0.7.0' } }, 'downloaded'],
      [{ state: 'installing' }, 'installing'],
      [{ state: 'error', message: 'boom' }, 'error'],
    ];

    for (const [payload, expected] of cases) {
      expect(normalizeUpdateStatus(payload).state, `state ${payload.state}`).toBe(expected);
    }
  });

  it('carries the download numbers through, so progress can be shown', () => {
    // The footer used to drop this payload entirely; without it the label sat at "Downloading..."
    // with no idea whether it was moving.
    const normalized = normalizeUpdateStatus({
      state: 'download-progress',
      progress: { transferred: 1024, total: 4096, percent: 25 },
    });
    expect(normalized).toEqual({
      state: 'downloading',
      percent: 25,
      bytesPerSecond: 0,
      transferred: 1024,
      total: 4096,
    });
  });

  it('treats a progress event with no numbers as still downloading', () => {
    // The shell sends `download-progress` with a message and no progress while it verifies the
    // signature. That is not a stalled download, and reporting 0% would read as one.
    const normalized = normalizeUpdateStatus({
      state: 'download-progress',
      message: 'Verifying artifact signature and anti-rollback...',
    });
    expect(normalized.state).toBe('downloading');
    expect(normalized).toMatchObject({ percent: 0, transferred: 0, total: 0 });
  });

  it('reports an unrecognised state as an error rather than silently ignoring it', () => {
    // A state the renderer does not know must not leave the UI looking idle-but-fine: that is
    // how "Update available" and then nothing happened reads to an operator.
    const normalized = normalizeUpdateStatus({ state: 'some-future-state' });
    expect(normalized.state).toBe('error');
  });

  it('preserves the message on an error', () => {
    const normalized = normalizeUpdateStatus({ state: 'error', message: 'Download failed: 404' });
    expect(normalized).toEqual({ state: 'error', message: 'Download failed: 404' });
  });
});

describe('nextUpdateAction', () => {
  it('drives an available update to download, and a downloaded one to install', () => {
    // This is the whole point of the fix: the flow must be able to reach its end.
    expect(nextUpdateAction({ state: 'available', info: { version: '0.7.0' } })).toBe('download');
    expect(nextUpdateAction({ state: 'downloaded', info: { version: '0.7.0' } })).toBe('install');
  });

  it('does not act on states that are already moving or finished', () => {
    // `checking` and `downloading` are in flight, and calling download() during them would fetch
    // the artefact twice; `installing` must not be re-triggered at all.
    const idle: UpdateStatus[] = [
      { state: 'checking' },
      { state: 'downloading', percent: 10, bytesPerSecond: 0, transferred: 1, total: 10 },
      { state: 'installing' },
      { state: 'not-available', info: {} },
      { state: 'error', message: 'x' },
    ];
    for (const status of idle) {
      expect(nextUpdateAction(status), status.state).toBeNull();
    }
  });

  it('has nothing to do before a check has run', () => {
    expect(nextUpdateAction(null)).toBeNull();
  });
});

describe('updateActionKey', () => {
  it('makes the same step on the same version idempotent', () => {
    // StrictMode re-runs effects on one state, and the shell re-emits download-progress many times
    // a second. Both would fire a second download/install without this.
    const first = updateActionKey('download', { state: 'available', info: { version: '0.7.0' } });
    const second = updateActionKey('download', { state: 'available', info: { version: '0.7.0' } });
    expect(first).toBe(second);
  });

  it('lets the next step through, and a new version through', () => {
    const download = updateActionKey('download', { state: 'available', info: { version: '0.7.0' } });
    const install = updateActionKey('install', { state: 'downloaded', info: { version: '0.7.0' } });
    const nextVersion = updateActionKey('download', {
      state: 'available',
      info: { version: '0.8.0' },
    });
    expect(install).not.toBe(download);
    expect(nextVersion).not.toBe(download);
  });
});

describe('presentUpdate', () => {
  it('reports each state as its own label', () => {
    const labels = [
      [null, false, 'Not checked'],
      [{ state: 'checking' }, true, 'Checking…'],
      [{ state: 'available', info: { version: '0.7.0' } }, true, 'Update available'],
      [{ state: 'downloaded', info: {} }, true, 'Restart to update'],
      [{ state: 'installing' }, true, 'Installing…'],
      [{ state: 'not-available', info: {} }, true, 'Up to date'],
    ] as const;

    for (const [status, hasRun, expected] of labels) {
      expect(presentUpdate(status, hasRun).labelKey, expected).toBe(expected);
    }
  });

  it('shows the percentage while downloading', () => {
    const view = presentUpdate(
      { state: 'downloading', percent: 41.6, bytesPerSecond: 0, transferred: 4, total: 10 },
      true
    );
    expect(view.labelKey).toBe('Downloading…');
    expect(view.percent).toBe(42);
  });

  it('calls an unpublished release "not configured" instead of a failed check', () => {
    // A release that has not published `latest.json` is not something the operator broke, and
    // presenting it as an error invites them to retry a check that cannot succeed yet.
    const unconfigured = presentUpdate(
      { state: 'error', message: 'Could not fetch a valid release JSON from the remote' },
      true
    );
    expect(unconfigured.labelKey).toBe('Updates not configured');

    const broken = presentUpdate({ state: 'error', message: 'Download failed: socket hang up' }, true);
    expect(broken.labelKey).toBe('Check failed');
    expect(broken.titleKey).toContain('socket hang up');
  });

  it('says nothing has been checked before a check has run, whatever the state', () => {
    const view = presentUpdate({ state: 'available', info: { version: '0.7.0' } }, false);
    expect(view.labelKey).toBe('Not checked');
    expect(view.percent).toBeNull();
  });
});

describe('isUpdatesUnconfigured', () => {
  it('recognises the plugin wording and the bare 404', () => {
    expect(
      isUpdatesUnconfigured({
        state: 'error',
        message: 'Could not fetch a valid release JSON from the remote',
      })
    ).toBe(true);
    expect(isUpdatesUnconfigured({ state: 'error', message: 'Download request failed: 404' })).toBe(
      true
    );
  });

  it('is false for anything that is not an update-metadata error', () => {
    expect(isUpdatesUnconfigured(null)).toBe(false);
    expect(isUpdatesUnconfigured({ state: 'not-available', info: {} })).toBe(false);
    expect(isUpdatesUnconfigured({ state: 'error', message: 'disk full' })).toBe(false);
  });
});
