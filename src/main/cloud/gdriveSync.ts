/**
 * Google Drive Auto-Sync Engine (nulltrace-gdrive Zone B).
 *
 * Implements one-click auto-sync lifecycle for NullTrace browser data:
 * - Debounced push on local changes ('change')
 * - Launch pull on service startup ('launch')
 * - Final push during graceful shutdown ('exit')
 * - Periodic background sync ('timer')
 * - Immediate on-demand sync ('manual')
 *
 * Concurrency & Reliability guarantees:
 * 1. Debouncing & Collapsing: A rapid burst of local writes (e.g. creating/updating multiple
 *    profiles in a batch) collapses into a single upload. If a sync is already in flight,
 *    subsequent requests are queued as a single trailing sync rather than spawning concurrent
 *    network requests that race on Drive files.
 * 2. Non-throwing contract: Background triggers (file watchers, DB hooks, timers) must never
 *    have their call stacks unhandled by sync errors. All exceptions are captured into `lastError`
 *    and queryable via `getSyncStatus()`.
 * 3. Passphrase gating: E2E payload encryption requires the operator's passphrase. If the
 *    session is not yet unlocked, background pushes safely no-op (leaving `unlocked: false`)
 *    so the UI can prompt the operator. The passphrase is NEVER stored on disk or logged.
 */

import { getGDriveStatus, getGDriveTimestamps } from './gdriveAuth';
import { getSetting, setSetting } from '../config';
import {
  checkPassphraseVerifier,
  makePassphraseVerifier,
  openPayload,
  SyncDecryptError,
} from './syncCrypto';
import * as transfer from './gdriveTransfer';

export type SyncTrigger = 'launch' | 'change' | 'timer' | 'exit' | 'manual';

export interface SyncStatus {
  connected: boolean;
  account: string | null;
  /** true once the operator has unlocked the passphrase for this session. */
  unlocked: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Set when a pull found remote changes newer than local ones. */
  pendingRemoteChanges: number;
}

// In-memory session state (strictly ephemeral, never persisted to disk or DB)
let sessionPassphrase: string | null = null;
let sessionUnlocked = false;
let pendingPassphrase: string | null = null;

// Engine state
let engineStarted = false;
let isSyncing = false;
let lastSyncAt: number | null = null;
let lastError: string | null = null;
let pendingRemoteChanges = 0;

// Concurrency control: collapsing in-flight and debouncing
let debounceTimer: NodeJS.Timeout | null = null;
let inFlightPromise: Promise<void> | null = null;
let queuedTrigger: SyncTrigger | null = null;
let periodicTimer: NodeJS.Timeout | null = null;

const DEBOUNCE_DELAY_MS = 3000;
const PERIODIC_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Returns the current synchronization status.
 * Safe to call at any time; never throws.
 */
export function getSyncStatus(): SyncStatus {
  const gdrive = getGDriveStatus();
  const connected = Boolean(gdrive.connected);

  // If lastSyncAt is not recorded in memory yet, seed it from recorded push/pull timestamps
  let effectiveLastSync = lastSyncAt;
  if (effectiveLastSync === null) {
    const { lastPush, lastPull } = getGDriveTimestamps();
    const maxTs = Math.max(lastPush ?? 0, lastPull ?? 0);
    if (maxTs > 0) {
      effectiveLastSync = maxTs;
    }
  }

  return {
    connected,
    account: gdrive.email || null,
    unlocked: sessionUnlocked,
    syncing: isSyncing,
    lastSyncAt: effectiveLastSync,
    lastError,
    pendingRemoteChanges,
  };
}

/**
 * Whether the sync engine is unlocked for the current application session.
 */
export function isUnlocked(): boolean {
  return sessionUnlocked;
}

/**
 * Returns the active session passphrase in memory, or null if locked.
 */
export function getSessionPassphrase(): string | null {
  return sessionPassphrase;
}

/**
 * Stashes a passphrase temporarily during a multi-step device code authorization flow,
 * so the engine can immediately unlock once token exchange completes.
 */
export function setPendingPassphrase(passphrase: string): void {
  pendingPassphrase = passphrase;
}

export function getPendingPassphrase(): string | null {
  return pendingPassphrase;
}

export function clearPendingPassphrase(): void {
  pendingPassphrase = null;
}

/**
 * Resets in-memory secrets and locks the sync session.
 * Called when disconnecting from Google Drive or resetting credentials.
 */
