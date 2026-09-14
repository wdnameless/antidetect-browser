## 1. Persona generation

- [ ] 1.1 `src/main/motion/persona.ts`: `generatePersona(profileSeed, opts?)` returning a typed `Persona` (given/family name, full address, city, region, postcode, country, phone, email, date of birth, payment card with number/expiry/cvv). Derive everything from the profile seed with HMAC-SHA256 domain separation, matching the `deriveMotorSeed` idiom in `src/main/motion/seeds.ts` — same seed, same person, forever.
- [ ] 1.2 Coherence rules, each unit-tested: email local-part derives from the name; postcode and region agree for the chosen country; phone matches that country's national shape; card passes Luhn; expiry is in the future relative to a supplied clock; date of birth yields an adult age consistent with the persona's role.
- [ ] 1.3 A small locale table (country -> name pools, phone shape, postcode pattern, address shape). Keep it data, not branching logic. No new dependency.

## 2. Typing surface

- [ ] 2.1 Fill a single field and fill a whole form (selector -> persona field mapping) through the existing Motion input path so the page receives real keystrokes. It MUST NOT set `element.value` or synthesise DOM events.
- [ ] 2.2 Field-to-persona mapping must be driven by the caller (an explicit mapping or field hints), not by guessing at label text with a fragile heuristic. If a heuristic is added for convenience, it must be opt-in and its misses must be reported, not silently skipped.

## 3. Exposure

- [ ] 3.1 API endpoint to fetch a profile's persona and to fill a form on a running profile.
- [ ] 3.2 A flow node so a no-code run can fill a form, following the existing node schema/compiler/validator conventions. Coordinate with the owner of `src/main/flows/` if it is being edited concurrently.
- [ ] 3.3 MCP tool exposing persona fetch and form fill. **Coordinate with `extend-mcp-tool-surface` — same file (`mcp/src/tools.ts`), so serialize and report which tool names you add.**

## 4. Verification

- [ ] 4.1 Tests: determinism across runs, distinctness across seeds, every coherence rule, and an assertion that the fill path never assigns to `element.value`.
- [ ] 4.2 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-form-filling-helper --strict`.
