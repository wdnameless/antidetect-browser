// Secret protection for proxy credentials stored in the DB (v0.2.20).
//
// Stored format: "enc:<base64>" (DPAPI via electron.safeStorage) or
// "plain:<text>" (fallback when safeStorage is unavailable, e.g. the backend
// running standalone via `npm run service`). Values without a prefix are
// legacy plaintext from older versions — read transparently, re-encrypted
// on the next write.
//
// The cipher is injected by the Electron main process after app.whenReady()
// (the backend itself never imports Electron at module load — see ADR-007
// module-system note in electron/main.ts).

export interface SecretCipher {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

let cipher: SecretCipher | null = null;

export function setSecretCipher(c: SecretCipher): void {
  cipher = c;
}

export function hasSecretCipher(): boolean {
  return cipher !== null;
}

/** Encrypt a secret for storage. Returns null for empty input. */
export function protectSecret(plain?: string | null): string | null {
  if (plain === undefined || plain === null || plain === '') return null;
  if (cipher) {
    try {
      return 'enc:' + cipher.encrypt(plain).toString('base64');
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
  // legacy plaintext or explicit "plain:" marker
  return stored.replace(/^plain:/, '');
}