export function clearSyncSession(): void {
  sessionPassphrase = null;
  sessionUnlocked = false;
  pendingPassphrase = null;
  pendingRemoteChanges = 0;
  lastError = null;
  stopSyncEngine();
}

/**
 * Unlocks the sync engine with the operator's passphrase for this session.
 *
 * Verification order:
 * 1. If a local verifier exists in settings (salt + sealed probe, zero secret data),
 *    check the passphrase against it. A mismatch rejects immediately with false.
 * 2. If no local verifier exists (e.g. fresh second machine), inspect the remote Drive folder.
 *    If sealed payloads exist (e.g. profiles.json), test-decrypt with openPayload.
 *    If decryption fails (SyncDecryptError), reject with false.
 *    If decryption succeeds, generate and save the local verifier so subsequent unlocks
 *    need no network round-trip.
 * 3. If neither local verifier nor remote sealed payloads exist (brand new installation),
 *    accept the passphrase as the initial master secret and save its verifier.
 *
 * Security invariant:
 * The plaintext passphrase is held ONLY in in-memory variable `sessionPassphrase`
 * for the lifetime of this process. It is NEVER written to disk, settings.json, DB, or logs.
 */
export async function unlockSession(passphrase: string): Promise<boolean> {
  if (!passphrase || typeof passphrase !== 'string' || passphrase.trim().length === 0) {
    return false;
  }

  const trimmed = passphrase.trim();
  const storedVerifier = getSetting('syncPassphraseVerifier');

  if (typeof storedVerifier === 'string' && storedVerifier.length > 0) {
    // 1. Local verifier check
    const valid = checkPassphraseVerifier(
      trimmed,
      Buffer.from(storedVerifier, 'base64')
    );
    if (!valid) {
      return false;
    }
  } else {
    // 2. No local verifier stored yet. Check if remote sealed files exist on Drive to test decrypt.
    const gdrive = getGDriveStatus();
    if (gdrive.connected) {
      try {
        const folderId = await transfer.ensureSyncFolder();
        const transport = transfer.getGDriveTransport();
        const files: transfer.DriveFileInfo[] = await transport.listFiles(folderId);
        const profilesFile = files.find(
          (f: transfer.DriveFileInfo) => f.name === transfer.GDRIVE_PROFILES_FILE
        );
        if (profilesFile) {
          const raw = await transport.downloadFile(profilesFile.id);
          // openPayload throws SyncDecryptError on wrong passphrase or tampered payload
          openPayload(trimmed, Buffer.from(raw));
        }
      } catch (err: unknown) {
        if (
          err instanceof SyncDecryptError ||
          (err instanceof Error &&
            (err.message.toLowerCase().includes('decrypt') ||
              err.message.toLowerCase().includes('tag') ||
              err.message.toLowerCase().includes('bad passphrase')))
        ) {
          return false;
        }
        // Non-crypto errors (e.g. temporary network blip or folder not found) fall through
      }
    }

    // 3. New passphrase or verified remote payload: persist local salted verifier
    try {
      const verifierBuf = makePassphraseVerifier(trimmed);
      setSetting('syncPassphraseVerifier', verifierBuf.toString('base64'));
    } catch {
      // Non-fatal: verifier can be generated on next unlock
    }
  }

  sessionPassphrase = trimmed;
  sessionUnlocked = true;
  lastError = null;

  // Inform gdriveTransfer in-memory passphrase holder if present
  const transferRecords = transfer as Record<string, unknown>;
  if (typeof transferRecords.setSyncPassphrase === 'function') {
    (transferRecords.setSyncPassphrase as (p: string) => void)(trimmed);
  }

  // If sync engine was idle, start it now
  startSyncEngine();

  // Trigger launch pull / sync
  requestSync('launch');
  return true;
}

/**
 * Requests synchronization for a given trigger reason.
 *
 * Debouncing behaviour:
 * - 'change' triggers are debounced by DEBOUNCE_DELAY_MS so bursts of filesystem or DB
 *   updates produce only one push.
 * - 'exit' cancels any pending debounce and flushes immediately.
 * - 'launch', 'manual', and 'timer' execute immediately.
 *
 * Concurrency behaviour:
 * Concurrent calls collapse into a single in-flight run. If a run is already executing,
 * the trigger is registered as next-in-line and executed when the current run finishes.
 *
 * Error behaviour:
 * NEVER throws to the caller. Failures are stored in `lastError` and the engine is
 * left in a clean, unlocked, non-wedged state for subsequent calls.
 */
