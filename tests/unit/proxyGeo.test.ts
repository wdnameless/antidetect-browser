// The profiles table shows WHERE a proxy exits; it used to show the protocol name, which is a
// property of the proxy rather than the thing an operator scans that column for. The fallbacks
// below are the part that can go wrong quietly: an unresolved proxy or a country stored as
// something that is not an ISO code must degrade to the transport name, never to a broken glyph
// or to a location nobody measured.
import { describe, it, expect } from 'vitest';
import { flagOf, geoLabel } from '../../src/renderer/src/proxyGeo';

describe('flagOf', () => {
  it('derives the flag from a two-letter code', () => {
    expect(flagOf('DE')).toBe('\u{1F1E9}\u{1F1EA}');
    expect(flagOf('us')).toBe('\u{1F1FA}\u{1F1F8}');
  });

  it('returns nothing for a country NAME, which is not a code', () => {
    // The geo lookup stores a display name ("Germany"), so the common case must not render a
    // broken box where a flag would be.
    expect(flagOf('Germany')).toBe('');
    expect(flagOf('')).toBe('');
    expect(flagOf(null)).toBe('');
    expect(flagOf(undefined)).toBe('');
  });
});

describe('geoLabel', () => {
  it('combines country and city', () => {
    expect(geoLabel({ country: 'DE', city: 'Berlin' })).toBe('\u{1F1E9}\u{1F1EA} DE · Berlin');
  });

  it('shows a city alone when that is all that resolved', () => {
    expect(geoLabel({ country: null, city: 'Amsterdam' })).toBe('Amsterdam');
  });

  it('falls back to the timezone when there is no place', () => {
    expect(geoLabel({ timezone: 'Europe/Berlin' })).toBe('Europe/Berlin');
  });

  it('returns empty when nothing resolved, so the caller can name the transport instead', () => {
    expect(geoLabel({})).toBe('');
    expect(geoLabel({ country: null, city: null, timezone: null })).toBe('');
  });
});
