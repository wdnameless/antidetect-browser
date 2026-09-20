# Tasks — licensing-and-fork-protection

Wave 3 execution plan. One writer per file block; see `interfaces.md` §G for the ownership map.

## 1. Key rotation — the load-bearing change (Ticket B)

- [ ] 1.1 Generate the new vendor keypair; private half outside the repository, public half at
      `resources/license-public-key.pem` (done by orchestrator; fp `43036aa6496ca675`).
- [ ] 1.2 Write `scripts/sync-license-key.mjs`: regenerates `src/main/licensing/publicKey.ts` from
      the PEM, so the key is never hand-copied between languages.
- [ ] 1.3 Regenerate `publicKey.ts` from the new PEM.
- [ ] 1.4 Add a drift test: the generated constant MUST equal the PEM on disk. Failure mode it
      guards: rotate the PEM, forget to regenerate, ship a build that rejects every valid licence.
- [ ] 1.5 Remove the committed private key from `tests/unit/licenseManager.test.ts`; the test
      generates a throwaway keypair at runtime via `validateLicenseKey(key, testPublicKeyPem)`.
- [ ] 1.6 Add the regression that R13i exists for: a licence signed with the **old leaked**
      private key MUST be refused. Asserted against a literal of its public half, so the test
      fails loudly if the old key ever verifies again.

## 2. Rust verification (Ticket A)

- [ ] 2.1 `src-tauri/src/license.rs`: `LicenseVerdict`, `verify_license`, base64url decode without
      a new dependency, `include_str!` of the PEM.
- [ ] 2.2 `license_verify` and `license_publish_verdict` Tauri commands.
- [ ] 2.3 Verdict file written to `<settings_dir>/license-verdict.json`, matching `interfaces.md` §D.
- [ ] 2.4 Unit tests: valid, tampered payload, foreign key, malformed, expired, wrong plan, empty
      string, non-64-byte signature. `reason` values asserted, not just `valid == false`.
- [ ] 2.5 Register the commands in `main.rs` — two lines only, around the operator's uncommitted work.

## 3. Node-side integration (Ticket B)

- [ ] 3.1 Widen `validateLicenseKey(key, publicKeyPem?)`; existing call sites unchanged.
- [ ] 3.2 `getPinnedKeyFingerprint()` returning sha256 of the PEM, first 16 hex chars.
- [ ] 3.3 Packaged cross-check in `getLicenseState()`: when `ANTIDETECT_PACKAGED=1`, require the
      verdict file to exist, parse, agree on `key_fp` and `token_fp`, and be valid. Deny-only.
- [ ] 3.4 Prove the packaged path does not break the app: missing/garbage/stale verdict ⇒ Pro
      denied, Free fully functional, no throw.
- [ ] 3.5 Extend `scripts/make-license.mjs`: `new` (generate a keypair) and `rotate` (report the
      new fingerprint, refuse to run while the pinned key still matches the leaked one).

## 4. Legal surface (Ticket C)

- [ ] 4.1 `LICENSE` — verbatim AGPL-3.0 fetched from gnu.org.
- [ ] 4.2 `LICENSE.COMMERCIAL`, `TRADEMARK.md`, `CLA.md`, `.github/workflows/cla.yml`.
- [ ] 4.3 `README.md` licence section + fork policy.
- [ ] 4.4 `docs/LICENSING.md` operator runbook.
- [ ] 4.5 `docs/GIT_HISTORY_REWRITE.md` — rehearsed on a mirror clone.

## 5. Verification (orchestrator + Oracle)

- [ ] 5.1 `npm test` — must not fall below 145 files / 1174 passed.
- [ ] 5.2 `cargo test` in `src-tauri` — new licence tests present and passing.
- [ ] 5.3 End-to-end: sign with the new key → accepted. Sign with the leaked key → refused.
      Both executed, not read.
- [ ] 5.4 Secrets sweep over tracked files: zero private-key hits.
- [ ] 5.5 Oracle blind acceptance against `manifest.md`, not against this plan.

## Deferred, with the operator's own words (R10, R12)

- Licensing/activation server, heartbeat, device limits — R09 chose signature-only.
- Payment integration: Telegram bot + Stars/crypto — recorded as R12 for the later wave.
- The actual `git push --force` after the rewrite: the operator's call, not a subagent's.
