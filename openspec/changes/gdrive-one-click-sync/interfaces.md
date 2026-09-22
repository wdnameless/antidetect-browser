# Interfaces — frozen contracts

Zone owners are exclusive. Do not edit a file owned by another zone.

## Zone A — crypto + payload

**Owner files:** `src/main/cloud/syncCrypto.ts` (new), `src/main/cloud/gdriveTransfer.ts`,
`src/main/profiles/profileManager.ts`

```ts
// src/main/cloud/syncCrypto.ts  (NEW)
/** Magic + version prefix of every uploaded blob. 4 bytes ASCII "NTG1". */
export const SYNC_ENVELOPE_MAGIC: Buffer;

/** Derive a 32-byte key from the operator passphrase. scrypt, cost stored in the envelope. */
export function deriveSyncKey(passphrase: string, salt: Buffer): Buffer;

/** Envelope = MAGIC || salt(16) || nonce(12) || tag(16) || ciphertext. AES-256-GCM. */
export function sealPayload(passphrase: string, plaintext: Buffer): Buffer;
export function openPayload(passphrase: string, envelope: Buffer): Buffer;

/** Thrown by openPayload when the passphrase is wrong or the blob was tampered with. */
export class SyncDecryptError extends Error {}

/**
 * Passphrase check without touching Drive: seal a fixed probe with a random salt and
 * verify it round-trips. Lets the UI reject a typo before a bad push overwrites good data.
 */
export function makePassphraseVerifier(passphrase: string): Buffer;
export function checkPassphraseVerifier(passphrase: string, verifier: Buffer): boolean;
```

`sealPayload`/`openPayload` MUST delegate the AEAD to the existing
`encryptBundle`/`decryptBundle` in `src/main/teams/teamCrypto.ts` (AES-256-GCM,
`nonce || tag || ciphertext`). Do not write a second cipher.

**Remote layout** (folder renamed per R2):

```ts
export const GDRIVE_FOLDER_NAME = 'nulltrace data';
export const GDRIVE_MANIFEST_FILE = 'manifest.json';   // NOT encrypted (needs to be readable pre-unlock)
export const GDRIVE_PROFILES_FILE = 'profiles.json';   // sealed envelope
export const GDRIVE_SCRIPTS_FILE = 'scripts.json';     // sealed envelope
export const GDRIVE_SETTINGS_FILE = 'settings.json';   // sealed envelope
export const GDRIVE_VAULT_FILE = 'vault.json';         // sealed envelope
```

`manifest.json` stays plaintext and carries only:

```ts
interface GDriveManifest {
  version: 1; app: 'nulltrace';
  exportedAt: number;
  sealed: true;                    // false when encryption is disabled by the operator
  profileCount: number;
  scriptCount: number;
  vaultCount: number;
  /** Which payload files exist this revision, so a pull knows what to expect. */
  files: string[];
  /** SHA-256 of each sealed file, hex. Detects a truncated/tampered upload. */
  digests: Record<string, string>;
}
```

**Payload extension (R3 — "all data").** The synced set must additionally carry, each as its own
sealed file:
- `vault.json` — full `account_credentials` rows for live profiles. Secrets stay in their stored
  `enc:` form; do NOT `revealSecret` them for transport (the envelope is the protection).
- Profiles: add `notes` (and `tags` via `profile_tags`) to `ProfileBundle` in `profileManager.ts`,
  both `exportProfileBundle` and `importProfileBundle`. A note that does not round-trip through
  the bundle silently arrives empty on the second machine.
- Proxies referenced by the bundles, and `groups`, must arrive too, or restored profiles lose their
  group assignment and proxy binding.

**Do NOT add** `Cache`, `Code Cache`, `GPUCache`, `DawnWebGPUCache`, `GraphiteDawnCache`,
`ShaderCache`, `GrShaderCache`, `lockfile`, `Singleton*`, `DevToolsActivePort`, `*-journal`
to any synced payload. They are regenerated and the locks can wedge a profile.

## Zone B — engine + connect + endpoints

**Owner files:** `src/main/cloud/gdriveSync.ts` (new), `src/main/cloud/gdriveAuth.ts`,
`src/main/config.ts`, `src/main/index.ts`, `src/main/api/routes/cloud.ts`

```ts
// src/main/cloud/gdriveSync.ts  (NEW)
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
export function getSyncStatus(): SyncStatus;
/** Debounced; concurrent calls collapse into one run. Never throws. */
export function requestSync(reason: SyncTrigger): void;
export function startSyncEngine(): void;   // called once at boot, after DB init
export function stopSyncEngine(): void;    // called on shutdown
```

