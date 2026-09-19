// Verify the PUBLISHED 0.6.13 portable artefact against its signature, using only the public key
// embedded in `tauri.conf.json`. This is the check the other machine performs before installing:
// if it passes here, it passes there.
//
// Usage:
//   node scripts/verify-release-signature.cjs <artefact> <artefact.sig> src-tauri/tauri.conf.json
//
// Tauri's updater uses minisign. The signature blob base64-decodes to a minisign signature file:
//
//   untrusted comment: signature from tauri secret key
//   <base64: 2-byte sig alg | 8-byte key id | 64-byte Ed25519 signature>
//   trusted comment: timestamp:<unix>\tfile:<name>
//   <base64: 64-byte Ed25519 signature over the trusted comment>
//
// The signed message is the artefact's raw bytes. Node has Ed25519 in `crypto`, so this needs no
// dependency and no network: it is a genuine independent verification, not a re-run of our tool.
const crypto = require('crypto');
const fs = require('fs');

const ARTEFACT = process.argv[2];
const SIGFILE = process.argv[3];
const CONFIG = process.argv[4];

if (!ARTEFACT || !SIGFILE || !CONFIG) {
  console.error('usage: node verify-published-signature.cjs <artefact> <sigfile> <tauri.conf.json>');
  process.exit(2);
}

const conf = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const pubText = Buffer.from(conf.plugins.updater.pubkey, 'base64').toString('utf8');
const pubLine = pubText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('untrusted comment'))[0];
const pubRaw = Buffer.from(pubLine, 'base64');
const pubAlg = pubRaw.subarray(0, 2).toString('ascii');
const pubKeyId = pubRaw.subarray(2, 10).toString('hex').toUpperCase();
const pubKey = pubRaw.subarray(10, 42); // Ed25519 public key is 32 bytes

// The `.sig` asset is the signature file itself, base64-encoded as a single line (this is what
// `tauri signer` emits and what the release publishes). Decode it once to get the text form, then
// parse that.
const sigFileRaw = fs.readFileSync(SIGFILE, 'utf8').trim();
const sigText = sigFileRaw.includes('\n') || sigFileRaw.startsWith('untrusted comment')
  ? sigFileRaw
  : Buffer.from(sigFileRaw, 'base64').toString('utf8');
const sigLines = sigText.split('\n').map((l) => l.trim()).filter(Boolean);
// Line 0 is the "untrusted comment"; line 1 is the signature; line 2 is the trusted comment;
// line 3 is the signature over that comment. The artefact signature is line 1.
const sigB64 = sigLines[1];
const sigRaw = Buffer.from(sigB64, 'base64');
const sigAlg = sigRaw.subarray(0, 2).toString('ascii');
const sigKeyId = sigRaw.subarray(2, 10).toString('hex').toUpperCase();
const signature = sigRaw.subarray(10, 74);

console.log('artefact      :', ARTEFACT.split(/[\\/]/).pop());
console.log('public key alg:', JSON.stringify(pubAlg), 'key id', pubKeyId);
console.log('signature alg :', JSON.stringify(sigAlg), 'key id', sigKeyId);

if (pubKeyId !== sigKeyId) {
  console.log('\nRESULT: REJECTED — the signature was made by a different key than the app trusts');
  process.exit(1);
}

// Ed25519 in Node expects the raw 32-byte public key wrapped in SPKI DER (12-byte prefix).
const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubKey]);
const keyObject = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
const data = fs.readFileSync(ARTEFACT);

// The algorithm marker in the signature decides what was signed, and it is not decoration:
// minisign's "ED" signs the BLAKE2b-512 digest of the file (the modern default, and what Tauri
// emits), while only the legacy "Ed" signs the raw bytes. Verifying raw bytes against an "ED"
// signature fails exactly as if the file were tampered with — which is the wrong conclusion to
// reach about a good release.
const message = sigAlg === 'ED' ? crypto.createHash('blake2b512').update(data).digest() : data;

const ok = crypto.verify(null, message, keyObject, signature);

console.log('artefact size :', data.length, 'bytes');
console.log('signed message:', sigAlg === 'ED' ? 'BLAKE2b-512 digest of the artefact' : 'raw artefact bytes');
console.log('\nRESULT:', ok ? 'VALID — the other machine will accept this update' : 'INVALID — the release would be rejected');
process.exit(ok ? 0 : 1);
