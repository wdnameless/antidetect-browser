# Design: Cookie SQLite IO

## Key Decisions

1. **sql.js for the sandbox side**: reading a source Cookies DB is pure (no native sqlite dep needed) — load bytes into sql.js, query `cookies` table, normalise rows.
2. **v10 decrypt path**: `CryptUnprotectData` (DPAPI) unwraps the OS key from the profile's `Local State` JSON (`os_crypt.encrypted_key`); AES-256-GCM decrypts cookie values (`v10` prefix + 12-byte nonce + tag). On non-Windows, the same AES-GCM path with the key from `Local State` minus DPAPI (documented Chrome behaviour).
3. **DPAPI call**: PowerShell `[System.Security.Cryptography.ProtectedData]::Unprotect` via child_process on Windows only; seam-injected in tests.
4. **Merge, not replace**: write path uses INSERT OR REPLACE keyed on (name, host_key, path) — the Chromium primary key; never wipes untouched rows.
5. **Target must be a stopped profile**: writing a live cookie DB would corrupt Chromium's WAL; route refuses running profiles.

## Testing Strategy

- Build a real Cookies DB with sql.js (matching Chromium schema) for read-path fixtures.
- v10 roundtrip: encrypt a known cookie with a fixed AES-GCM key, decrypt, assert equality; DPAPI seam stubbed in tests.
- Merge semantics: pre-existing row untouched fields preserved; overlapping row updated; write refused on a running profile.