export function requestSync(reason: SyncTrigger): Promise<void> | void {
  try {
    if (reason === 'change') {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        executeSync('change').catch(() => {});
      }, DEBOUNCE_DELAY_MS);
      return;
    }

    if (reason === 'exit') {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      return executeSync('exit');
    }

    return executeSync(reason);
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Internal worker that manages in-flight collapse and queues.
 */
async function executeSync(reason: SyncTrigger): Promise<void> {
  if (inFlightPromise) {
    // A sync is currently in-flight: collapse additional triggers into the next run
    queuedTrigger = reason;
    return inFlightPromise;
  }

  isSyncing = true;
  inFlightPromise = (async () => {
    try {
      await performSync(reason);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      isSyncing = false;
      inFlightPromise = null;

      if (queuedTrigger) {
        const next = queuedTrigger;
        queuedTrigger = null;
        executeSync(next).catch(() => {});
      }
    }
  })();

  return inFlightPromise;
}

/**
 * Performs the actual Drive pull or push operation.
 */
async function performSync(reason: SyncTrigger): Promise<void> {
  const gdrive = getGDriveStatus();
  if (!gdrive.connected) {
    lastError = 'Google Drive is not connected';
    return;
  }

  // Launch trigger: pull from Drive
  if (reason === 'launch') {
    // 1. Inspect remote state (manifest is plaintext, readable pre-unlock)
    try {
      const inspection = await transfer.inspectGDrivePull();
      if (!inspection.unchanged) {
        pendingRemoteChanges =
          (inspection.newProfiles || 0) +
          (inspection.newScripts || 0) +
          (inspection.conflicts?.length || 0);
      } else {
        pendingRemoteChanges = 0;
      }
    } catch {
      // Non-fatal inspection error
    }

    // 2. If unlocked, pull data to local DB
    if (sessionUnlocked) {
      try {
        const pullOptions = {
          conflictResolution: 'keep_local' as const,
          ...(sessionPassphrase ? { passphrase: sessionPassphrase } : {}),
        };
        const pullRes = await transfer.pullFromGDrive(pullOptions);
        lastSyncAt = pullRes.timestamp || Date.now();
        pendingRemoteChanges = 0;
        lastError = null;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    return;
  }

  // Push triggers ('change', 'timer', 'exit', 'manual'):
  // If the passphrase is not unlocked this session, background triggers MUST NOT push
  // (that would require the key). Safely exit leaving unlocked = false.
  if (!sessionUnlocked) {
    if (reason === 'manual') {
      lastError = 'Google Drive sync is locked. Please enter your passphrase.';
    }
    return;
  }

  // Manual trigger: pull pending remote changes first, then push
  if (reason === 'manual' && pendingRemoteChanges > 0) {
    try {
      await transfer.pullFromGDrive({
        conflictResolution: 'keep_local',
        ...(sessionPassphrase ? { passphrase: sessionPassphrase } : {}),
      });
    } catch {
      // Best effort pull before push
    }
  }

  // Push local data to Drive
  try {
    const pushFn = transfer.pushToGDrive as (pass?: string) => Promise<{ timestamp: number }>;
    const pushRes = await pushFn(sessionPassphrase ?? undefined);
    lastSyncAt = pushRes.timestamp || Date.now();
    lastError = null;
    pendingRemoteChanges = 0;
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Starts the synchronization engine background timer and registers event triggers.
 *
 * Idempotent: Calling this multiple times is safe and will not spawn duplicate timers.
 * When Drive is not connected, it sets lastError and returns cleanly without throwing.
 */
export function startSyncEngine(): void {
  const gdrive = getGDriveStatus();
  if (!gdrive.connected) {
    lastError = 'Google Drive is not connected';
    return;
  }

  if (engineStarted) {
    return;
  }

  engineStarted = true;
  lastError = null;

  // Set up periodic sync timer
  if (!periodicTimer) {
    periodicTimer = setInterval(() => {
      requestSync('timer');
    }, PERIODIC_SYNC_INTERVAL_MS);
    if (periodicTimer.unref) {
      periodicTimer.unref();
    }
  }

  // Launch initial pull
  requestSync('launch');
}

/**
 * Stops the synchronization engine, clearing all background and debounce timers.
 * Called during application graceful shutdown.
 */
export function stopSyncEngine(): void {
  engineStarted = false;
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
