import { describe, it, expect } from 'vitest';
import { sha256 } from '../../src/main/scripts/scriptCatalog';

// Checksum gating mirrors installFromCatalog: compare computed sha256 with the
// manifest value (case-insensitive) and refuse to store on mismatch.
function checksumMatches(code: string, expected: string): boolean {
  return sha256(code).toLowerCase() === String(expected || '').toLowerCase();
}

describe('catalog checksum verification (Sprint 4.4)', () => {
  it('sha256 is a stable lowercase hex digest', () => {
    const h = sha256('console.log("hi")');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('console.log("hi")')).toBe(h); // deterministic
    expect(sha256('console.log("hi") ')).not.toBe(h); // whitespace matters
  });

  it('matching checksum passes the gate', () => {
    const code = 'app.log("install-me")';
    const expected = sha256(code);
    expect(checksumMatches(code, expected)).toBe(true);
  });

  it('checksum comparison is case-insensitive (manifests may use uppercase)', () => {
    const code = 'const x = 1;';
    const upper = sha256(code).toUpperCase();
    expect(checksumMatches(code, upper)).toBe(true);
  });

  it('tampered code fails the check (CHECKSUM_MISMATCH condition)', () => {
    const expected = sha256('const x = 1;');
    const tampered = 'const x = 2; // backdoored';
    expect(checksumMatches(tampered, expected)).toBe(false);
  });

  it('empty/missing checksum in the manifest never matches', () => {
    expect(checksumMatches('anything', '')).toBe(false);
    expect(checksumMatches('anything', 'undefined')).toBe(false);
  });

  it('unicode content hashes correctly (utf8)', () => {
    const code = 'const s = "привет мир 🚀";';
    expect(checksumMatches(code, sha256(code))).toBe(true);
    expect(sha256(code)).toHaveLength(64);
  });
});