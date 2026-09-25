# Blind acceptance — release 0.6.46

Reviewer given only the brief for the one change made after the 0.6.45 acceptance, told not to read
the author's acceptance files. Its task was explicitly to try to falsify the change.

## Verdict: ACCEPT — defects: none, uncertain: none

## What it checked

| Check | Result |
|---|---|
| The clone writes the **destination** fingerprint row, not the source's | Confirmed against `git show v0.6.46:src/main/profiles/profileManager.ts` |
| **Shared-state falsification** — do source and clone end up on the same fingerprint row? | Ran a script in a temp data dir: **distinct profile ids and distinct fingerprint ids**; mutating the clone's fingerprint leaves the source untouched |
| **Coherence falsification** — does copying config without re-deriving produce an incoherent pair? | Copying both `seed` and `config_json` preserves the source's hardware vector and the operator's overrides with no seed/config drift |
| Profile isolation | Clone gets its own profile id, its own `userDataDir`, and a fresh (null) `cookies_json` |
| Tests | `fieldPersistence.test.ts` + `bulkFingerprint.test.ts`: 15 passed |

## Independently reproduced by the author

The shared-state risk was the one that mattered — a clone pointing at the source's fingerprint row
would mean editing one profile silently changed the other. Checked separately before the reviewer
reported: two distinct `fingerprint_id` values, and editing the clone's language left the source's
untouched (`src.lang=pt-BR` while `clone.lang=ja-JP`). Both of us reached the same conclusion from
different directions.

## Why this acceptance was run separately

The previous verdict covered 0.6.45. The workflow's staleness check correctly refused to close the
lane because five tracked files changed afterwards — the version carriers plus the changelog, and one
real code change (`duplicateProfile`). Rather than force the close with a written reason, the change
was re-reviewed on its own merits, which is what caught the defect in the first place.
