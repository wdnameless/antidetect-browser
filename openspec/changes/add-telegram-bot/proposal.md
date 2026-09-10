## Why

Afina's Telegram bot lets operators start/stop profiles, read status, and get run reports from their phone — a real operational channel for fleet owners. We have zero notification/remote-control surface.

## What Changes

- `src/main/telegram/bot.ts`: long-poll loop against api.telegram.org (no webhook infrastructure needed), chat whitelist, command set: /start, /stop, /status, /list, /rotate (bulk fingerprint rotation), and notifications on profile start/stop/crash + task-group completion.
- Bot token + allowed chat IDs in Settings (new Telegram section); OFF by default when no token configured.
- Rate-limited outbound notifications (coalesce bursts) and error-safe poll loop with backoff.

## Capabilities

### New Capabilities
- `telegram-bot`: long-poll operator bot, command surface, outbound notifications, settings integration.

## Impact

- `src/main/telegram/` (new), settings endpoints, renderer Telegram settings section, tests in `tests/unit/telegramBot.test.ts` (mocked Telegram API via injected transport).