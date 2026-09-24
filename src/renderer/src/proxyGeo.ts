/**
 * Presentation of a proxy's resolved geography.
 *
 * Both the Proxies page and the profiles table show where a proxy exits, and they must agree on
 * how: a stored `country` is a display name from the geo lookup ("Germany"), while the flag is
 * derived from an ISO code, and the two can disagree for a value that is a code rather than a
 * name. One module keeps that decision in one place instead of two cells drifting apart.
 */

/**
 * Flag emoji for an ISO country code, computed rather than stored: the regional-indicator symbols
 * are derived from the letters, so no image assets and no dependency are needed. Returns an empty
 * string for anything that is not a two-letter code, so a malformed value renders as nothing
 * rather than as a broken box.
 */
export function flagOf(country: string | null | undefined): string {
  if (!country) return '';
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/**
 * The geography a profile or proxy row should show, or an empty list when nothing was resolved.
 *
 * Deliberately tolerant of a missing country: a row whose proxy has only a city is still more
 * useful with the city than with the protocol name it replaces.
 */
export function geoLabel(parts: {
  country?: string | null;
  city?: string | null;
  timezone?: string | null;
}): string {
  const flag = flagOf(parts.country);
  const place = [parts.country, parts.city].filter(Boolean).join(' · ');
  const label = [flag, place].filter(Boolean).join(' ');
  // A timezone alone is still geography; showing it beats showing nothing.
  if (!label && parts.timezone) return parts.timezone;
  return label;
}
