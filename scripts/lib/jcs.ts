/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
 * 
 * Rules:
 * 1. Primitive serialization according to ECMAScript standard (NaN/Infinity -> null or error, -0 -> 0).
 * 2. Object keys sorted by UTF-16 code units (lexicographical byte order of UTF-8 strings).
 * 3. No whitespace between elements, colons, commas.
 * 4. Strings escaped per standard JSON rules (control chars \u00xx, quotes, backslashes).
 */

export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;

  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      return 'null';
    }
    if (Object.is(value, -0)) {
      return '0';
    }
    return JSON.stringify(value);
  }

  if (type === 'string') {
    return JSON.stringify(value);
  }

  if (type === 'bigint') {
    throw new TypeError('BigInt is not supported in RFC 8785 canonical JSON');
  }

  if (type === 'symbol' || type === 'function' || type === 'undefined') {
    return 'null';
  }

  if (Array.isArray(value)) {
    const serializedElements = value.map((elem) => {
      if (typeof elem === 'undefined' || typeof elem === 'symbol' || typeof elem === 'function') {
        return 'null';
      }
      return canonicalizeJson(elem);
    });
    return `[${serializedElements.join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // In JCS, object keys are sorted by their UTF-16 code units (standard JavaScript sort)
    const sortedKeys = Object.keys(obj).sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    const entries: string[] = [];
    for (const key of sortedKeys) {
      const val = obj[key];
      if (typeof val === 'undefined' || typeof val === 'symbol' || typeof val === 'function') {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalizeJson(val)}`);
    }
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

export function canonicalJsonSha256(value: unknown): string {
  const { createHash } = require('crypto');
  const canonical = canonicalizeJson(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
