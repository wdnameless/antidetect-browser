# Recon — removing the panel password (delivered)

Operator directive (verbatim): «У панели не должно быть пароля».

## Where the password lived — all four places removed

1. **`src/main/api/panelAuth.ts` — deleted.** Held `GET /ui/auth-state`, `GET /ui/sessions`,
   `POST /ui/setup`, `POST /ui/login`, the scrypt store (`panel_auth.json`), the device log
   (`panel_sessions.json`) and the brute-force guard. Was mounted public in `server.ts`,
   immediately before `authMiddleware`.
2. **`src/renderer/src/LoginScreen.tsx` — deleted**, with the `authenticated` state and the
   `if (!authenticated) return <LoginScreen/>` gate in `App.tsx`. Startup is now: resolve the
   key → maybe ask where data lives → open the app.
3. **`src/main/api/uiPanel.ts`** (legacy `/ui` HTML) — its first-run "create the panel login
   and password" form, login form, key-paste fallback, `Sign out`, and the boot branch that
   demanded a credential on first visit.
4. **`src/main/api/routes/cloud.ts` + `CloudSync.tsx`** — the local instance used to obtain a
   *remote* key by calling that server's `/ui/setup|login`. Both are gone with the password, so
   connect now takes the remote's API key directly.

## The consequence that had to be handled

`/ui/login` was how a **browser client obtained the API key** — its response `token` *is* the
key. The desktop shell injects the key over the Tauri bridge, so the gate never fired there;
in a plain browser there is no bridge, `initApiKey()` fell back to `localStorage` and then
`''`, and every request 401'd. Deleting the password without replacing that path would have
left the install-free web panel permanently `unauthorized`.

**Replacement: `GET /ui/key`**, same-origin only. `initApiKey()` gains it as a final fallback,
and the legacy panel boots from it.

Why same-origin is the security argument, checked rather than assumed: `hostAllowed()` already
rejects DNS-rebinding Host headers, but a hostile page can fetch `http://127.0.0.1:50325`
directly — its Host *is* loopback — and read the body, because `cors()` is permissive outside
server mode. `isSameOrigin()` compares the `Origin` against the request's own `Host`, so a
reverse-proxied entry point (Traefik on a VPN) keeps working while any other page is refused.
An unparseable origin (`null`) fails closed. Verified: foreign Origin → **403**, no key in body.

## Verification actually executed

| Requirement | Evidence |
|---|---|
| No password prompt, panel opens | Real Chromium against the built backend, no bridge: `passwordInputs: 0`, `loginMarkup: false`, full sidebar + all 7 nav destinations, "AUTOMATION API On" (i.e. authenticated) |
| Key acquired without a password | The page's own `localStorage.apiKey` equals the `/ui/key` response (`d386afba…`); legacy `/ui` shows `conn: connected` |
| Old endpoints cannot be reached | `/ui/auth-state`, `/ui/setup`, `/ui/login`, `/ui/sessions` → 401 (fell through to auth middleware), never 200 |
| Cross-origin cannot read the key | `Origin: http://evil.example` → 403, `data.key` absent |
| Regression guard | `webServing.test.ts`: same-origin serves + cross-origin refused + the four endpoints must not answer; 12/12 pass |
| No regressions | `npm test` 131 files / 1088 passed; both typechecks exit 0 |

## Files touched

- deleted: `src/main/api/panelAuth.ts`, `src/renderer/src/LoginScreen.tsx`, `tests/unit/panelAuth.test.ts`
- `src/main/api/server.ts` — mount removed, `/ui/key` + `isSameOrigin()` added
- `src/renderer/src/api.ts` — `/ui/key` fallback, `authState`/`cloudSessions`/`cloudLogin`/`cloudSetup` removed
- `src/renderer/src/App.tsx` — gate removed
- `src/main/api/uiPanel.ts` — login/setup forms removed, boots from `/ui/key`
- `src/main/api/routes/cloud.ts` — connect takes a remote key
- `src/renderer/src/pages/CloudSync.tsx` — key field replaces user/password card
- `src/renderer/src/i18n.tsx` — dead strings replaced; `docs/SERVER_DEPLOY.{md,ru.md}` rows updated
