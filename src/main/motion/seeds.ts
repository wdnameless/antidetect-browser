import * as crypto from 'crypto';
import { HMAC_SECRET, MIN_SEED, MAX_SEED } from '../fingerprints/derivation';

/**
 * Derives a deterministic motor sub-seed from a profile primary seed.
 * Uses HMAC-SHA256 with the 'motor' domain, returning a positive 31-bit integer.
 */
export function deriveMotorSeed(profileSeed: number): number {
  const safeSeed = Math.max(MIN_SEED, Math.min(MAX_SEED, profileSeed >>> 0 || 1));
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(`${safeSeed}:motor`);
  const digest = hmac.digest();
  const rawVal = digest.readUInt32BE(0);
  const positive31 = (rawVal & 0x7fffffff) >>> 0;
  return positive31 === 0 ? 1 : positive31;
}
