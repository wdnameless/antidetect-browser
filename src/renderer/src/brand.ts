// Product identity — the single definition of the name and taglines.
//
// Everything user-visible reads from here so the identity cannot drift into
// scattered literals. Deliberately NOT included: any identifier whose value
// carries cryptographic meaning or locates on-disk state. See `KEEP` below.
//
// KEEP (data / cryptographic compatibility — do NOT "finish" this rename):
//   - fingerprints/derivation.ts  HMAC_SECRET            (seeds every fingerprint)
//   - security/signing.ts         SIGNING_DOMAIN_PREFIX  (verifies signed releases)
//   - config.ts                   DATA_DIR / DB_PATH     (locates existing installs)
//   - backup filenames, instance-lock exe name, ANTIDETECT_* env vars
// Renaming any of those silently re-seeds fingerprints or orphans a user's data.

export const PRODUCT_NAME = 'NullTrace';

/** Primary tagline — the product's main line. */
export const TAGLINE_PRIMARY = 'Zero footprint, infinite scale.';

/** Supporting line — secondary contexts (subheading, social, splash). */
export const TAGLINE_SECONDARY = 'Leave nothing behind.';
