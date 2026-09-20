# Recon — the other machine never saw the new version

Operator: «почему на другом компе не пришла новая версия после того как я чекнул» — the machine
still runs **0.6.10** with the footer reading *Up to date*.

## Root cause (proven)

**Nothing was ever published.** The updater resolves
`https://github.com/wdnameless/antidetect-browser/releases/latest/download/latest.json`; that file
answered `"version": "0.6.10"` — the version already installed, so "up to date" was a correct answer
to a stale question.

- `git log --oneline origin/main..HEAD` listed **11 unpushed commits** — every fix from 0.6.11
  through 0.6.13, including this session's work, existed only on this machine.
- `git tag --sort=-creatordate | head -1` → `v0.6.10`. No tag had been pushed since.
- The CI release job is gated `if: startsWith(github.ref, 'refs/tags/v')`, so a `main` push can
  never publish: it runs the tests and skips the release.

So the signing key, the manifest builder and the CI secrets were all fine — the release simply did
not exist to be found. The earlier diagnostics section in `docs/RELEASE.md` explained signature
failures in detail and never considered "you did not push".

## Verified before publishing (so the tag was not wasted)

| Check | Result |
|---|---|
| CI on `main` green | `test` + both SDK jobs success; release job correctly *skipped* |
| Version consistent | `package.json`, `tauri.conf.json`, `Cargo.toml` all `0.6.13` |
| `plugins.updater.pubkey` matches the local key | both decode to minisign key id `7FDDA4EFF823F429` |
| The 0.6.10 release was signed by that same key | its published signature carries the same id — so the CI secret holds a key this app trusts |

## Result of publishing `v0.6.13`

- `latest.json` now answers `"version": "0.6.13"` with entries for `windows-x86_64-setup`,
  `windows-x86_64` and `windows-x86_64-portable` — the portable entry is what the operator's build
  needs.
- Release published, **not** a draft, **not** a prerelease, and `Latest`.
- Assets: installer, portable `.exe`, `latest.json`, and a `.sig` for each.
- The portable artefact downloads (`302` → `200`, 48 732 543 bytes).

## Files touched

| File | Change |
|---|---|
| `scripts/verify-release-signature.cjs` | new — verifies a published artefact against the key in `tauri.conf.json` using Node's own Ed25519, independent of the tool that signed it |
| `docs/RELEASE.md` | new first section: the unpushed-commit case, with the two commands that detect it, and the correct release order |

## Acceptance check (executed)

| Check | Evidence |
|---|---|
| The artefact is signed by the key the app trusts | downloaded the published `.exe` + `.sig` and verified: `RESULT: VALID` |
| The script works from its shipped location | re-ran it as `node scripts/verify-release-signature.cjs …` → `VALID`, exit 0 |
| The updater now offers the new version | live `latest.json` → `version: 0.6.13` |
| No regressions | typecheck clean; CI green on `main` and on the tag |

## Note for the next release

`v0.6.14` will be needed for any further change: the updater compares versions, and a release whose
version equals the installed one is reported as "up to date" no matter how different its contents
are. The build script already refuses to package a launcher whose embedded shell version disagrees
with its name, which is what caught the same class of mistake once before.
