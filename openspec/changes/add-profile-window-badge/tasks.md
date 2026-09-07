## 1. Schema, badge, UI

- [ ] 1.1 Add nullable `color` column + endpoint accept/reject; unit tests for normalization and backward compatibility of old rows.
- [ ] 1.2 Implement badge generation (initials, canvas render, ICO cache path) and launch-time title prefix; unit tests per design.
- [ ] 1.3 Profiles table dot column + editor color picker with preview; component check.

## 2. Verification

- [ ] 2.1 Full vitest suite + typecheck green; CHANGELOG; `openspec validate add-profile-window-badge --strict`.