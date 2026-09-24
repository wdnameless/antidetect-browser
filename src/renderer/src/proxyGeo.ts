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
 * `code` leads and is what the flag comes from; `country`/`city` are the readable place. A row
 * resolved before the code existed still shows its name, just without a flag, rather than
 * pretending it has no location. Everything is tolerated as missing: a row with only a city, or
 * only a timezone, is still more useful than the protocol name this replaced.
 */
export function geoLabel(parts: {
  code?: string | null;
  country?: string | null;
  city?: string | null;
  timezone?: string | null;
}): string {
  const flag = flagOf(parts.code);
  const place = [parts.country, parts.city].filter(Boolean).join(' · ');
  // With no name the code carries the label on its own, so a two-letter answer never renders as
  // an empty cell.
  const text = place || parts.code?.trim().toUpperCase() || '';
  const label = [flag, text].filter(Boolean).join(' ');
  if (!label && parts.timezone) return parts.timezone;
  return label;
}
