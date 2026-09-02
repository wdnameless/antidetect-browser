## 1. Catalog extension

- [ ] 1.1 Extend family schema with gpuRenderer, audioSignature, fontInventory, screenProfile, scaleFactor; migrate with existing crc32 versioning.
- [ ] 1.2 Author curated macOS M1/M2/M3/M4 + Intel families from documented public specs; record provenance notes per family.
- [ ] 1.3 Author Windows 11 refresh families on current market distribution; keep existing 30 families byte-stable.
- [ ] 1.4 Unit tests: schema migration round-trip, HMAC sub-seed stability, family count/provenance lint.

## 2. Coherence validation

- [ ] 2.1 Implement cross-property coherence validator (UA/UA-CH/platform/WebGL/screen/fonts/audio) over all families.
- [ ] 2.2 Enumerate macOS-only host tells on Windows hosts; mask or exclude per family with documented rationale.
- [ ] 2.3 CI gate: validator fails build on any incoherent family; dated CreepJS/Pixelscan fixture evidence committed under evidence/.

## 3. Integration

- [ ] 3.1 Expose OS/chip selection in profile create API + panel; default distribution weights documented.
- [ ] 3.2 Integration tests: profile boot per new family yields coherent JS-observable surface.
