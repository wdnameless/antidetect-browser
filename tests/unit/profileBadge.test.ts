import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/main/db';
import {
  normalizeProfileColor,
  deriveBadgeInitials,
  formatBadgeTitlePrefix,
  createProfile,
  updateProfile,
  getProfileDetails,
} from '../../src/main/profiles/profileManager';

describe('profile window badge (parity program)', () => {
  beforeEach(async () => {
    closeDb();
    await initDb();
  });

  afterEach(() => closeDb());

  it('normalizes 3/6-digit hex colors and rejects invalid ones', () => {
    expect(normalizeProfileColor('#abc')).toBe('#aabbcc');
    expect(normalizeProfileColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeProfileColor('abc')).toBe('#aabbcc');
    expect(normalizeProfileColor('aabbcc')).toBe('#aabbcc');
    expect(normalizeProfileColor('#aabb')).toBeNull();
    expect(normalizeProfileColor('notahex')).toBeNull();
    expect(normalizeProfileColor(undefined)).toBeNull();
  });

  it('derives initials from names: unicode, alnum-only, empty fallback', () => {
    expect(deriveBadgeInitials('kz-01')).toBe('KZ');
    expect(deriveBadgeInitials('  inst a  ')).toBe('IN');
    expect(deriveBadgeInitials('élan final')).toBe('ÉL');
    expect(deriveBadgeInitials('')).toBe('P');
    expect(deriveBadgeInitials('   ')).toBe('P');
    expect(deriveBadgeInitials('!!!')).toBe('P');
  });

  it('formats the window title prefix', () => {
    expect(formatBadgeTitlePrefix('#2FCB80', 'kz-01')).toBe('[KZ] ');
    expect(formatBadgeTitlePrefix(null, 'kz-01')).toBe('');
  });

  it('create accepts a valid color, rejects an invalid one', () => {
    const ok = createProfile({ name: 'kz-01', color: '#2FCB80' });
    expect(getProfileDetails(ok)?.color).toBe('#2fcb80');

    expect(() => createProfile({ name: 'bad', color: 'zzz' })).toThrowError(/color/i);
  });

  it('update accepts color and clears it with null; old rows keep null', () => {
    const id = createProfile({ name: 'legacy' });
    expect(getProfileDetails(id)?.color).toBeNull();

    expect(updateProfile(id, { color: '#abc' })).toBe(true);
    expect(getProfileDetails(id)?.color).toBe('#aabbcc');

    expect(() => updateProfile(id, { color: '#12g' })).toThrowError(/color/i);
    expect(updateProfile(id, { color: null })).toBe(true);
    expect(getProfileDetails(id)?.color).toBeNull();
  });
});