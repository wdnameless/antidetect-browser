# release-0.6.44

## Why

Operator reports, in order: the browser language would not change when set to EN-US; a profile
created while viewing a group was filed under ALL; and a request to hunt bugs and cut a release.

## What changed

See `manifest.md` for the requirement rows with the operator's verbatim words, `interfaces.md` for
the touched boundaries and signatures, `recon.md` for the method and the measurements, and
`oracle.md` for the independent acceptance verdict.

Summary: three reported/resolved defects and four more found by the hunt, each proven by
measurement before being fixed, each with a guard that was red-checked by reverting the fix.

## Why this ships as one release

`0.6.43` was prepared but never tagged, so its changes are folded into `0.6.44` rather than being
listed as a release that never existed. The version is carried by four files and CI builds the
artefacts from a `v0.6.44` tag; the release job only runs on a tag push.

## Recorded, not fixed

Three issues are listed under "Known issues" in `CHANGELOG.md`. Two of them (`COUNTRY_TO_LANG`
bare codes, `/status` rate limit) are real but each needs either a product decision or a change
larger than a release should carry; the third (`duplicateProfile` / bundle field subset) needs a
decision about what a clone should inherit. Recording them is the honest alternative to either
silently fixing them inside a release or leaving them unmentioned.
