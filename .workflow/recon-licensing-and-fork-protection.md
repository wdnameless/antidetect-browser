# Recon — licensing-and-fork-protection

Wave 1 reconnaissance. Every claim here was executed, not read.

## 1. What the repository already has

Inventory before design; reuse > extend > create.

| Asset | Path | State |
|---|---|---|
| Offline licence validation | `src/main/licensing/licenseManager.ts` (136 lines) | Working: Ed25519 over `<b64url payload>.<b64url sig>` |
| Pinned vendor public key | `src/main/licensing/publicKey.ts` (9 lines) | **Compromised** — see §2 |
| Issuance script | `scripts/make-license.mjs` (35 lines) | Working, needs `LICENSE_PRIVATE_KEY` |
| HTTP surface | `src/main/api/routes/licensing.ts` (35 lines) | `state` / `activate` / `deactivate` |
| Pro gate | `src/main/api/routes/teams.ts`, `.../sync.ts` | `hasFeature('teams'|'sync')` → else `LICENSE_REQUIRED` |
| Renderer UI | `renderer/src/pages/LicenseSettings.tsx`, `SyncSettings.tsx` | Activate/deactivate, plan display |
| Sync server | `server/` (zero-knowledge, ciphertext only) | Working, self-host |
| Release signing | `src-tauri/src/updater.rs` + `resources/release-keyring.json` | Separate key family, unaffected |

The Pro boundary the operator chose (R08 — «локально всё бесплатно, Pro = команды + синк»)
**already exists and works**. This wave hardens it; it does not invent it.

## 2. 🔴 The finding that outranks the rest of the plan

The private half of the vendor licence key is committed to a public repository.

- Location: `tests/unit/licenseManager.test.ts`, first commit `70e8bb7` (2026-08-28).
- Its public half is pinned in the shipped build at `src/main/licensing/publicKey.ts`.

Proof, executed (`display` output of the verification cell):

```
test_priv_public_half_b64 : MCowBQYDK2VwAyEAVxFPPO9Q0RRZZUYacTrT5OnBwit7GcyTpYR/ijc+tsA=
pinned_public_b64         : MCowBQYDK2VwAyEAVxFPPO9Q0RRZZUYacTrT5OnBwit7GcyTpYR/ijc+tsA=
bodies_identical          : true
FUNCTIONAL_PROOF_test_key_signs_licenses_the_shipped_app_accepts : true
```

Meaning: anyone with a clone can mint unlimited working Pro licences. The file's own comment
says so — «the private key below is for LOCAL DEVELOPMENT ONLY and must be rotated before public
release» — the rotation was planned and never performed.

An earlier comparison appeared to show two *different* keys; that was a CRLF artefact of naive
string comparison. Comparing normalized base64 bodies settled it: same key.

### Scale of a history rewrite (R11)

| Measure | Value |
|---|---|
| Commits from the leak to `HEAD` | **202** |
| Tags total | 54 |
| Tags containing the leak | **24** |
| Ref names (local + remote) | 14 |
| Distinct committing identities | 3 (one human: `good22067@gmail.com` under two names, + one noreply alias) |

`git filter-repo` is **not installed** (`git: 'filter-repo' is not a git command`;
`pip show git-filter-repo` → not found). Python 3.14.5rc1 is available.

Single author across all 238 commits and all 3 identities → **the operator can relicense alone**,
no third-party CLA is needed retroactively. This materially lowers the risk of R11.

## 3. The DPAPI channel is dead code

`setSecretCipher` is exported from `src/main/util/secretStore.ts` and documented as «the shell
injects the cipher», but a repo-wide search finds **zero call sites in `src/`**. The Rust commands
`secrets::secret_encrypt` / `secret_decrypt` exist and are registered in `main.rs`; nothing calls
them from the backend.

Consequence for this wave: `licenseManager.ts` stores the key via `protectSecret`, which falls
back to the `DATA_DIR/secret.key` file cipher, not DPAPI. The intended design (Rust holds the
envelope key, Node asks Rust) was never wired. That is the seam this wave needs — for licences,
the same channel that was supposed to carry secrets.

## 4. Integration constraint — how Rust and Node talk today

The shell spawns the Node backend as a sidecar process with environment variables
(`src-tauri/src/sidecar.rs`, block at lines 225–268): `API_PORT`, `API_HOST`,
`ANTIDETECT_SETTINGS_DIR`, `ANTIDETECT_APP_VERSION`, `ANTIDETECT_TARGET_RESOURCES_DIR`,
`NODE_PATH`, plus `ANTIDETECT_PACKAGED=1` / `NODE_ENV=production` in release builds.

There is **no IPC channel and no shared memory** — only environment variables and the filesystem.
`ANTIDETECT_PACKAGED` already exists and is the honest signal for «this is a packaged build»
(`isUnsignedDevAllowed()` in `src/main/security/enforcement.ts` relies on exactly that).
Any Rust→Node handoff must respect this: env vars + files, no assumed socket.

## 5. Files this wave touches

| File | Action |
|---|---|
| `LICENSE` | create — AGPL-3.0 (R07) |
| `LICENSE.COMMERCIAL` | create — dual-licence terms (R07) |
| `TRADEMARK.md` | create — brand policy, rebranding requirement for forks (R01) |
| `CLA.md` + `.github/workflows/cla.yml` | create — contributor terms (R01) |
| `tests/unit/licenseManager.test.ts` | edit — remove the committed private key, generate a throwaway pair in-test |
| `src/main/licensing/publicKey.ts` | edit — pin the NEW vendor public key (R13i) |
| `src-tauri/src/license.rs` | create — Rust verification (R10) |
| `src-tauri/src/main.rs` | edit — register the new command |
| `src/main/licensing/licenseManager.ts` | edit — consult Rust when packaged, fall back to pure Ed25519 otherwise |
| `scripts/make-license.mjs` | extend — new/rotate subcommands, refuse to run against a leaked key |
| `README.md` | edit — licence section, fork policy |
| `docs/LICENSING.md` | create — operator runbook: rotate, issue, revoke |
| `docs/GIT_HISTORY_REWRITE.md` | create — rehearsed runbook (R11) |

Not touched: `server/`, `mcp/`, `renderer/src/pages/LicenseSettings.tsx` (the UI already shows
plan + activation and needs no change for this wave).

## 6. The user has uncommitted work in flight

`git status` shows ~25 modified and 4 deleted files, plus untracked ones — icon regeneration,
`useColumnResize.ts`, deleted `Calendar.tsx`/`Catalog.tsx`, MCP/http-auth tests. `src-tauri/src/main.rs`
has +160 uncommitted lines (taskbar icon work). None of it overlaps this wave's files, **except**
`src-tauri/src/main.rs`, where the new command must be registered.

Handling: edit around the uncommitted hunk; never revert or reformat it.

## 7. Acceptance check (how this wave is judged)

1. Secrets sweep over tracked files: zero `-----BEGIN … PRIVATE KEY-----` hits.
2. A licence signed by the old (leaked) key → `validateLicenseKey` returns `{ok:false}`.
3. A licence signed by the new vendor key → `{ok:true}`; proven by execution.
4. Rust `verify_license` rejects a tampered payload and accepts a valid one (`cargo test`).
5. `npm test` green; test count not reduced (baseline to be captured before edits).
6. `LICENSE`, `TRADEMARK.md`, `CLA.md` referenced from `README.md`.
7. History-rewrite runbook rehearsed on a local mirror clone — leak absent from the clone's
   history; **the real force-push is left to the operator** (it invalidates 24 tags and every
   existing clone; that is the operator's call, not a subagent's).
