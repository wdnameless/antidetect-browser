# Recon — "Installed" for an extension that was never installed

Operator: the Extensions page reported an install, the extension was not there, and the folder was
`D:\progg\NULLTRACE\extensions\…` (a different machine). Second request: move the Devices and
Extensions tabs into the left menu, under LIBRARY.

## Root causes (all four proven)

### 1. Every Web Store install failed — Chrome changed its update protocol

`fetchCrx` requested
`https://clients2.google.com/service/update2/crx?prodversion=…&x=id%3D<id>%26uc` and returned the
response body as the archive. That endpoint now answers with an **Omaha update manifest**:
`Content-Type: text/xml`, 792 bytes, naming a `codebase` URL, `size` and `hash_sha256`.

Measured:

| Check | Result |
|---|---|
| update-service response | HTTP 200, `text/xml`, 792 bytes, starts `<?xml` |
| the `codebase` URL | HTTP 200, `application/x-chrome-extension`, 1 116 206 bytes, starts `Cr24` |
| `hash_sha256` from the XML vs the downloaded file | **identical** (`f06b2674…`) |

So the archive was always one indirection away, and the header check saw XML:
`[BAD_SIGNATURE] Invalid CRX magic header: <?xm`.

### 2. The failure was rendered as success

`Extensions.tsx` checks `res.code` for import, delete and toggle — but not for the Web Store
install. A refusal is sent as `res.status(400).json({code:-1,…})`, and the client's `request()`
returns that envelope instead of throwing, so the `catch` never ran and the success line printed
with empty values: `Installed "" (v)`. The empty quotes were the symptom.

### 3. Re-installing duplicated the extension

`unpackCrx` writes to `extensions/<store-id>/<version>`, then `registerUnpacked` called
`importExtension`, which **copies** into a fresh `ext_<uuid>`. The recorded path therefore never
contained the store id, and both idempotency checks (`registerUnpacked` and `installFromWebStore`)
match on the store id being in that path — so neither could ever fire. Observed twice on disk:
`ext_090e45f9-…` and `ojfebgpkimhlhcblbalbfjblapadhbol`.

### 4. Binding to a profile failed with a database error

`POST /api/v1/browser-profile/extensions/bind` ran
`SELECT userDataDir FROM profiles WHERE id = ?`. `profiles` has no `userDataDir` column — the
workspace path is derived (`path.join(PROFILES_DIR, id)`). The route answered
`no such column: userDataDir` **after** `bindExtensions` had already written the row, so the UI
showed failure and the extension was never injected into the profile's preferences.

## Files touched

| File | Change |
|---|---|
| `src/main/extensions/webstore.ts` | parse the update manifest; fetch from `codebase`; verify `hash_sha256`; register the unpacked directory in place instead of copying it |
| `src/main/extensions/extensionManager.ts` | new `registerExtensionDir(name, dirPath)` — registers files where they already are |
| `src/main/api/routes/extensions.ts` | derive the profile workspace from its id instead of querying a column that does not exist |
| `src/renderer/src/pages/Extensions.tsx` | check `code` before reporting an install |
| `src/renderer/src/App.tsx` | Devices and Extensions become sidebar destinations in LIBRARY |
| `tests/unit/extensions/webstore.test.ts` | 3 new cases for the manifest path, digest check and unavailable status |
| `tests/unit/shellGroups.test.ts` | the nav-count guard updated from seven to eight, with the reason |

## Acceptance check (executed on the operator's machine)

| Check | Result |
|---|---|
| Install the reported URL | `{"name":"EditThisCookie (V3)","version":"3.0.5"}` |
| Second install | `reused: true`, library holds **1**, one directory on disk (125 files) |
| Bind to a profile | `{"code":0,"data":{"bound":[…]}}`; the profile reports the id |
| Launch that profile | `--load-extension=…\extensions\ojfebgpkimhlhcblbalbfjblapadhbol\3.0.5,…` |
| A URL that cannot work | `NOT_FOUND … status "error-unknownApplication"` — reported as an error |
| Sidebar | LIBRARY shows Devices and Extensions as destinations; the content pills are gone |
| The new tests fail on the old behaviour | 3 of the extension tests |
| No regressions | vitest 138 files / 1135 passed; typecheck clean |

## Notes

- A launcher must be rebuilt to change the payload: the portable `.exe` re-extracts its files on
  every run, so editing the extracted folder has no effect. That cost a cycle here — the first
  "fixed" copy was silently replaced at the next launch.
- The intermediate `extensions/<store-id>/<version>` directory is what the idempotency check reads,
  so it is kept rather than treated as leftover.
