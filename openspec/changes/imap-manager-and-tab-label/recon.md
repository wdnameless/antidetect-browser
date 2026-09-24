# Recon — IMAP manager "does not work", and the tab called Library

## Reported
> «Во первых не работает iMAP manager, во вторых почему эта вкладка называется Library а не imap»

## Evidence chain (measured against a REAL IMAP server, not a stub)

The existing tests stub the socket, so they cannot tell whether the client speaks IMAP. To answer
that, a real IMAP4rev1 fixture was written (`temp/fake-imap.mjs`), plus one probe against the
provider the reporter actually uses.

| Step | Method | Observed |
|---|---|---|
| Does the client speak IMAP? | real fixture: greet → LOGIN → SELECT → `UID FETCH (UID ENVELOPE)` | **works** — one message parsed: uid 101, subject "Your verification code" |
| Body + code extraction | real fixture with a body carrying a code | **works** — body read, `extractCodes` → `["483920"]` |
| Rejected login | fixture answering `A001 NO [AUTHENTICATIONFAILED]` | `cached: true`, `messages: 0`, **reason discarded** |
| Real provider | `tls.connect` to `imap.mail.me.com:993`, then the manager | server sent `A001 NO [AUTHENTICATIONFAILED] Authentication Failed`; manager returned `cached: true, msgs: 0` |
| Unreachable host | `10.255.255.1:993` | `cached: true, msgs: 0` after 21 s — still no reason |

**Root cause.** `listInbox` wraps the whole live read in one `catch` and returns the cache. That
fallback is right — a mailbox read offline should still show what was cached — but it returned
`{ messages, cached: true }` and dropped the error, so every distinct failure (wrong password,
blocked host, TLS failure) collapsed into the same picture: `Cached` over an empty column. The
provider had already named the problem and it was thrown away one line above the display.

**Not a protocol bug.** The IMAP client works: `SimpleImapSession`, the envelope parser and the body
parser all behaved correctly against a real server. The reported "does not work" is the operator
being told nothing when the login was refused — iCloud requires an app-specific password, and a
normal account password is rejected.

**Second finding (reported).** The nav entry is `key: 'email'`, `icon: CookieIcon`, but
`label: 'Library'` — inside a sidebar group already headed `LIBRARY`. The label described the
grouping rather than the destination, and the page it opens is the mail manager
(`pages/Email.tsx`, `/api/v1/email`).

## Fix

- `InboxResult.error` / `EmailMessageDetail.error` carry the reason out of the fallback. Absent on
  success, so healthy reads raise no banner and real failures stay visible.
- `Email.tsx` shows it: a banner with the provider's own words, and the empty state now separates
  "could not be read" from "is empty" — a failed read no longer claims the mailbox is empty.
- Nav: `label: 'IMAP'`, new `MailIcon` (the `CookieIcon` it wore belongs to the cookie farm).

## Acceptance

| Check | Result |
|---|---|
| Rejected login | `error: "IMAP command failed: A001 NO [AUTHENTICATIONFAILED] Invalid credentials"` |
| Real iCloud | `error: "IMAP command failed: A001 NO [AUTHENTICATIONFAILED] Authentication Failed"` |
| Working mailbox | `cached: false`, `error: undefined`, 1 message — the field is absent on success |
| Over HTTP (live service) | `{"messages":[],"cached":true,"error":"IMAP command failed: A001 NO [AUTHENTICATIONFAILED] Authentication Failed"}` |
| Built renderer bundle | `IMAP` present, `label:"Library"` gone, envelope path present |
| Tests | `tests/unit/email.test.ts` 18 passed; full suite 159/159 files, 1336 passed, 0 errors |

**The guards were red-checked.** With the reason swallowing reinstated:
`a cache fallback must carry the reason it fell back: expected undefined to be truthy`. The original
test asserted only `cached`, which is why the defect survived it — it now asserts the reason, and a
second case asserts the field is ABSENT on success so a healthy read cannot raise a false banner.
