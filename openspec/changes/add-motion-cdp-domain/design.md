# Design: Motion CDP Domain

## Context and Scope

Human-input emulation as a per-profile CDP service. The page must not be able to detect the automation surface: the domain is absent from protocol enumeration, and all synthesized events originate from the browser's own input pipeline.

## Architecture

```
BrowserProfile ──fingerprint seed──▶ MotorSeed derivation
                                          │ (domain label "motion")
       createPointer(x, y, paceScale?, seed?) ─┐
       glideTo(x, y, targetWidth?)             │  MotionSession (in-memory)
       tap(button?, clickCount?)               │  ── Input synthesis (CDP Input domain)
       enterText(text, allowTypos?)            │      keyDown/keyUp sequences, pointer events
       destroyPointer()                       ─┘
```

- `src/main/motion/seeds.ts`: `deriveMotorSeed(profileSeed)` — reuses the fingerprints module's domain-separated derivation; stable per profile, overridable per session via `createPointer({ seed })`.
- `src/main/motion/trajectory.ts`: `planGlide(from, to, targetWidth, seed, paceScale)` → list of pointer moves + total `durationMs`. Duration = Fitts: `a + b·log2(2D/W)` with seeded per-velocity jitter; monotone in target width (smaller target ⇒ longer duration). Path = cubic bezier through two seeded control points; overshoot-and-correct on ~8% of glides.
- `src/main/motion/typing.ts`: `planTyping(text, seed, paceScale, allowTypos)` → key event list. Per-key delay sampled from a seeded log-normal around profile pace (~150–350ms); typos at ~2% when enabled, corrected with real Backspace sequences.
- `src/main/motion/session.ts`: `MotionSessionRegistry` keyed by profileId; pointer lifecycle state; executes plans over the profile's browser-level CDP WS (existing `getRunningWs`/tunnel infrastructure).
- Protocol handler: intercept the profile's browser WS server frame path (we own the tunnel at `src/main/proxy/`); unrecognized-but-Motion commands route to the registry. Because our handler answers directly, the domain never appears in `Target.getTargets`/`/json/protocol` listings.

## Key Decisions

1. **Command vocabulary mirrors the documented ShardX five commands** (createPointer/glideTo/tap/enterText/destroyPointer) — but parameters and error codes are ours; matching another tool's exact vocabulary would itself be a fingerprint.
2. **`targetWidth` defaults to 32** and feeds Fitts's law; `paceScale` multiplies profile pace (1.0 = default).
3. **`enterText` types key-by-key in real time**; returns only when the last key is released (`durationMs` reported). No clipboard, no `insertText`, no `Page.evaluate`.
4. **`allowTypos` off by default** — changes the final field value; enabled per call.
5. **Fail-closed pointer**: every command except `createPointer` errors if no pointer exists; no invented origins.
6. **Determinism**: same profile seed + same params ⇒ same plan (snapshot-testable); seed 0/undefined falls back to profile-derived seed so temporary profiles created a second apart never share trajectories.
7. **JS-interim note**: the handler lives in the launcher/tunnel layer (not a Chromium C++ patch); the engine-parity patch (native Motion domain in the private engine) supersedes it later — tracked by `add-engine-level-hardening` task extension.

## Testing Strategy

- `tests/unit/motion/trajectory.test.ts`: seeded determinism (same seed ⇒ identical plans), Fitts monotonicity (smaller `targetWidth` ⇒ longer duration), overshoot probability with fixed seed, viewport-bound coordinates.
- `tests/unit/motion/typing.test.ts`: pace distribution bounds, typo+backspace correction shape, `allowTypos=false` never mutates text, seed stability.
- `tests/unit/motion/session.test.ts`: fail-closed without pointer, pointer destroy cleanup, per-profile isolation.
- `tests/unit/motion/protocol.test.ts`: fake WebSocket server — full create→glide→tap→type→destroy roundtrip; Motion absent from `Schema.getDomains`/`/json/protocol` output; error codes on missing pointer.
- MCP/SDK: tool wiring tests following `tests/unit/mcp/` patterns; SDK conformance via mock fixtures (existing cross-SDK conformance suite).