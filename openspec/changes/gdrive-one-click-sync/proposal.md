# gdrive-one-click-sync

## Why

The operator asked for a single button that connects the product to the user's own Google Drive and
keeps all browser data in sync automatically, so the same operator can sit down at a second machine,
press the same button, and have everything there:

> «Я хочу чтобы юзер нажимал одну кнопку и подключался к своему гуглдрайву и все юзерданные нашего
> браузера автоматически синкались в папку nulltrace data на гугл драйве. Так же если он мог бы
> зайти с другого пк, так же зайти нажать кнопку и синхронизировать все данные.»

Three things stand between today's code and that sentence:

1. **Five steps of Google Cloud Console before the button does anything.** The shipped instructions
   tell the operator to create a Cloud project, enable the Drive API, configure a consent screen,
   create an OAuth client and paste its ID. There is no shipped client ID (`getGDriveCredentials()`
   returns `null` until the operator types one), so the Connect button is inert on a fresh install.
2. **Sync is manual and partial.** Push and Pull are buttons. Nothing schedules them, and the pushed
   set omits the vault, the new per-profile note, and any group/tag association.
3. **The upload is plaintext.** `exportProfileBundle` deliberately decrypts proxy passwords and SSH
   keys (`revealSecret`) and carries cookies; `pushToGDrive` JSON-stringifies that straight into
   Drive with no encryption step. The comment there ("bundles are explicit user exports") holds for a
   file the operator hands to someone on purpose — it does not hold for a background job that copies
   live sessions into a cloud account.

## What Changes

- **One button.** The publisher's OAuth client ships in the build (`SHIPPED_GDRIVE_CLIENT_ID`); the
  per-operator Client ID/Secret fields remain as an advanced fallback so a dev build still works.
  `POST /cloud/gdrive/connect` performs device-code auth and unlocks the passphrase in one call.
- **End-to-end encryption.** New `src/main/cloud/syncCrypto.ts` seals every payload with AES-256-GCM
  under a scrypt-derived key from an operator passphrase that is never stored or transmitted. The
  AEAD itself is delegated to the existing `encryptBundle`/`decryptBundle` in `teams/teamCrypto.ts`
  rather than reimplemented. `manifest.json` stays plaintext (version and digests only, no user data)
  so a client can decide whether to ask for the passphrase before downloading anything.
- **Complete payload.** Adds `vault.json` (`account_credentials`, secrets kept in stored `enc:` form),
  the per-profile `notes` field, tags, groups and the proxies a bundle references — all of which are
  missing today, and each of which silently degrades a restore on the second machine.
- **Automatic sync.** New `src/main/cloud/gdriveSync.ts`: debounced push on data change, push on exit,
  pull on launch, all collapsing into one in-flight run; `startSyncEngine()` wired into boot.
- **Folder renamed** to `nulltrace data` per the operator's words (was `NullTrace_Sync`).
- **Opt-in full Chromium mirror**, off by default, with the measured cost shown in the UI.

## Impact

- Affected specs: `cloud-sync` (new capability).
- Affected code: `src/main/cloud/*` (new `syncCrypto.ts`, `gdriveSync.ts`, `gdriveFullMirror.ts`;
  changes to `gdriveTransfer.ts`, `gdriveAuth.ts`, `gdriveClient.ts`), `src/main/config.ts`,
  `src/main/index.ts`, `src/main/api/routes/cloud.ts`, `src/main/profiles/profileManager.ts`,
  `src/renderer/src/pages/CloudSync.tsx`, `src/renderer/src/api.ts`, `src/renderer/src/i18n.tsx`.
- Not breaking: existing `/gdrive/push|pull|inspect-pull|credentials|auth/*|disconnect` keep their
  behaviour and signatures. A Drive folder from a previous version still reads (files are found by
  name; the folder is created under the new name only when absent, and the old one is adopted).
- Risk accepted: the first push after this change replaces plaintext payloads with sealed ones. A
  client older than this version will fail to parse them. Acceptable — the older client is the one
  uploading plaintext, and the alternative is leaving live sessions readable in Drive.
