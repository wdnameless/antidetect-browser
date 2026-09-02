/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
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
