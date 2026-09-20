# Interfaces — licensing-and-fork-protection

Frozen boundaries for Wave 3. Owners are exclusive: one writer per file.
The orchestrator owns this document; nobody else edits it.

## §A. Canonical key artifact — ONE source, two languages

**Owner of the format: orchestrator. Already on disk.**

`resources/license-public-key.pem` is the single canonical public key (SPKI PEM, Ed25519).
It exists now; fingerprint `43036aa6496ca675`. The matching private key lives at
`D:/nulltrace-keys/license-private.pem`, **outside the repository, never committed**.

Consumers:

| Language | Mechanism | File |
|---|---|---|
| Rust | `include_str!("../../resources/license-public-key.pem")` — baked into the binary at compile time | `src-tauri/src/license.rs` |
| TypeScript | generated from the PEM into a TS constant | `src/main/licensing/publicKey.ts` |

The TS side is **generated**, never hand-edited, by `scripts/sync-license-key.mjs`. A drift test
asserts the generated constant matches the PEM, because the plausible failure — rotate the PEM,
forget to regenerate — would make the shipped app reject every valid licence.

## §B. Licence token format — unchanged, frozen

```
<base64url(payload JSON)>.<base64url(Ed25519 signature over the exact payload bytes)>
```

Payload: `{"plan":"pro","exp":<unix seconds>?,"email":<string>?}`. Absent `exp` = perpetual.
This format is already in the wild; changing it would break issued keys. It does NOT change.

Consequence that satisfies R13i automatically: any key signed with the **old leaked** private key
now fails verification, because the pinned public key changed to a key whose private half has
never been published.

## §C. Rust verifier — `src-tauri/src/license.rs`

Owner: **Ticket A**. Consumed by: Ticket B (verdict file), the renderer (via bridge).

```rust
/// Canonical verdict. Serialized to JSON with these exact field names.
pub struct LicenseVerdict {
    pub schema: u32,          // always 1
    pub valid: bool,
    pub plan: Option<String>, // "pro" when valid
    pub email: Option<String>,
    pub exp: Option<i64>,     // unix seconds
    pub reason: Option<String>, // INVALID_SIGNATURE | MALFORMED | EXPIRED | WRONG_PLAN | null
    pub token_fp: String,     // first 16 hex chars of sha256(raw token as UTF-8)
    pub key_fp: String,       // first 16 hex chars of sha256(public key PEM as UTF-8)
    pub verified_at: String,  // RFC3339 UTC
}

/// Pure verification. No I/O, no state. This is the tested core.
pub fn verify_license(token: &str) -> LicenseVerdict;

#[tauri::command] pub fn license_verify(token: String) -> LicenseVerdict;
/// Reads `licenseKey` from settings.json, verifies, writes the verdict file. Returns the verdict.
#[tauri::command] pub fn license_publish_verdict() -> Result<LicenseVerdict, String>;
```

Rules the implementation MUST honour:

- `key_fp` is computed by hashing the key's **base64 BODY**, never the raw file bytes.
  **This rule was originally written the other way round and was wrong.** Hashing raw bytes makes
  the fingerprint depend on the checkout's line endings: the PEM is stored with LF and
  `core.autocrlf=true` (Git-for-Windows default) rewrites it to CRLF on checkout, while Rust bakes
  the bytes in at COMPILE time and the TS constant is generated from the WORKING TREE. The two
  sides then hashed different bytes and every valid licence was refused — measured, not theorised:
  LF → `f731c49c…`, CRLF → `69f5fa5a…` for the same key. The base64 body IS the key material and
  carries no line endings, so both languages agree by construction. Current value:
  `43036aa6496ca675`. `.gitattributes` additionally marks these files `-text` so the bytes on disk
  match the repository, but correctness must not depend on that.
- Verification MUST reject: malformed tokens, non-64-byte signatures, signatures that do not
  verify, payloads that are not JSON, `plan != "pro"`, and `exp` in the past.
- No `unwrap()` on attacker-controlled input; no panics on any input, including empty string.
- `license_publish_verdict` reads the `licenseKey` field the Node side writes. Values are stored
  with a prefix: `enc:<b64>` (DPAPI), `aes:<b64>` (standalone file cipher), `plain:<text>`,
  or bare legacy plaintext. Rust decrypts `enc:` with its existing `dpapi_decrypt`, and `aes:`
  with the file cipher (`DATA_DIR/secret.key`, hex → AES-256-GCM over `iv‖tag‖ciphertext`).
  **The `aes:` branch must actually decrypt.** The first implementation returned
  `UNREADABLE_STORAGE` for every `aes:` value, and since `setSecretCipher` is never called
  anywhere in `src/` (measured: zero call sites), `aes:` is the ONLY format a packaged build ever
  writes — so that shortcut denied Pro to every paying user. An unreadable value still yields
  `UNREADABLE_STORAGE`, but only after a real decryption attempt fails.
- Absence of a stored licence MUST yield `valid:false`, not an error.
- `license_publish_verdict` MUST be invoked. It is called once from the Tauri shell after the
  sidecar starts (`src-tauri/src/main.rs`) and again from the licence UI after activate/deactivate.
  Nothing calling it was the second measured defect: without it the verdict file never exists, and
  a packaged build refuses Pro no matter how valid the licence is.

## §D. Verdict file — the Node↔Rust channel

