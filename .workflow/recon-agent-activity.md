# Recon — agent activity: status desync, in-app toasts, Telegram audit

Operator (verbatim):

> «Агент открывает профиль браузера, но в нашем интерфейсе NullTrace не отображается, что браузер
> открыт. Но отображается, но не всегда. Нужно это отследить и пофиксить, так же, когда агент
> дергает опишку, у нас должно приходить уведомления, что он что-то дергает и что-то делает. Эти
> уведомления можно отключить в настройках, можно оставить, но не делая их слишком вызывающими, это
> просто должно быть всплывающие окна без звука, примерно как в телеграме. Также проверь, как сейчас
> работает подключение нашего телеграмма бота, что вообще туда будет приходить, и это все должно
> настраиваться, все уведомления, которые могут приходить, должны настраиваться, отсылать их в БоТ
> или нет.»

Three asks: (1) UI must reflect an agent-opened profile; (2) in-app toast on agent action, silent,
opt-out, "like Telegram"; (3) audit + per-event configuration of the Telegram bot.

## Architecture (verified)

MCP runs as a **separate child process** (`mcpService` spawns `mcp/dist/mcp/src/index.js`) and talks
to the backend over the backend's own HTTP API with a Bearer token. `mcp/src/tools.ts` builds
`AntidetectClient` from `ANTIDETECT_API_URL`/`ANTIDETECT_API_TOKEN`; `profiles.start` →
`client.browser.start` → `POST /api/v1/browser/start`. So the backend is the single point that
observes every agent action, and nothing else needs to change to observe it.

## Ask 1 — why "opened but the UI doesn't show it"

`profileManager.listProfiles` computes `status = liveRunning ? 'running' : r.status`, where
`liveRunning = chromium.isRunning(id) || firefox.isRunning(id)` and `isRunning` is
`running.has(profileId)` in the launcher's in-memory map (set at `chromium.ts:712`). The status is
therefore correct **in the data** as soon as the launch registers.

The defect is in the renderer's refresh, which is poll-only:

```ts
// Profiles.tsx:428 — the ONLY status refresher
setInterval(() => {
  if (document.visibilityState === 'visible' && !busy) void loadProfiles();
}, 5000);
```

Three concrete ways the UI misses a launch, all matching "sometimes":

1. **The `!busy` gate.** Any of the 17 `setBusy(true)` sites that does not reach its `setBusy(false)`
   on every path freezes auto-refresh for as long as it stays true. There are 17 `setBusy(true)` and
   18 `setBusy(false)` calls, so the pairing is not mechanically checkable — one unbalanced path is
   enough.
2. **The visibility gate.** With the window minimised or another tab focused, nothing refreshes.
3. **Up to 5 seconds of lag** even on the happy path, because polling is the only mechanism. An agent
   launch is asynchronous from the UI's point of view and nothing signals it.

Decision: **push, not faster polling.** The backend already emits `onProfileStatusChange`
(`profileManager.ts:870`), and the repo already streams SSE to the renderer on another page
(`/api/tasks/:uuid/logs?stream=true`, consumed via `EventSource` in `FlowCanvas.tsx:331`). One
authenticated SSE endpoint keyed to status changes fixes all three causes at once, removes the poll's
busy/visibility coupling, and is the same mechanism the toast feed needs. Faster polling would fix
nothing about 1–2 and would add load.

Note: an `EventSource` cannot set an `Authorization` header. The repo's existing stream endpoint sits
behind `authMiddleware`. Handled by passing the key as a query parameter on this one route and
validating it in the handler (documented in code), not by weakening `authMiddleware`.

## Ask 2 — in-app toasts

No toast infrastructure exists (`grep -c "\.toast" styles.css` → 0). Requirements from the operator:
silent, non-intrusive, Telegram-like, and switchable off in Settings. So: a small stack in a corner,
auto-dismiss, no sound, no modal, driven by the same SSE feed as ask 1. A Settings toggle governs it.

## Ask 3 — Telegram audit (defects found)

1. **Inbound commands never work after a normal boot.** `wireTelegramBot()` (`index.ts:345`)
   constructs the singleton and binds handlers but **never calls `startPolling()`**. `TelegramBot`
   only polls if `saveTelegramSettings` is called with `enabled: true` (`bot.ts:253`), i.e. only after
   the operator re-saves the settings form in that session. So `/start`, `/stop`, `/status`, `/list`
   silently do nothing on a fresh launch. Verified by reading the boot path: `startService` calls
   `wireTelegramBot()` and nothing else touches polling.
2. **Everything is all-or-nothing.** `TelegramSettings` is `{token, chatIds, enabled}`. There is one
   master switch and no per-event control, so the operator cannot keep profile events but drop task
   group spam — which is exactly what ask 3 requests.
3. **Only three notification kinds exist**, all hardcoded strings: profile started/stopped
   (`notifyProfileEvent`) and task group finished (`notifyTaskGroupFinished`). Nothing reports agent
   (MCP) activity at all.
4. `notify*` functions no-op when the bot is disabled, and `bot.notify()` coalesces for 2s then joins
   with `\n` — reasonable, keep it.

## Files to touch

| File | Change |
|---|---|
| `src/main/api/routes/events.ts` (new) | Authenticated SSE: profile status + agent activity |
| `src/main/agentActivity.ts` (new) | Classifies a request as agent-originated and publishes an event |
| `src/main/api/server.ts` | Mount the events route; wire the activity classifier |
| `src/main/telegram/bot.ts` | Per-event settings; `startPolling()` on boot; agent-activity notify |
| `src/main/api/routes/settings.ts` | Return/accept the per-event Telegram map |
| `src/main/index.ts` | Start polling in `wireTelegramBot()`; subscribe activity → Telegram |
| `src/renderer/src/components/Toasts.tsx` (new) + CSS | Silent toast stack |
| `src/renderer/src/eventsStream.ts` (new) | One shared EventSource with reconnect |
| `src/renderer/src/pages/Profiles.tsx` | Drop the poll's busy/visibility coupling; refresh on push |
| `src/renderer/src/pages/Settings.tsx` | Per-event Telegram switches + toast toggle |

## Acceptance check

- An agent `profiles.start` flips the row to Running without a manual reload, with the window
  unfocused.
- A toast appears for the action, silent, and stops appearing when switched off.
- `/status` in Telegram answers after a fresh app start with no re-save.
- Each notification kind can be toggled independently.
