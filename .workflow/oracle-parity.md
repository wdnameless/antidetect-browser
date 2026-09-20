# Oracle verdict — ShardBrowser UI parity + shell fixes

Auditor: `@oracle` (blind — given the operator's verbatim words, never our spec).
Verdict: **ACCEPT**, all four gates true.

## What the oracle verified, independently

| Requirement | Its evidence | Verdict |
|---|---|---|
| Version in footer | Read the built bundle and `App.tsx`: state defaults to `__APP_VERSION__` (`0.6.7`), so `NullTrace v0.6.7` renders even when `/status` answers `unknown`; never a bare product name | PROVEN |
| Collapse | Read `sidebarLogic.ts`, `App.tsx`, `styles.css`; toggle reachable in both states; state persisted in `localStorage` across reloads | PROVEN |
| Transfer-all | Ran a REAL backend on its own port with isolated temp dirs: `/browser/list` 0 → `POST /data/transfer` `created: 2` → `/browser/list` 2. Found the UI control in `Settings.tsx` | PROVEN |
| UI parity | Compared `Profiles.tsx` metric row and card treatment against `D:/tmp/shardref`; verified the palette is strict monochrome Inter with the reference's blue `#535efd` **completely absent** | PROVEN |

Its concerns section: none blocking.

## Where I disagreed with the auditor — and checked

The oracle's narrative named two things imprecisely, so I re-verified both rather than
accepting the summary:

1. It wrote the metric cards are "Total, Active, Proxies, Sync" and the rail is "56px". The
   cards actually read **Profiles / Running / Proxies / Devices** (`Profiles.tsx` lines
   1305–1317) and the rail measures **52px**. The gates it set are still correct — it verified
   the row exists and the collapse works — but the labels in its prose were wrong.
2. My own earlier persistence check read `localStorage.sidebarCollapsed` and got `null`, which
   looked like a failure. The real key is `sidebar.collapsed` (`sidebarLogic.ts:1`). Re-tested
   with the correct key: stored `true`, and after a full page reload the sidebar is still
   52px wide with the toggle visible. Persistence is real; my first check was wrong.

## Independent evidence gathered alongside the audit

- Status-token contrast measured, not eyeballed. Light theme initially had `--ok #16a34a` on
  `--bg-app #fafafa` = **3.16:1**, below WCAG AA. Corrected to `#15803d` (**4.81:1**), with
  `--warn #b45309` 4.81:1 and `--danger #b91c1c` 6.20:1. Dark theme is 5.29–9.26:1.
- Both chroma guards still bite: injecting a blue `--accent` fails 3 tests.
- The new contrast test bites: restoring the original green fails with
  `light --ok (#16a34a) on #fafafa has 3.16:1, needs 4.5:1`.
- Full suite 131 files / 1089 passed; both typechecks exit 0.

## Requirements the audit did not cover

None. R01–R08 map onto the four operator requirements: R01/R02/R03 are requirements 1–3
directly, and R04–R08 are the decomposition of requirement 4 (parity), each verified.

## Deferred, stated plainly

Re-skinning the remaining list pages (Proxies, Fingerprints, Extensions, Library, Cloud) and
Settings' ten sections was scoped OUT in the Wave 0 interview: they inherit the new tokens
(surfaces, radii, status hues) but keep their current internal structure. The operator chose
"shell + Profiles page" over the wider options.
