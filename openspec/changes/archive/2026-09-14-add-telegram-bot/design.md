# Design: Telegram Bot

## Key Decisions

1. **Long-poll, no webhook**: no public endpoint needed; getUpdates with long-poll handles real-world operator networks (NAT, dynamic IPs).
2. **Chat whitelist mandatory**: the bot answers only configured chat IDs; unknown chats get a single refusal, not an error echo.
3. **Backoff on Telegram errors**: 429 respect Retry-After; network failures use exponential backoff capped at 60s; the loop never crashes the service.
4. **Coalesced notifications**: profile start/stop bursts (batch starts) fold into a single message per 2s window.

## Testing Strategy

- `tests/unit/telegramBot.test.ts`: mocked transport asserting command routing, whitelist refusal for unknown chats, backoff timing on 429/500 with fake timers, notification coalescing window, settings roundtrip.
