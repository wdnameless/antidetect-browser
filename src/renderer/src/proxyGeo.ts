/**
 * Presentation of a proxy's resolved geography.
 *
 * Both the Proxies page and the profiles table show where a proxy exits, and they must agree on
 * how: the flag and the two-letter label are derived from an ISO code, while the cell's readable
 * part is the provider's display NAME ("Germany"). One module keeps that decision in one place
 * instead of two cells drifting apart.
 *
 * The two values are deliberately separate inputs. A flag CANNOT be derived from a name — the
 * earlier version of this module tried, silently produced nothing for every real row, and that is
 * why the flag never appeared next to a checked proxy.
 */

/**
 * Flag emoji for an ISO country code, computed rather than stored: the regional-indicator symbols
 * are derived from the letters, so no image assets and no dependency are needed. Returns an empty
 * string for anything that is not a two-letter code, so a malformed value renders as nothing
 * rather than as a broken box.
 */
export function flagOf(countryCode: string | null | undefined): string {
  if (!countryCode) return '';
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/**
 * The geography a row should show, or an empty string when nothing was resolved.
 *
 * `code` leads and is what the flag comes from; `country`/`city` are the readable place. The CODE
 * is printed next to the flag, not just the name: the operator scans this column for the two
 * letters (`DE`, `US`, `FR`) and the provider's name only arrived as a side effect of the same
 * lookup. A row resolved before the code existed still shows its name, just without a flag or a
 * code, rather than pretending it has no location. Everything is tolerated as missing: a row with
 * only a city, or only a timezone, is still more useful than the protocol name this replaced.
 */
export function geoLabel(parts: {
  code?: string | null;
  country?: string | null;
  city?: string | null;
  timezone?: string | null;
}): string {
  const flag = flagOf(parts.code);
  // Printed only when `flagOf` accepted the same value, so a malformed code cannot pass as one.
  const raw = typeof parts.code === 'string' ? parts.code.trim().toUpperCase() : '';
  const code = flag ? raw : '';
  const place = [parts.country, parts.city].filter(Boolean).join(' · ');
  const head = [flag, code].filter(Boolean).join(' ');
  const label = [head, place].filter(Boolean).join(' · ');
  if (!label && parts.timezone) return parts.timezone;
  return label;
}