**Why a file:** the shell spawns the Node backend as a separate process with environment
variables only (`src-tauri/src/sidecar.rs:225-268`); there is no IPC socket to use. A file next to
`settings.json` is the one channel both processes already share.

Path: `<settings_dir>/license-verdict.json` — the same directory as `settings.json`.
Writer: Ticket A (Rust). Reader: Ticket B (Node). Never written by Node.

Node's rule, applied **only when `ANTIDETECT_PACKAGED=1`**:

```
Pro is granted  ⟺  JS signature verification passes
                AND verdict file exists, parses, schema === 1
                AND verdict.valid === true
                AND verdict.key_fp === local pinned key fingerprint
                AND verdict.token_fp === sha256(stored token).slice(0,16)
```

Every clause is deny-only. A missing or stale verdict **denies Pro and MUST NOT break the app**:
Free keeps working, profiles keep working, and the licence UI still reports what it can see.
Outside a packaged build (`npm run service`, tests, CI) the verdict file is ignored entirely
and the existing pure-Ed25519 path is authoritative — otherwise every test and the standalone
service would fail the moment it ran without the shell.

## §E. TypeScript surface — `src/main/licensing/licenseManager.ts`

Owner: **Ticket B**. Existing exports MUST keep working; one signature is widened.

```ts
/** WIDENED: optional key injection. Callers that pass nothing keep today's behaviour. */
export function validateLicenseKey(
  key: string,
  publicKeyPem?: string,
): LicenseValidationResult;

/** UNCHANGED signatures — routes/teams.ts, routes/sync.ts, the renderer depend on these. */
export function activateLicense(key: string): { ok: boolean; error?: string; state?: LicenseState };
export function deactivateLicense(): void;
export function getLicenseState(): LicenseState;
export function hasFeature(feature: 'teams' | 'sync'): boolean;
export function isPro(): boolean;
export function signLicensePayload(payload: LicensePayload, privateKeyPem: string): string;

/** NEW: fingerprint of the pinned key, in the exact form Rust publishes. */
export function getPinnedKeyFingerprint(): string;
```

`LicenseState` MUST NOT change shape — the renderer reads `plan`/`email`/`exp`/`expired`
(`renderer/src/pages/LicenseSettings.tsx`, `SyncSettings.tsx`). Adding optional fields is fine;
removing or renaming is a breaking change and is forbidden.

The widened parameter exists so tests can sign with a throwaway keypair instead of a committed
private key, and so the "old leaked key is refused" regression can be written honestly.

## §F. Legal documents — Ticket C

| File | Requirement |
|---|---|
| `LICENSE` | Verbatim AGPL-3.0. Fetched from `https://www.gnu.org/licenses/agpl-3.0.txt`, not reproduced from memory — a paraphrase is not a licence |
| `LICENSE.COMMERCIAL` | Commercial alternative: who to contact, what it grants (closed-source use, no network-source obligation), no price invented |
| `TRADEMARK.md` | Forks may keep the code; the name "NullTrace", the logo (`assets/brand/*`), and the bundle identifier `com.antidetect.browser` may not be carried into a redistributed build without a full rebrand |
| `CLA.md` | Grants the operator the rights required to keep dual licensing lawful — the specific reason a CLA is needed here, not boilerplate |
| `.github/workflows/cla.yml` | Uses `contributor-assistant/github-action@v2.6.1`; no invented secrets — the app-id/private-key secrets are named and left for the operator |
| `README.md` | A Licence section linking all of the above + a one-paragraph fork policy |
| `docs/LICENSING.md` | Operator runbook: generate → rotate → issue → revoke, with the exact commands |
| `docs/GIT_HISTORY_REWRITE.md` | Rehearsed runbook for R11 |

The AGPL/CLA documents MUST NOT claim the operator is an incorporated entity, MUST NOT invent a
company address, jurisdiction, or price. Unknown values are marked `REPLACE-ME` — a placeholder
the operator fills, never an invented fact.

## §G. Ownership map — one writer per file

| Ticket | Files (exclusive) |
|---|---|
| A (Rust) | `src-tauri/src/license.rs`, `src-tauri/src/main.rs` (registration lines only) |
| B (Node/TS) | `src/main/licensing/licenseManager.ts`, `src/main/licensing/publicKey.ts`, `tests/unit/licenseManager.test.ts`, `scripts/make-license.mjs`, `scripts/sync-license-key.mjs`, `resources/license-public-key.pem` (read-only) |
| C (Legal/docs) | `LICENSE`, `LICENSE.COMMERCIAL`, `TRADEMARK.md`, `CLA.md`, `.github/workflows/cla.yml`, `README.md`, `docs/LICENSING.md`, `docs/GIT_HISTORY_REWRITE.md` |
| Orchestrator | `openspec/**`, `.workflow/**`, git |

**`src-tauri/src/main.rs` carries +160 uncommitted operator lines** (taskbar icon work). Ticket A
MUST add exactly two things — the `mod license;` declaration and two entries in
`generate_handler!` — and MUST NOT reformat, reorder, or revert anything else in that file.

## §H. Non-negotiables for every ticket

- No new external dependency. `ed25519-dalek` and `node:crypto` are already present.
- No `outputSchema` in any `task()` call.
- The test suite is **not** to be run by ticket agents; the orchestrator runs it once, after the
  wave merges. Baseline: 145 files / 1174 passed / 6 skipped. A later run with fewer passing
  tests is a regression even if it is green.
- Secrets: never commit a private key, never print one, never paste one into a prompt.
