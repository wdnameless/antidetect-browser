// [CRITICAL COMPATIBILITY NOTE: ELECTRON safeStorage ON WINDOWS]
//
// Electron's `safeStorage` on Windows does NOT store raw DPAPI ciphertext in secrets!
// Instead, it behaves identically to Chromium's OSCrypt:
//
// 1. Chromium generates an AES-256 key once and encrypts it using Windows DPAPI
//    (CryptProtectData) with scope CurrentUser and no entropy.
// 2. That DPAPI-encrypted key is stored base64-encoded with a "DPAPI" ASCII prefix
//    in the user's data folder under `Local State` (JSON): `os_crypt.encrypted_key`.
// 3. When encrypting secrets (like proxies or safeStorage.encryptString), Electron
//    generates a 12-byte random nonce and encrypts the secret using AES-256-GCM
//    with that decrypted AES key. The output byte buffer format is:
//      - bytes 0..3: ASCII "v10" (0x76, 0x31, 0x30)
//      - bytes 3..15: 12-byte AES-GCM nonce (IV)
//      - bytes 15..: ciphertext concatenated with 16-byte AES-GCM authentication tag
//
// This module implements BOTH layers:
// - Low-level Windows DPAPI primitives (`dpapi_encrypt`, `dpapi_decrypt`, `is_available`)
//   via Windows `crypt32.dll` (CryptProtectData / CryptUnprotectData), CurrentUser scope.
// - Chromium/Electron AES-GCM layer (`safe_storage_decrypt`, `parse_v10_payload`,
//   `unwrap_local_state_aes_key`) to ensure backwards compatibility with existing
//   Electron-era secrets stored in the database.

#[cfg(windows)]
use windows::Win32::Foundation::LocalFree;
#[cfg(windows)]
use windows::Win32::Foundation::HLOCAL;
#[cfg(windows)]
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// Nonce length for AES-256-GCM.
/// Prefix prepended to AES-GCM ciphertext by Chromium / Electron (`v10`).
pub const V10_PREFIX: &[u8] = b"v10";

pub const NONCE_LEN: usize = 12;

/// DPAPI prefix in Chromium Local State encrypted_key.
pub const DPAPI_PREFIX: &[u8] = b"DPAPI";

/// Check if Windows DPAPI encryption is available on the current platform.
pub fn is_available() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Encrypt data using Windows Data Protection API (DPAPI) in CurrentUser scope.
///
/// Uses `CryptProtectData` with:
/// - `pOptionalEntropy = NULL`
/// - `dwFlags = 0` (CurrentUser scope; does NOT pass `CRYPTPROTECT_LOCAL_MACHINE`)
/// - Memory allocated by `CryptProtectData` is freed with `LocalFree`.
#[cfg(windows)]
pub fn dpapi_encrypt(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let data_in = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        CryptProtectData(
            &data_in,
            None,
            None,
            None,
            None,
            0, // CurrentUser scope
            &mut data_out,
        )
        .map_err(|e| format!("CryptProtectData failed: {e}"))?;

        if data_out.pbData.is_null() {
            return Err("CryptProtectData returned null pointer".to_string());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();

        let _ = LocalFree(Some(HLOCAL(data_out.pbData as _)));

        Ok(result)
    }
}

#[cfg(not(windows))]
pub fn dpapi_encrypt(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI encryption is only supported on Windows".to_string())
}

/// Decrypt data using Windows Data Protection API (DPAPI) in CurrentUser scope.
///
/// Uses `CryptUnprotectData` with:
/// - `pOptionalEntropy = NULL`
/// - `dwFlags = 0`
/// - Memory allocated by `CryptUnprotectData` is freed with `LocalFree`.
#[cfg(windows)]
pub fn dpapi_decrypt(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let data_in = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        CryptUnprotectData(
            &data_in,
            None,
            None,
            None,
            None,
            0,
            &mut data_out,
        )
        .map_err(|e| format!("CryptUnprotectData failed: {e}"))?;

        if data_out.pbData.is_null() {
            return Err("CryptUnprotectData returned null pointer".to_string());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();

        let _ = LocalFree(Some(HLOCAL(data_out.pbData as _)));

        Ok(result)
    }
}

#[cfg(not(windows))]
pub fn dpapi_decrypt(_ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI decryption is only supported on Windows".to_string())
}
/// Tauri command: Encrypt a plain string using DPAPI, returning base64 string.
#[tauri::command]
pub fn secret_encrypt(plain: String) -> Result<String, String> {
    let encrypted = dpapi_encrypt(plain.as_bytes())?;
    Ok(STANDARD.encode(encrypted))
}

