# Key Compromise Runbook & Governance

This document establishes the official runbook and emergency procedures for Ed25519 signing key compromise, rotation, revocation, and recovery in `antidetect-browser`.

---

## 1. Governance Architecture

- **Algorithm**: Ed25519 (SPKI public key / PKCS#8 private key) with RFC 8785 JSON Canonicalization Scheme (JCS) and domain separation (`antidetect:supply-chain:v1\0`).
- **Key-Ring Storage**: Kept in signed release manifest metadata and local `release-keyring.json` registry.
- **Fail-Closed Principle**: Any module, release update, or extension missing a valid signature from an active, unrevoked key fails verification immediately.
- **Monotonic Anti-Rollback**: Releases verify that `manifest.version >= currentInstalledVersion`. Lower version numbers trigger a `rollback-violation` failure.
- **Emergency Bypass**: `--allow-unsigned-dev` is strictly restricted to development environments and explicitly ignored by production/packaged builds.

---

## 2. Key Compromise Incident Response Plan

When a private key is suspected or confirmed compromised, execute the following 5 phases immediately:

### Phase 1: Immediate Key Revocation
1. Identify the compromised `keyId` (e.g. `release-key-2026-q1`).
2. Mark the key as revoked in the active keyring using `KeyRingStore.revokeKey(keyId, 'key-revoked')` or via script:
   ```json
   {
     "keyId": "release-key-2026-q1",
     "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
     "revoked": true,
     "revokedAt": "2026-09-02T16:00:00.000Z",
     "revocationReason": "key-revoked: suspected private key exposure"
   }
   ```
3. All verifiers (`verifySignedManifest`, `verifyReleaseManifest`, `verifyScriptModule`, `verifyStealthExtension`) will fail with code `key-revoked` upon inspecting any manifest signed by this key.

### Phase 2: Key Pair Generation & Rotation
1. Generate an isolated, clean Ed25519 keypair on an air-gapped machine or Hardware Security Module (HSM):
   ```bash
   node -e "const { generateEd25519KeyPair } = require('./dist/src/main/security'); console.log(JSON.stringify(generateEd25519KeyPair()));"
   ```
2. Register the new public key into `release-keyring.json` with a new sequential identifier:
   ```json
   {
     "keyId": "release-key-2026-q1-replacement",
     "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
     "createdAt": "2026-09-02T16:30:00.000Z"
   }
   ```
3. Update default signing key id to `release-key-2026-q1-replacement`.

### Phase 3: Out-of-Band Emergency Keyring Distribution
1. Package the updated `release-keyring.json` containing the revocation entry and the replacement key into an emergency patch.
2. Sign the new distribution with a backup offline recovery key (or multi-signature threshold if configured).
3. The launcher client syncs the updated keyring before attempting artifact downloads.

### Phase 4: Artifact Re-signing & Re-release
1. Re-build and re-verify all active runtime release artifacts, script packages, and extension packages from clean source checkouts.
2. Sign the fresh md5 directory manifests with the new private key:
   ```bash
   npx ts-node scripts/sign-manifest.ts --dir ./release-artifacts --private-key ./replacement-key.pem --key-id release-key-2026-q1-replacement --version 1.0.1
   ```
3. Increment the release patch version (e.g. `1.0.0` -> `1.0.1`) to ensure anti-rollback passes.

### Phase 5: Post-Incident Audit
1. Audit all launcher client verification failure logs (`[AUDIT REFUSAL] Refused execution...`).
2. Verify that zero unauthorized versions were executed in production clients.
3. Archive the incident report and permanently destroy the compromised private key credentials.

---

## 3. Offline Verification Path

Clients operating in restricted, isolated, or offline environments verify manifests locally:
1. The client loads the bundled `release-keyring.json` embedded in the trusted binary package.
2. Manifests are verified directly against disk artifacts without requiring network calls or online OCSP/timestamping servers.
3. In case of offline recovery, a known root-of-trust recovery public key can re-instate or update valid keys offline.
