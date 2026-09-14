## Why

ShardX ships a form-filling helper that "generates a coherent person — name, address, card, dates — and types it into the page through that same engine, from the right-click menu. Each profile gets its own person, so a group of profiles filling the same form does not fill it identically."

We have the input engine (`src/main/motion/` — Fitts's-law pointer glide, per-key typing with per-profile motor seeds) and per-profile deterministic derivation is already our house style (`deriveSubSeeds`, `deriveMotorSeed`, `resolveSensorConfig` all derive stable values from a profile seed via HMAC-SHA256 domain separation). What we lack is the persona itself: a coherent identity, stable per profile, typed through the existing input path rather than assigned to the DOM.

Coherence is the point. A name that does not match its email handle, a postcode that does not match its city, a card whose expiry is in the past — each is a tell. The generator must therefore produce one internally consistent person, not independent random fields.

## What Changes

- New `src/main/motion/persona.ts`: deterministic per-profile persona generation (name, address, city/region/postcode that match, phone in the right national shape, email derived from the name, payment card with a valid Luhn check digit and a future expiry, and a plausible date of birth).
- Typing surface: fill a field or a whole form through the existing Motion input path (real keystrokes), never by assigning `element.value`.
- Exposure: a right-click menu entry in the profile (alongside the picker from `add-flow-recorder`), an API endpoint, an MCP tool, and a flow node so a no-code run can fill a form.
- Distinctness guarantee: two profiles filling the same form MUST produce different values; the same profile filling it twice MUST produce the same values.

## Capabilities

### New Capabilities
- `form-filling-helper`: coherent per-profile persona generation and keystroke-level form filling.

### Modified Capabilities
None.

## Impact

- New `src/main/motion/persona.ts`, `src/main/api/routes/` wiring, `src/main/flows/` (a fill node), `mcp/src/tools.ts`.
- Tests: determinism, per-profile distinctness, coherence rules (Luhn, expiry in the future, postcode/region agreement), and no-DOM-assignment guarantee.