/// Tauri command: Decrypt a base64-encoded DPAPI blob back into a plain string.
#[tauri::command]
pub fn secret_decrypt(encrypted_base64: String) -> Result<String, String> {
    let blob = STANDARD.decode(encrypted_base64.trim())
        .map_err(|e| format!("Failed to decode base64: {e}"))?;
    let decrypted = dpapi_decrypt(&blob)?;
    String::from_utf8(decrypted).map_err(|e| format!("Decrypted bytes are not valid UTF-8: {e}"))
}


/// Parse a Chromium/Electron `v10` payload into `(nonce, ciphertext_and_tag)`.
///
/// Payload format:
/// - bytes 0..3: "v10"
/// - bytes 3..15: 12-byte AES-GCM nonce
/// - bytes 15..: ciphertext + 16-byte tag
pub fn parse_v10_payload(payload: &[u8]) -> Result<(&[u8], &[u8]), String> {
    if payload.len() < V10_PREFIX.len() + NONCE_LEN {
        return Err(format!(
            "Payload too short for v10 format: {} bytes (expected >= {})",
            payload.len(),
            V10_PREFIX.len() + NONCE_LEN
        ));
    }

    if &payload[..3] != V10_PREFIX {
        return Err("Payload does not start with 'v10' prefix".to_string());
    }

    let nonce = &payload[3..3 + NONCE_LEN];
    let ciphertext_and_tag = &payload[3 + NONCE_LEN..];
    Ok((nonce, ciphertext_and_tag))
}

/// Decrypt an Electron `safeStorage` encrypted payload using the 32-byte AES key
/// obtained from unwrapping `os_crypt.encrypted_key`.
pub fn decrypt_v10_with_key(key: &[u8; 32], payload: &[u8]) -> Result<Vec<u8>, String> {
    let (nonce_bytes, ciphertext_and_tag) = parse_v10_payload(payload)?;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create AES-256-GCM cipher: {e}"))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext_and_tag)
        .map_err(|e| format!("AES-256-GCM decryption failed: {e}"))
}

/// Decrypt an Electron `safeStorage` string/buffer using the Local State file
/// content and the raw encrypted payload.
pub fn safe_storage_decrypt(local_state_json: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
    // If the payload starts with "v10", decrypt using the unwrap-AES key flow:
    if payload.starts_with(V10_PREFIX) {
        let key = unwrap_local_state_aes_key(local_state_json)?;
        decrypt_v10_with_key(&key, payload)
    } else {
        // Fallback to direct DPAPI decryption if someone encrypted with raw DPAPI
        dpapi_decrypt(payload)
    }
}

/// Unwrap the 32-byte AES key from Chromium/Electron `Local State` JSON string.
///
/// In `Local State`, JSON path is `os_crypt.encrypted_key` (base64 string).
/// The base64-decoded bytes start with ASCII "DPAPI" (5 bytes), followed by
/// the DPAPI-encrypted 32-byte AES key.
pub fn unwrap_local_state_aes_key(local_state_json: &str) -> Result<[u8; 32], String> {
    use base64::Engine;
    let json: serde_json::Value = serde_json::from_str(local_state_json)
        .map_err(|e| format!("Failed to parse Local State JSON: {e}"))?;

    let enc_key_b64 = json
        .get("os_crypt")
        .and_then(|v| v.get("encrypted_key"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Local State missing os_crypt.encrypted_key".to_string())?;

    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(enc_key_b64)
        .map_err(|e| format!("Invalid base64 in encrypted_key: {e}"))?;

    if raw_bytes.len() < DPAPI_PREFIX.len() {
        return Err("encrypted_key too short to contain DPAPI prefix".to_string());
    }

    if &raw_bytes[..DPAPI_PREFIX.len()] != DPAPI_PREFIX {
        return Err("encrypted_key missing DPAPI prefix".to_string());
    }

    let dpapi_blob = &raw_bytes[DPAPI_PREFIX.len()..];
    let decrypted_key = dpapi_decrypt(dpapi_blob)?;

    if decrypted_key.len() != 32 {
        return Err(format!(
            "Decrypted key length is {} bytes, expected 32",
            decrypted_key.len()
        ));
    }

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&decrypted_key);
    Ok(key_bytes)
}
/// Encrypt plaintext using a Chromium/Electron compatible `v10` format.
/// Generates a random 12-byte nonce, encrypts with AES-256-GCM, and prefixes with `b"v10"`.
pub fn encrypt_v10_with_key(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::OsRng;
    use aes_gcm::aead::rand_core::RngCore;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Invalid AES-256-GCM key: {e}"))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext_and_tag = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("AES-256-GCM encryption failed: {e}"))?;

    let mut result = Vec::with_capacity(V10_PREFIX.len() + NONCE_LEN + ciphertext_and_tag.len());
    result.extend_from_slice(V10_PREFIX);
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext_and_tag);
    Ok(result)
}

