## 1. Bot core

- [ ] 1.1 Long-poll loop + chat whitelist + command router in `src/main/telegram/bot.ts`; tests per design (routing, whitelist, backoff, coalescing).
- [ ] 1.2 Settings endpoints + renderer Telegram section (token, chat IDs, enable toggle); persistence test.
- [ ] 1.3 Outbound notifications wired to profile start/stop and task-group completion events.

## 2. Verification

- [ ] 2.1 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-telegram-bot --strict`.
