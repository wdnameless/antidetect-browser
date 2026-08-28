// Secret protection for proxy credentials stored in the DB (v0.2.20).
//
// Stored format (priority order):
//   "enc:<base64>" — DPAPI via electron.safeStorage (Electron main process)
//   "aes:<base64>" — AES-256-GCM with a machine-local key file
//                    (DATA_DIR/secret.key, generated once, mode 0600) — used
//                    when running standalone (`npm run service`) or in server
//                    mode, where Electron's safeStorage is unavailable
//   "plain:<text>" — last-resort fallback (never used when a key file exists)
//
// Values without a prefix are legacy plaintext from older versions — read
// transparently, re-encrypted on the next write.
//
// The DPAPI cipher is injected by the Electron main process after
// app.whenReady() (the backend itself never imports Electron at module load —
// see ADR-007 module-system note in electron/main.ts).

import * as fs from 'fs';
import * as path from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DATA_DIR } from '../config';

export interface SecretCipher {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

let cipher: SecretCipher | null = null;
let fileCipher: SecretCipher | null = null;

export function setSecretCipher(c: SecretCipher): void {
  cipher = c;
}

export function hasSecretCipher(): boolean {
  return cipher !== null;
}

/** Reset both ciphers (used by tests; also forces key-file re-read). */
export function resetSecretCiphers(): void {
  cipher = null;
  fileCipher = null;
}

/** AES-256-GCM cipher backed by DATA_DIR/secret.key (created on first use). */
function getFileCipher(): SecretCipher | null {
  if (fileCipher) return fileCipher;
  try {
    const keyFile = path.join(DATA_DIR, 'secret.key');
    let keyHex: string;
    if (fs.existsSync(keyFile)) {
      keyHex = fs.readFileSync(keyFile, 'utf8').trim();
    } else {
      keyHex = randomBytes(32).toString('hex');
      fs.writeFileSync(keyFile, keyHex, { encoding: 'utf8', mode: 0o600 });
    }
    const key = Buffer.from(keyHex, 'hex');
    fileCipher = {
      encrypt(plain: string): Buffer {
        const iv = randomBytes(12);
        const c = createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), enc]);
      },
      decrypt(data: Buffer): string {
        const iv = data.subarray(0, 12);
        const tag = data.subarray(12, 28);
        const enc = data.subarray(28);
        const d = createDecipheriv('aes-256-gcm', key, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
      },
    };
    return fileCipher;
  } catch {
    return null;
  }
}

/** Encrypt a secret for storage. Returns null for empty input. */
export function protectSecret(plain?: string | null): string | null {
  if (plain === undefined || plain === null || plain === '') return null;
  if (cipher) {
    try {
      return 'enc:' + cipher.encrypt(plain).toString('base64');
    } catch {
      // fall through to the file cipher
    }
  }
  const fc = getFileCipher();
  if (fc) {
    try {
      return 'aes:' + fc.encrypt(plain).toString('base64');
    } catch {
      // fall through to plaintext marker
    }
  }
  return 'plain:' + plain;
}

/** Decrypt a stored secret. Returns undefined when unreadable. */
export function revealSecret(stored?: string | null): string | undefined {
  if (stored === undefined || stored === null || stored === '') return undefined;
  if (stored.startsWith('enc:')) {
    if (!cipher) {
      console.error('[secrets] encrypted value found but no cipher available (run inside Electron)');
      return undefined;
    }
    try {
      return cipher.decrypt(Buffer.from(stored.slice(4), 'base64'));
    } catch {
      console.error('[secrets] failed to decrypt a stored secret');
      return undefined;
    }
  }
  if (stored.startsWith('aes:')) {
    const fc = getFileCipher();
    if (!fc) {
      console.error('[secrets] aes value found but no key file available');
      return undefined;
    }
    try {
      return fc.decrypt(Buffer.from(stored.slice(4), 'base64'));
    } catch {
      console.error('[secrets] failed to decrypt an aes secret');
      return undefined;
    }
  }
  // legacy plaintext or explicit "plain:" marker
  return stored.replace(/^plain:/, '');
}
