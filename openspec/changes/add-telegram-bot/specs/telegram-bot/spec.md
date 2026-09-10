## Purpose

Defines the operator Telegram bot: long-poll loop, chat whitelist, command surface, coalesced outbound notifications, and error-safe polling with backoff.

## ADDED Requirements

### Requirement: Chat whitelist enforcement
The bot MUST answer commands only from configured chat IDs; unknown chats MUST receive at most one refusal message and never leak internal state.

#### Scenario: Unknown chat gets one refusal
- **GIVEN** a message from an unconfigured chat id
- **WHEN** it arrives
- **THEN** the bot MUST reply with a single refusal and MUST NOT execute the command

### Requirement: Poll loop survives Telegram errors
On Telegram 429 the loop MUST honour Retry-After; on network failures the loop MUST back off exponentially up to 60s and MUST NOT crash the service.

#### Scenario: Backoff on repeated failure
- **GIVEN** three consecutive network failures
- **WHEN** the poll loop runs
- **THEN** the wait before retry MUST grow and MUST NOT exceed the 60s cap

### Requirement: Notification coalescing
Bursts of profile events (batch start/stop) MUST coalesce into one message per 2-second window.

#### Scenario: Batch start sends one message
- **GIVEN** 20 profile starts inside one second
- **WHEN** notifications emit
- **THEN** exactly one Telegram message MUST be sent