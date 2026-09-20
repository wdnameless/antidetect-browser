# Recon — groups could be created but never shown

Operator report: «группы не создаются», with the Profile Groups modal reading *No custom groups
created yet*.

## Root cause (proven, not inferred)

The groups **were** being created. Against the live app:

- `POST /api/v1/group/create` with `{"name":"TikTok Farm"}` answered
  `{"code":0,"msg":"success","data":{"group_id":"g_e5d72d62-…"}}`.
- The operator's database already held four rows: `openframe`, `asd`, `asd`, `TikTok Farm`.

What failed was the **list**: `GET /api/v1/group/list` answered
`{"code":-1,"msg":"no such column: g.bookmarks"}`.

`listGroups` (`src/main/profiles/profileManager.ts:1292`) selects `g.bookmarks`; `updateGroup`
(`:1272`) writes it; the `groups` table had columns `id, name, created_at` only. So the write
succeeded, the refresh that would have shown it threw, and the modal fell back to its empty
state. That is exactly what the operator saw.

## Why the column was missing

The migration existed and was deleted:

```
362d33d  +  ensureColumn(db, 'groups', 'bookmarks', 'TEXT');
5f874f8  -  ensureColumn(db, 'groups', 'bookmarks', 'TEXT');
         +  // Extra per-profile Chromium launch args
         +  ensureColumn(db, 'profiles', 'launch_args', 'TEXT');
```

`5f874f8` landed thirteen minutes after `362d33d` and **replaced** that line with its own
migration rather than adding a line after it. `CREATE TABLE IF NOT EXISTS` does not alter an
existing table, so every database created before that thirteen-minute window kept a `groups`
table without `bookmarks` while the code went on selecting it. Fresh databases were fine, which
is why no test caught it — the test database is created from scratch every run.

## Files touched

| File | Change |
|---|---|
| `src/main/db/schema.ts` | restored `ensureColumn(db, 'groups', 'bookmarks', 'TEXT')` with a comment naming how it vanished; added `bookmarks TEXT` to the `CREATE TABLE` so new databases have it from the start |
| `tests/unit/schemaColumns.test.ts` | new — checks every column the core queries name exists after migration |

## Acceptance check (executed)

| Check | Result |
|---|---|
| The operator's database gains the column | before `id, name, created_at` → after `id, name, created_at, bookmarks` |
| The list query that used to fail | `{"code":0,...}` with all groups |
| Creating a group as the modal does | `{"code":0,"data":{"group_id":"g_cf849107-…"}}` |
| It appears in the list | 5 groups, including the new `Operator Group Test` |
| The live modal | renders `Operator Group Test`, `TikTok Farm`, `asd`, `openframe`; `No custom groups created yet` is gone |
| The test fails on the shipped behaviour | removing the migration again → 3 failed |
| No regressions | `npx vitest run` 137 files / 1128 passed; typecheck clean |

## Note on the operator's data

`D:/NULLTRACE/antidetect.db` was backed up to `antidetect.db.pre-bookmarks-migration` before the
migration ran, because it is their real profile database and the fix alters its schema.
