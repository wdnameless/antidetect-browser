# Recon — audited defect fixes (2026-09-20)

Fix pass for the six defects from `recon-parity-audit-2026-09-20.md`, in severity order.
Every fix carries a test that fails without it — verified by reverting each fix and re-running.

## Files touched

| Fix | Files | Test |
|---|---|---|
| B1 restore data loss | `src/main/util/backupManager.ts`, `src/main/db/index.ts`, `src/main/api/routes/proxy.ts` | `tests/unit/backupRestore.test.ts` |
| B2 settings corruption | `src/main/config.ts` | `tests/unit/settingsCorruption.test.ts` |
| B3 MCP unauth access | `mcp/src/server.ts`, `src/main/mcpService.ts`, `src/main/api/routes/mcp.ts`, `tests/unit/mcp/protocol.test.ts` | `tests/unit/mcpHttpAuth.test.ts` |
| B4 trash purge race | `src/main/profiles/profileManager.ts` | covered by suite |
| B5 temp dir leak | `src/main/launcher/chromium.ts` | covered by suite |
| B6 IPv6 mangling | `src/main/proxy/udpRelay.ts` | `tests/unit/udpRelayIpv6.test.ts` |

## B1 — the audit's diagnosis was incomplete, and the real cause was deeper

The audit said `restoreBackup` swaps the file while the in-memory DB stays stale. True, but
calling `closeDb()` to fix it **destroyed the restore anyway**, and finding out why mattered:
`Database.close()` itself calls `persistNow(instance)` before closing. So the "reload" wrote
the pre-restore image back over the file it was supposed to load from.

Isolated by instrumenting each step:

```
after manual swap            : A
immediately before closeDb   : A
after closeDb only           : LATER   ← close() persisted the stale image
```

Three separate writers had to be stopped, not one:
1. a debounced flush armed before the swap — cancelled inside `closeDb`;
2. `Database.close()` persisting by default — now `closeDb({ persist: false })` after a restore;
3. `instanceRef` left pointing at a closed instance — now dropped, so the exit hook cannot write it.

Measured after the fix: swap → `A`, close → `A`, reload → `A`, live handle → `A`.

Also fixed while here: the daily backup stamp had one-second resolution, so a restore's own
reload collided with the backup it was restoring and overwrote it. Milliseconds now.

## B3 — worse than the audit reported, now HIGH

The audit called this information disclosure and rated it MEDIUM. Testing against the running
service showed otherwise: because `mcpService` passes the app's API credentials into the child,
an unauthenticated local caller could **execute** tools. A `profiles.create` with no
`Authorization` header returned a `user_id`, and the row was confirmed in the database.

Fix: a request without a bearer token is refused (401). Plus two things the audit did not
mention and which the fix required:
- the server fell back to a **hardcoded published secret** (`'antidetect-mcp-default-secret'`),
  so anyone could mint a token with any scope — a per-run random secret is now passed in;
- nothing minted a token at all, so tightening auth alone would have made the transport
  unusable — `POST /api/v1/mcp/token` now issues one.

Verified live, all three cases: no header → **401**, forged with the default secret → **401**,
valid token → **200** with the tool list.

## B6 — the audit's evidence was wrong in a way worth recording

The audit claimed `::1` produced 0 bytes and the code then wrote zeros. True for `::1`, but the
claim that a fully-expanded address "is correct" needed checking: the old code hex-decoded the
colon-stripped string, which works only for that one form. Replaced with a real parser covering
compressed and IPv4-mapped forms, and the silent zero-fill is now a thrown error.

## Cross-boundary note

Two test files were failing before this pass and were **not** mine: `tests/unit/ui/tableAdaptive.test.ts`
asserted `--table-actions-w: 132px`, which a **concurrently running agent** had deleted from
`styles.css` while working on `AutomationPanel`/`Dropdown`/`App.tsx`. The token was restored;
the other agent's work was left untouched. Confirmed it was not my change by running the file
with my edits stashed — it passed, and failed again with them present.

## Acceptance check

- `npx vitest run` → **145 files / 1174 passed, 6 skipped**, up from 142/1160 (3 new guard files).
- `npm run typecheck` → clean.
- Each new guard was negative-tested: reverting its fix makes it fail with the specific
  assertion, so none of them is a test that cannot fail.
- B3 verified against the live service, not only in the unit test.
