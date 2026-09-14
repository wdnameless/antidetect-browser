## Why

The user selected Google Drive sync (`google sync`) as an in-scope capability, with a
**user-supplied OAuth client** rather than one we own. Reconnaissance established two
facts that shape the work:

1. **There is already a cloud path, and it is not Google.** `src/main/api/routes/cloud.ts`
   exposes `state` / `connect` / `setup` / `login` / `disconnect` / `sessions` /
   `remote-list` / `push` / `pull`, all against our own sync-server via
   `src/main/teams/syncClient.ts`. That path must keep working untouched; Drive is
   additive, not a replacement.
2. **The operator's own OAuth client is a deliberate constraint.** We do not register a
   client, do not ship a client secret, and do not run a consent screen. The operator
   creates a Google Cloud project, enables the Drive API, and pastes a client id. That
   removes the need for Google verification and any hosted redirect we would have to
   maintain — at the cost of a setup step the operator performs once.

## What Changes

- **Drive authentication with the operator's client id.** A device-code / installed-app
  flow that returns a refresh token, stored through the existing secret store — never in
  `settings.json`, never in a log, never in the sync payload.
- **Push and pull** of profiles, scripts and settings into a folder in the operator's
  Drive, alongside a state record so a second machine can tell what changed.
- **A Drive section** in the existing Cloud Sync page, distinct from the self-hosted
  path so an operator can see which one is configured.
- **Opt-in.** Nothing uploads until a client id is configured and the operator connects.

## Capabilities

### New Capabilities
- `gdrive-sync`: operator-owned OAuth, Drive-backed push/pull of profiles, scripts and settings.

### Modified Capabilities

None — the existing self-hosted sync is untouched (R85i).

## Impact

- New `src/main/cloud/drive.ts`, additions to `src/main/api/routes/cloud.ts`,
  `src/renderer/src/pages/CloudSync.tsx`, `src/renderer/src/api.ts`, i18n.
- Tests: OAuth flow with a stubbed transport, token redaction, round-trip push/pull,
  and a guard that no client secret or token reaches a log or a payload.

### Goals

- The operator's Drive becomes a real backup and multi-device path, using their own client.
- No credential we own, none embedded, none logged.
- The existing self-hosted sync keeps working.

### Non-Goals

- No OAuth client owned or hosted by us — that decision was explicitly the other way.
- No Google verification process, no hosted redirect endpoint.
- No Drive app-data folder trickery that would require special scopes.
- No change to the self-hosted sync-server or teams/RBAC.

### Risks and commitments

- **The operator carries the setup cost.** Creating a Cloud project and enabling an API
  is not a one-click experience. This is the accepted price of R81, and the UI must
  explain the steps rather than leaving the operator to discover them.
- **Google's OAuth policies change.** A future policy change could break an
  installed-app flow. The failure must be legible, not a silent stall.
- **Token handling is the security surface.** A refresh token grants access to a folder
  in the operator's Drive. It goes in the secret store, is never logged, and is
  redacted from any diagnostic output — with a test asserting it.
