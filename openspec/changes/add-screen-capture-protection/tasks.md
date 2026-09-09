## 1. Protection module

- [x] 1.1 Implement `src/main/security/screenProtection.ts`: `setContentProtection`-based capture guard, idle poll (30s cadence, default 15 min, 0=off), lock/suspend engagement, injectable seams; unit tests for all five rules from the design.
- [x] 1.2 Settings Security section (capture toggle, idle timeout) with persistence roundtrip; component check.

## 2. Verification

- [x] 2.1 Full vitest suite + typecheck green; CHANGELOG; `openspec validate add-screen-capture-protection --strict`.