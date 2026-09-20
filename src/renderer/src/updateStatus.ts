import type { UpdateStatus, UpdateStatusEventPayload } from './global';

/**
 * Update-flow decisions, as pure functions.
 *
 * They live here rather than inside `App.tsx` because the footer pill now drives a *sequence*
 * (check → download → install) instead of a single call, and a React effect cannot be tested
 * without a DOM harness. The rule this file encodes is the one that was missing: clicking the
 * control MUST be able to reach the end of the flow, not just its first step.
 */

/**
 * Translates the shell's payload into the shape the UI renders.
 *
 * The Rust side speaks the plugin's vocabulary; the UI speaks its own. Keeping the mapping in
 * one place is the fix for the two defects it replaces: the footer's private mapping dropped
 * `download-progress` on the floor (so a download could never show progress), and Settings had
 * no mapping at all, so it switched on `'available'`/`'downloading'` — strings the shell never
 * sends — and rendered an empty update panel with unreachable buttons.
 */
export function normalizeUpdateStatus(payload: UpdateStatusEventPayload): UpdateStatus {
  switch (payload.state) {
    case 'checking-for-update':
    case 'checking':
      return { state: 'checking' };
    case 'update-available':
      return { state: 'available', info: payload.info ?? {} };
    case 'update-not-available':
      return { state: 'not-available', info: payload.info ?? {} };
    case 'download-progress': {
      const progress = payload.progress;
      // A `download-progress` without numbers is the shell's "verifying the signature" notice.
      // Treat it as still-downloading rather than inventing a percentage: the flow is in
      // flight, and reporting 0% would read as a stalled download.
      if (!progress) return { state: 'downloading', percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 };
      return {
        state: 'downloading',
        percent: progress.percent,
        bytesPerSecond: 0,
        transferred: progress.transferred,
        total: progress.total,
      };
    }
    case 'update-downloaded':
      return { state: 'downloaded', info: payload.info ?? {} };
    case 'installing':
      return { state: 'installing' };
    default:
      return { state: 'error', message: payload.message ?? '' };
  }
}


/** The next call that moves the flow forward, or `null` when it is already moving. */
export type UpdateAction = 'download' | 'install';

/**
 * What to call next, given the state the shell reported.
 *
 * `'available'` still needs the bytes, `'downloaded'` has them verified and waits for the swap.
 * Every other state is either in-flight (`checking`, `downloading`, `installing`) or terminal
 * (`not-available`, `error`), where another call would be wrong — a second `download()` would
 * fetch the artefact twice, and a second `install()` would try to reinstall what is gone.
 */
export function nextUpdateAction(status: UpdateStatus | null): UpdateAction | null {
  if (!status) return null;
  if (status.state === 'available') return 'download';
  if (status.state === 'downloaded') return 'install';
  return null;
}

/**
 * Identity of one dispatch, so a state can only advance the flow once.
 *
 * React's StrictMode runs effects twice on the same state, and the shell re-emits
 * `download-progress` many times per second. Without a key the effect would fire a second
 * `download()` on the re-run and a second `install()` on the next tick. The version is part of
 * the key because a *new* update offer must be actionable again.
 */
export function updateActionKey(action: UpdateAction, status: UpdateStatus | null): string {
  const version =
    status && 'info' in status && status.info && typeof status.info.version === 'string'
      ? status.info.version
      : '';
  return `${action}:${version}`;
}

export interface UpdatePresentation {
  /** i18n key for the pill/footer line. */
  labelKey: string;
  /** i18n key for the hover tooltip. */
  titleKey: string;
  /** Percent complete, present only while downloading (the shell reports it). */
  percent: number | null;
  /**
   * The state this presentation describes, so a caller can style by state without re-deriving it
   * from the label text — which would break the moment a translation changed a word.
   * `'idle'` is the not-yet-checked case, which has no `UpdateStatus` behind it.
   */
  state: UpdateStatus['state'] | 'idle';
}

/**
 * Resolves the footer text for a state.
 *
 * Returns i18n *keys* rather than sentences so the caller owns translation, and so a missing
 * translation degrades to the English source string instead of to nothing.
 */
export function presentUpdate(status: UpdateStatus | null, hasRunCheck: boolean): UpdatePresentation {
  if (!hasRunCheck || !status) {
    return { labelKey: 'Not checked', titleKey: 'Update check has not run', percent: null, state: 'idle' };
  }

  switch (status.state) {
    case 'checking':
      return { labelKey: 'Checking…', titleKey: 'Checking for updates...', percent: null, state: 'checking' };
    case 'available':
      return {
        labelKey: 'Update available',
        titleKey: `Update available: ${status.info?.version ?? 'new'}`,
        percent: null,
        state: 'available',
      };
    case 'downloading':
      return {
        labelKey: 'Downloading…',
        titleKey: 'Downloading update...',
        percent: Math.round(status.percent),
        state: 'downloading',
      };
    case 'downloaded':
      return {
        labelKey: 'Restart to update',
        titleKey: 'Update downloaded (ready to install)',
        percent: null,
        state: 'downloaded',
      };
    case 'installing':
      return { labelKey: 'Installing…', titleKey: 'Applying the update...', percent: null, state: 'installing' };
    case 'not-available':
      return { labelKey: 'Up to date', titleKey: 'You are on the latest version.', percent: null, state: 'not-available' };
    case 'error':
      // A release without `latest.json` is not a failure the operator can act on — the endpoint
      // genuinely has nothing to serve until a release publishes it, so say that instead.
      return isUpdatesUnconfigured(status)
        ? {
            labelKey: 'Updates not configured',
            titleKey: 'Automatic updates are not configured for this build yet',
            percent: null,
            state: 'error',
          }
        : {
            labelKey: 'Check failed',
            titleKey: `Update error: ${status.message}`,
            percent: null,
            state: 'error',
          };
    default:
      return { labelKey: 'Not checked', titleKey: 'Update check has not run', percent: null, state: 'idle' };
  }
}

/**
 * Whether an error means "no published update metadata" rather than a broken check.
 *
 * The plugin words it "Could not fetch a valid release JSON from the remote" — matched on the
 * phrase the plugin actually emits, plus the bare status a proxy can substitute.
 */
export function isUpdatesUnconfigured(status: UpdateStatus | null): boolean {
  if (!status || status.state !== 'error') return false;
  const message = status.message ?? '';
  return (
    message.includes('Could not fetch a valid release JSON') ||
    message.includes('release JSON') ||
    message.includes('404')
  );
}
