# Recon — groups created correctly? (verification)

Operator: «Проверь что группы корректно создаются».

Scope: verify the whole group lifecycle, not only that a row appears. Verified against the live
app on 0.6.13 (`http://127.0.0.1:50325`, data dir `D:/NULLTRACE`), driving both the HTTP API and
the real UI in a browser.

## Files touched

None — this was a verification pass. Everything checked is already committed (`21ee38c`, `6180fc9`).

## Results — 24 checks, all passed

| # | Check | Result |
|---|---|---|
| 1 | Create returns an id, `g_`-prefixed | PASS |
| 2 | The new group is visible in the list — *the failure that shipped* | PASS |
| 3 | `name` stored verbatim, `created_at` a plausible ms timestamp, `profile_count` 0, `bookmarks` null | PASS |
| 4 | Rejects empty / missing / numeric / null name | PASS — all four refused with `code: -1` |
| 5 | Cyrillic, emoji, quotes, 200 chars, leading/trailing spaces round-trip exactly | PASS |
| 6 | Duplicate names allowed, each with its own id | PASS |
| 7 | Bulk-assign profiles to a group | PASS — `profile_count` became 2 |
| 8 | Filter profiles by group | PASS — exactly the assigned two, and no others |
| 9 | Rename keeps membership | PASS — count stayed 2 |
| 10 | Unassign one profile | PASS — count dropped to 1 |
| 11 | Delete a group | PASS — group gone, profiles survive, their `group_id` cleared to null (no dangling reference) |
| 12 | Persistence across an app restart | PASS — same three groups before and after; `groups` columns still `id, name, created_at, bookmarks`, so the migration is idempotent |
| 13 | Create **through the UI** | PASS — typed into the form, clicked *Create Group*, the row appeared and the empty-state message disappeared |
| 14 | The Profiles page group filter lists every group | PASS |
| 15 | Filter reflects live membership | PASS — after assigning one profile the filter read `ZZ UI Created Group (1)` and the profile row showed that group |

## One thing to say plainly

The operator's own three profiles are in the **Trash** (`deleted_at` set, ~83 minutes before this
pass). That is why the first assignment attempt could not run: `bulk-group` refuses an empty list,
and there were no visible profiles to assign. Nothing about groups caused it, and the API behaved
correctly. It is worth telling the operator, because the Profiles page currently shows zero
profiles and that looks like a second bug.

Their own groups — `asd`, `asd`, `openframe` — are present and correct. The two `asd` entries are
duplicates from their earlier attempts, visible now that the list works.

## Cleanup performed

Verification created fixtures, and all of them were removed:

- two throwaway profiles (`ZZ GroupFixture A/B`) → moved to Trash, then purged
- the two groups created while testing (`ZZ Verify Group`, `ZZ UI Created Group`) → deleted

Left untouched: `asd`, `asd`, `openframe`, and the operator's own profiles.
