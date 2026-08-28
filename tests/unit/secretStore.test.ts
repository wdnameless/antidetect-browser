// Tests for the secret store: AES-256-GCM file-cipher fallback (used when
// Electron safeStorage is unavailable, e.g. standalone/server mode).
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { protectSecret, revealSecret, setSecretCipher, resetSecretCiphers } from '../../src/main/util/secretStore';
import { DATA_DIR } from '../../src/main/config';

beforeEach(() => {
  resetSecretCiphers(); // drop DPAPI + cached file cipher; key file is lazy
  try {
    fs.rmSync(path.join(DATA_DIR, 'secret.key'), { force: true });
  } catch {
    // ignore
  }
});

describe('secretStore AES fallback', () => {
  it('encrypts with aes: prefix and decrypts back', () => {
    const stored = protectSecret('proxy-password-123');
    expect(stored).toMatch(/^aes:/);
    expect(stored).not.toContain('proxy-password-123');
    expect(revealSecret(stored)).toBe('proxy-password-123');
  });

  it('creates a key file on first use and reuses it', () => {
    const keyFile = path.join(DATA_DIR, 'secret.key');
    expect(fs.existsSync(keyFile)).toBe(false);
    const a = protectSecret('s1');
    const b = protectSecret('s2');
    expect(fs.existsSync(keyFile)).toBe(true);
    expect(revealSecret(a)).toBe('s1');
    expect(revealSecret(b)).toBe('s2');
  });

  it('returns undefined for unreadable values', () => {
    expect(revealSecret('aes:garbage')).toBeUndefined();
    expect(revealSecret(undefined)).toBeUndefined();
    expect(revealSecret('')).toBeUndefined();
  });

  it('still reads legacy plaintext markers', () => {
    expect(revealSecret('plain:old-pass')).toBe('old-pass');
    expect(revealSecret('no-prefix-value')).toBe('no-prefix-value');
  });
});
