// The profiles table shows WHERE a proxy exits; it used to show the protocol name, which is a
// property of the proxy rather than the thing an operator scans that column for. The fallbacks
// below are the part that can go wrong quietly: an unresolved proxy, or a country whose code was
// never stored, must degrade to something true rather than to a broken glyph or an invented place.
//
// The two fields are separate on purpose. The flag comes from the ISO CODE, the cell's text from
// the display NAME — and an earlier revision asked `flagOf` for a flag from the name, which is why
// no flag ever appeared next to a real checked proxy even though the feature reported success.
import { describe, it, expect } from 'vitest';
import { flagOf, geoLabel } from '../../src/renderer/src/proxyGeo';

describe('flagOf', () => {
  it('derives the flag from a two-letter code', () => {
    expect(flagOf('DE')).toBe('\u{1F1E9}\u{1F1EA}');
    expect(flagOf('us')).toBe('\u{1F1FA}\u{1F1F8}');
  });

  it('returns nothing for a country NAME, which is not a code', () => {
    // The geo lookup stores a display name in `country` ("Germany"), and callers have passed that
    // value here by mistake. It must render as nothing rather than as a broken box, which is what
    // makes the name-versus-code split enforceable rather than merely documented.
    expect(flagOf('Germany')).toBe('');
    expect(flagOf('')).toBe('');
    expect(flagOf(null)).toBe('');
    expect(flagOf(undefined)).toBe('');
  });
});

describe('geoLabel', () => {
  it('flags the code and names the place', () => {
    expect(geoLabel({ code: 'DE', country: 'Germany', city: 'Berlin' })).toBe('\u{1F1E9}\u{1F1EA} Germany · Berlin');
  });

  it('shows the code alone when no name was resolved, never an empty cell', () => {
    expect(geoLabel({ code: 'DE' })).toBe('\u{1F1E9}\u{1F1EA} DE');
  });

  it('still shows a name resolved before the code existed, just without a flag', () => {
    // Rows written before `country_code` existed are exactly this shape. They must keep showing
    // where they exit rather than reading as unresolved.
    expect(geoLabel({ country: 'Germany', city: 'Berlin' })).toBe('Germany · Berlin');
  });

  it('shows a city alone when that is all that resolved', () => {
    expect(geoLabel({ code: null, country: null, city: 'Amsterdam' })).toBe('Amsterdam');
  });

  it('falls back to the timezone when there is no place', () => {
    expect(geoLabel({ timezone: 'Europe/Berlin' })).toBe('Europe/Berlin');
  });

  it('returns empty when nothing resolved, so the caller can name the transport instead', () => {
    expect(geoLabel({})).toBe('');
    expect(geoLabel({ code: null, country: null, city: null, timezone: null })).toBe('');
  });
});
