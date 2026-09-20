# Recon — release 0.6.3 (icon + MCP fixes) with working updater signing

Lane T1. Goal: publish the two fixes already in the tree, with a **valid** `latest.json`, and
download the artefacts to the Desktop.

## Why auto-update never worked

`gh run view 35051848430` (the v0.6.2 release job) fails in `Build updater manifest` with:

    incorrect updater private key password: Wrong password for that key

So the step degraded (by design) and `latest.json` was never published. Evidence — the v0.6.2
release carries **only two assets**:

    NullTrace-0.6.2-portable-win-x64.exe   48686969
    NullTrace_0.6.2_x64-setup.exe          33085981

No `latest.json`, no `.sig`. The updater endpoint resolves
`releases/latest/download/latest.json`, which 404s → the app reports "not configured". The
`v0.6.1` release run also failed; the failure is not new.

## The key and password are good — proven, not assumed

- `C:\Users\Administrator\.tauri\nulltrace.key` (+ `.key.pub`) exists, created 2026-09-16.
- `npx tauri signer sign -f <key> <setup.exe>` with `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  succeeded and produced `test.exe.sig`.
- `cargo run --example verify_minisign -- <pubkey-from-tauri.conf.json> <sig> <artifact>`
  prints **`SIGNATURE VALID`** — the private key matches the public key embedded in
  `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`, minisign `29F423F8EFA4DD7F`).
- Therefore only the CI secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is wrong; the key and the
  password the user supplied are consistent. `gh` has the `repo` + `workflow` scopes, so the
  secret can be corrected with `gh secret set`.

## What ships

- `src-tauri/windows/portable.nsi` — `Icon "${ICONPATH}"`
- `scripts/build-portable.mjs` — icon-path substitution + presence check
- `src-tauri/tauri.conf.json` — `nsis.installerIcon` / `nsis.uninstallerIcon`
- `tests/unit/portableTargets.test.ts` — regression guard (proven red on HEAD, green after)
- `CHANGELOG.md` — the 0.6.2 defects and their fix

## Acceptance check

1. CI release job on tag `v0.6.3` publishes `latest.json` + `.sig` alongside both `.exe`.
2. `latest.json.signature` verifies against the embedded pubkey (same `verify_minisign`).
3. Both artefacts on the Desktop; launcher icon frames byte-identical to `icon.ico`.
4. Bumping the version also clears the already-extracted
   `%LOCALAPPDATA%\NullTrace\portable\0.6.2` directory (portable extracts per version), so the
   running app is actually replaced rather than overwritten in place.
