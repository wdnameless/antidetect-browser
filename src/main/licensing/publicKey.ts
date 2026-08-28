// Pinned Ed25519 public key for offline license validation.
// The matching PRIVATE KEY is NEVER committed. Developers generate a keypair:
//   node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');\
//   console.log(publicKey.export({type:'spki',format:'pem'}));\
//   console.log(privateKey.export({type:'pkcs8',format:'pem'}))"
// Set the private key as LICENSE_PRIVATE_KEY when running scripts/make-license.mjs.
// NOTE: the key below is the Sprint-1 DEV keypair; rotate before public release.
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVxFPPO9Q0RRZZUYacTrT5OnBwit7GcyTpYR/ijc+tsA=
-----END PUBLIC KEY-----`;