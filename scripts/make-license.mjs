#!/usr/bin/env node
// Dev tooling: generate a signed Pro license key with the Ed25519 dev keypair.
//
// Usage:
//   LICENSE_PRIVATE_KEY="$(cat dev-key.pem)" node scripts/make-license.mjs dev@example.com
//   LICENSE_PRIVATE_KEY="$(cat dev-key.pem)" node scripts/make-license.mjs dev@example.com 2027-12-31
//
// The payload is {plan:"pro", email?, exp?} signed with Ed25519; the app
// validates it offline against the pinned public key in
// src/main/licensing/publicKey.ts.

import { sign } from 'node:crypto';

const priv = process.env.LICENSE_PRIVATE_KEY;
if (!priv) {
  console.error('Set LICENSE_PRIVATE_KEY (PKCS8 PEM) in the environment. See .env.example.');
  process.exit(1);
}

const email = process.argv[2];
const expArg = process.argv[3];
const payload = { plan: 'pro' };
if (email) payload.email = email;
if (expArg) {
  const exp = Math.floor(new Date(expArg).getTime() / 1000);
  if (!Number.isFinite(exp)) {
    console.error('exp must be a date like 2027-12-31');
    process.exit(1);
  }
  payload.exp = exp;
}

const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
const sig = sign(null, payloadBuf, priv);
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log(`${b64u(payloadBuf)}.${b64u(sig)}`);