## Why

ShardX reads and writes Chromium's `Cookies` SQLite database directly, including Windows DPAPI + AES-GCM (v10) decryption — the import path that operators actually use when migrating real logged-in sessions. Our cookie I/O covers only Netscape cookies.txt plus CDP setCookies; real Chromium cookie stores can't be imported at rest.

## What Changes

- `src/main/cookies/sqlite.ts`: read a Chromium Cookies DB (raw cookie rows with name/host/path/expires/http_only/secure/same_site), write back with the profile's encrypted schema (v10 prefix + AES-256-GCM with the profile's OS key) when the target is a live profile dir; DPAPI unwrap on Windows for the OS key extraction.
- `POST /api/v1/cookies/import-sqlite` — merge a source Cookies DB into a profile's cookie store (duplicate on name+host+path upserts, not blind insert).
- `POST /api/v1/cookies/export-sqlite` — export a profile's Cookies DB to a target file path (both plaintext Netscape and v10-encrypted forms).

## Capabilities

### New Capabilities
- `cookie-sqlite-io`: Chromium Cookies DB read/write, v10 AES-GCM decrypt/encrypt, DPAPI unwrap, merge semantics.

## Impact

- `src/main/cookies/sqlite.ts` (new), `src/main/api/routes/cookies.ts` (two routes), tests in `tests/unit/cookieSqlite.test.ts` with fixture DBs (buildable via sql.js).