//! Verify a minisign signature produced by `tauri signer sign` — the format
//! `tauri-plugin-updater` requires for `<artefact>.sig` in a release.
//!
//! Run: cargo run --example verify_minisign -- <pubkey-b64> <sig-file> <artefact-file>
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: verify_minisign <public-key-base64> <signature-file> <artefact>");
        return ExitCode::from(2);
    }
    // The public key comes from `tauri.conf.json` (`plugins.updater.pubkey`), which stores
    // the whole two-line minisign key text base64-encoded. `tauri signer generate` writes its
    // `.pub` file in exactly the same shape, so the argument may be either that wrapped text
    // or the equivalent file. Decoding it yields the standard minisign key block.
    let key_text = base64_to_text(args[1].trim());
    let key = match minisign_verify::PublicKey::decode(&key_text) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("public key decode failed: {e}");
            return ExitCode::FAILURE;
        }
    };

    let sig_text = match std::fs::read_to_string(&args[2]) {
        Ok(s) => s,
        Err(e) => { eprintln!("cannot read signature: {e}"); return ExitCode::FAILURE; }
    };
    // Tauri wraps BOTH the key and the signature one extra time in base64, so unwrap before
    // parsing. `base64_to_text` is a no-op on input that is already plain text.
    let sig_text = base64_to_text(sig_text.trim());
    let sig = match minisign_verify::Signature::decode(&sig_text) {
        Ok(s) => s,
        Err(e) => { eprintln!("signature decode failed: {e}"); return ExitCode::FAILURE; }
    };
    let data = match std::fs::read(&args[3]) {
        Ok(d) => d,
        Err(e) => { eprintln!("cannot read artefact: {e}"); return ExitCode::FAILURE; }
    };
    match key.verify(&data, &sig, false) {
        Ok(()) => { println!("SIGNATURE VALID"); ExitCode::SUCCESS }
        Err(e) => { eprintln!("SIGNATURE INVALID: {e}"); ExitCode::FAILURE }
    }
}

/// Decode the standard base64 alphabet (padded). Returns the input unchanged if it is not
/// valid base64, so a caller that already holds plain key text still works.
fn base64_to_text(input: &str) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, c) in ALPHABET.iter().enumerate() {
        lookup[*c as usize] = i as u8;
    }
    let mut out = Vec::new();
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for ch in input.bytes() {
        if ch == b'=' || ch == b'\n' || ch == b'\r' || ch == b' ' {
            continue;
        }
        let v = lookup[ch as usize];
        if v == 255 {
            return input.to_string();
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    match String::from_utf8(out) {
        Ok(s) if s.contains("minisign") || s.contains("trusted comment") => s,
        _ => input.to_string(),
    }
}