**One-button connect (R1, R6).** The OAuth client ships in the build:

```ts
// src/main/config.ts
/**
 * Publisher's OAuth client, injected at build time. Empty when the build was not given one —
 * the UI then falls back to the per-operator Client ID fields, so a dev build still works.
 */
export const SHIPPED_GDRIVE_CLIENT_ID: string;
```

`gdriveAuth.getGDriveCredentials()` must return the shipped client ID when the operator has not
entered their own. Per-operator credentials remain supported and take precedence when present.

**Lifecycle (R7).** `src/main/index.ts` calls `startSyncEngine()` after DB init; on shutdown it
flushes a final `requestSync('exit')`. Pull happens on `'launch'`.

**Endpoints** (added to `src/main/api/routes/cloud.ts`, all under the existing auth middleware):

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/v1/cloud/gdrive/status` | — | `SyncStatus` (extended, existing fields kept) |
| POST | `/api/v1/cloud/gdrive/connect` | `{ passphrase: string }` | `{ email?: string }` — one call: device-code auth if needed, then unlock |
| POST | `/api/v1/cloud/gdrive/unlock` | `{ passphrase: string }` | `{ ok: true }` or 400 `BAD_PASSPHRASE` |
| POST | `/api/v1/cloud/gdrive/sync-now` | — | `SyncStatus` |
| POST | `/api/v1/cloud/gdrive/mirror/enable` | `{ enabled: boolean }` | `{ enabled }` (Zone C) |
| POST | `/api/v1/cloud/gdrive/mirror/run` | — | `{ bytes: number }` (Zone C) |

Existing `/gdrive/credentials`, `/gdrive/auth/*`, `/gdrive/push`, `/gdrive/pull`,
`/gdrive/inspect-pull`, `/gdrive/disconnect` keep working unchanged.

## Zone C — full Chromium mirror (opt-in)

**Owner files:** `src/main/cloud/gdriveFullMirror.ts` (new), `src/main/cloud/gdriveClient.ts`

```ts
// src/main/cloud/gdriveFullMirror.ts  (NEW)
export interface MirrorProgress { files: number; totalFiles: number; uploadedBytes: number; }
export interface MirrorResult { archiveBytes: number; fileCount: number; excluded: string[]; }

/**
 * Build a deterministic archive of the profile directories and upload it in Drive-resumable
 * chunks. Excludes the regenerated/locking paths listed in Zone A.
 * Returns the manifest of what was skipped so the UI can show the operator the real cost.
 */
export function createMirrorArchive(
  profileIds: string[] | null,
  onProgress?: (p: MirrorProgress) => void
): Promise<MirrorResult>;

export function restoreMirrorArchive(
  profileIds: string[] | null,
  onProgress?: (p: MirrorProgress) => void
): Promise<{ restoredProfiles: number }>;
```

`gdriveClient.ts` gains chunked/resumable upload + download with progress on the `GDriveTransport`
interface; keep the existing `uploadFile`/`downloadFile` signatures intact for callers.

## Zone D — renderer

**Owner files:** `src/renderer/src/pages/CloudSync.tsx`, `src/renderer/src/api.ts`,
`src/renderer/src/i18n.tsx`

- One primary button: **"Connect Google Drive"**. Clicking it prompts for the passphrase (min 8
  chars, confirmed), calls `/gdrive/connect`, and shows progress. No Client ID fields in the default
  path; keep them behind an "advanced" disclosure for the fallback case.
- Connected state shows: account, last sync time in human words, "Sync now", and the on/off switch.
- Passphrase prompt must state plainly, in RU and EN: the passphrase is not stored anywhere, is
  required on every machine, and a forgotten passphrase means the Drive copy cannot be restored.
- A visibly separated, OFF-by-default switch for the full Chromium mirror, with the measured
  numbers from `manifest.md` (304 KB vs 795 MB, and that caches are regenerated anyway) next to it.
- Every new user-visible string gets a RU entry; English string is the key.

## Cross-zone rules

- The passphrase NEVER touches disk: not in settings, not in the DB, not in logs. Only the
  `makePassphraseVerifier` blob (salted, no passphrase material recoverable) may be persisted.
- Never log payload contents, secrets or the passphrase. Redact to `[REDACTED]`.
- A failed `openPayload` on pull must abort BEFORE writing anything to the database — a wrong
  passphrase must never partially overwrite local data.
