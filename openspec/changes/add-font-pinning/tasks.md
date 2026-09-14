## 1. Font resolution

- [ ] 1.1 New `src/main/fingerprints/fonts.ts`: `resolveFontConfig(opts)` returning `{ inventory, hiddenHostFonts, fallbackFace }` from the family's `fontInventory`; per-platform fallback via `stealthNoise.ts` when the family ships none. Unit tests: each platform resolves a non-empty inventory; a macOS family yields Apple faces and no `Segoe UI`.
- [ ] 1.2 Populate `StealthOptions.fontList` at launch: `profileManager.resolveLaunchConfig` passes the resolved family inventory through to `writeStealthExtension`. Test: two profiles on different families receive different `fontList` values.

## 2. Injection

- [ ] 2.1 Emit `fonts: { inventory, hiddenHostFonts }` into the generated `CFG` payload in `buildStealthScript`.
- [ ] 2.2 Hook `document.fonts.check` and `FontFaceSet.prototype.check`: a family on the declared inventory answers available; a host font absent from the inventory answers unavailable.
- [ ] 2.3 Hook the canvas/element measurement path (`measureText` and the sized-element `offsetWidth`/`offsetHeight` probe) so a declared-but-absent family measures as present with a substitute face, and a hidden host font does not.
- [ ] 2.4 `navigator.fonts.queryLocalFonts`: keep the method present but rejecting with a `NotAllowedError`-shaped error, matching real Chrome without the font-access permission. A fabricated grant would itself be a tell.
- [ ] 2.5 Mark every hook `TODO(engine-parity: fonts)`.

## 3. Verification

- [ ] 3.1 Test: a macOS-claiming profile on a Windows host does not report `Segoe UI` as present.
- [ ] 3.2 Test: a declared font the host lacks measures as available.
- [ ] 3.3 Test: phone-claiming and desktop-claiming profiles report different inventories.
- [ ] 3.4 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-font-pinning --strict`.
