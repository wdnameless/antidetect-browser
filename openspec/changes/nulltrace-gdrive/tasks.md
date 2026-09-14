# Tasks — nulltrace-gdrive

Order: credentials → auth → transfer → UI → verification.
Suite stays green (119 files / 945 tests) and typecheck clean throughout.

## 1. Credentials (the security-critical part — do it first)

- [x] 1.1 The operator supplies a **client id** (and secret if their client type needs
      one) through settings. Validate the shape; store through the existing secret store
      (`src/main/util/secretStore.ts`), **not** in `settings.json`.
- [x] 1.2 Never log, echo, or include a client secret or a refresh token in any
      response, diagnostic, or sync payload. Add a test that asserts redaction.
- [x] 1.3 A guard test: no OAuth client id/secret is embedded in the repository, and
      nothing under `src/main/cloud/` contains a literal that looks like one.

## 2. Authentication

- [x] 2.1 OAuth flow using the operator's client, with an **injectable transport** so
      the flow is tested without network. Prefer an installed-app / device-code flow —
      choose one and say which in CONCERNS.
- [x] 2.2 Store the refresh token in the secret store; refresh access tokens as needed.
- [x] 2.3 `disconnect` clears the stored token and stops any further upload.
- [x] 2.4 Failures are legible: an expired grant, a revoked client, or a missing Drive
      scope must each report something the operator can act on, not a bare error.

## 3. Transfer

- [x] 3.1 Create and locate a folder in the operator's Drive. Store its id so a second
      machine finds the same one rather than creating duplicates.
- [x] 3.2 Push: profiles, scripts and settings, as the same bundle shape the existing
      export path produces — reuse it rather than inventing a second serialisation.
- [x] 3.3 Pull: fetch what is remote, report what changed, and apply only on request or
      on an explicit conflict rule. **Never silently overwrite local data.**
- [x] 3.4 State: a record of what was pushed and when, so push/pull can tell what moved.
- [x] 3.5 The existing self-hosted path must remain selectable and unaffected (R85i).

## 4. UI

- [x] 4.1 A Drive section in `CloudSync.tsx`, visually distinct from the self-hosted
      one so the operator can see which is configured.
- [x] 4.2 The operator-facing explanation of the setup steps (create a Cloud project,
      enable the Drive API, paste the client id) — this is the accepted cost of R81 and
      must be written out, not discovered.
- [x] 4.3 Status: connected or not, last push, last pull. **Distinguishable without
      colour** (the palette carries none).
- [x] 4.4 i18n for every new string, both `en` and `ru`.

## 5. Verification

- [x] 5.1 Tests: the OAuth flow against a stubbed transport; token redaction; folder
      reuse across two "machines"; a push/pull round trip; and that a pull does not
      overwrite local data without an explicit rule.
- [x] 5.2 Full suite green, typecheck clean.
- [x] 5.3 **Look at it.** The Cloud Sync page with the Drive section renders and its
      states are distinguishable without hue.
- [x] 5.4 CHANGELOG entry; README documents the operator setup steps.
- [x] 5.5 Record plainly that this cannot be verified against real Google without an
      operator's own client — state it as a limitation, do not imply it was tested live.

## 6. Deferred (recorded, not scheduled)

- [ ] 6.1 An OAuth client owned by us with Google verification — explicitly declined (R81).
- [ ] 6.2 Scheduled/automatic sync — this wave is operator-triggered.