/// Helper for end-to-end safe_storage encryption using key unwrapped from `Local State`.
pub fn safe_storage_encrypt(local_state_json: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let key = unwrap_local_state_aes_key(local_state_json)?;
    encrypt_v10_with_key(&key, plaintext)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_v10_payload_offsets() {
        let mut sample = Vec::new();
        sample.extend_from_slice(b"v10");
        let nonce = [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        sample.extend_from_slice(&nonce);
        let ciphertext = b"encrypted-data-and-tag";
        sample.extend_from_slice(ciphertext);

        let (parsed_nonce, parsed_cipher) = parse_v10_payload(&sample).expect("parse valid v10");
        assert_eq!(parsed_nonce, &nonce);
        assert_eq!(parsed_cipher, ciphertext);
    }

    #[test]
    fn test_parse_v10_too_short() {
        assert!(parse_v10_payload(b"v10").is_err());
        assert!(parse_v10_payload(b"v1012345678901").is_err()); // only 11 bytes nonce
    }

    #[test]
    fn test_parse_v10_invalid_prefix() {
        let bad = b"v11123456789012ciphertext";
        assert!(parse_v10_payload(bad).is_err());
    }

    #[test]
    fn test_v10_encrypt_decrypt_aes_gcm() {
        let key = [42u8; 32];
        let plaintext = b"secret password for proxy";

        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let nonce_bytes = [7u8; 12];
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();

        let mut payload = Vec::new();
        payload.extend_from_slice(b"v10");
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);

        let decrypted = decrypt_v10_with_key(&key, &payload).expect("decrypt v10");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    #[cfg(windows)]
    fn test_dpapi_roundtrip_windows() {
        if !is_available() {
            return;
        }
        let original = b"NullTrace DPAPI test secret value 12345";
        let encrypted = dpapi_encrypt(original).expect("dpapi encrypt");
        assert_ne!(encrypted, original);
        let decrypted = dpapi_decrypt(&encrypted).expect("dpapi decrypt");
        assert_eq!(decrypted, original);
    }
    #[test]
    #[cfg(windows)]
    fn test_electron_safe_storage_fixture_decryption() {
        // The fixture is encrypted using DPAPI for the local Windows user who generated it.
        // On a different host or CI runner, DPAPI CryptUnprotectData will return an error (Access Denied).
        // Run strictly when NULLTRACE_DPAPI_FIXTURE=1, or skip gracefully if DPAPI cannot decrypt on this host.
        let run_strict = std::env::var("NULLTRACE_DPAPI_FIXTURE").map(|v| v == "1").unwrap_or(false);

        let local_state_json = r#"{"os_crypt":{"audit_enabled":true,"encrypted_key":"RFBBUEkBAAAA0Iyd3wEV0RGMegDAT8KX6wEAAADazN4TumFuSLXmJNg5XjfUEAAAABIAAABDAGgAcgBvAG0AaQB1AG0AAAAQZgAAAAEAACAAAABPFxntjp0eZW3fpO79q9+zP6BE3aX+wB9CowzFe8d8ogAAAAAOgAAAAAIAACAAAAB+sPm6I9Lh9xfu5W5DhGcUrtgDS3P0O0qYnd0mzwiWhDAAAAAcT7BsNYoSwdNPceKgN8vJ4+vFnay/2P1bk8/1CivpAvT2bFYHQQlPoYfrjvMiCZtAAAAA1mGw0+TT6VwcED87xFbU2Ofi+n9U9AstzGtinnwIsdCVoAiKXxflAIQU/xP0UWr5YC8s9m2i1KbP1FcN9QS72w=="},"uninstall_metrics":{"installation_date2":"1788551819"}}"#;
        let electron_probe_b64 = "djEw0aDPNDz+maCYAf8DhxrCXM5bz8AdJper5yTabV6SwNM5lxjCSM2Y68b9UTjBigPTnw==";
        let payload = STANDARD.decode(electron_probe_b64).expect("valid base64 probe payload");

        match safe_storage_decrypt(local_state_json, &payload) {
            Ok(decrypted) => {
                assert_eq!(String::from_utf8_lossy(&decrypted), "nulltrace-probe-value");

                // Also verify round-trip with safe_storage_encrypt
                let re_encrypted = safe_storage_encrypt(local_state_json, b"round-trip-probe")
                    .expect("safe_storage_encrypt should succeed");
                let round_trip_decrypted = safe_storage_decrypt(local_state_json, &re_encrypted)
                    .expect("safe_storage_decrypt on round-trip payload should succeed");
                assert_eq!(String::from_utf8_lossy(&round_trip_decrypted), "round-trip-probe");
            }
            Err(err) => {
                if run_strict {
                    panic!("safe_storage_decrypt failed on genuine Electron fixture: {err}");
                } else {
                    eprintln!("Skipping host-bound Electron DPAPI fixture test on this environment: {err}");
                }
            }
        }
    }
}
