/**
 * Smart proxy string parsing for any real-world format:
 * - `host:port:user:pass` (common CIS/residential provider export)
 * - `user:pass:host:port`
 * - `user:pass@host:port`
 * - `scheme://...` (http, https, socks5, ssh)
 * - `host:port`
 * - Separators: colon (:), semicolon (;), pipe (|), tab (\t), space
 *
 * Leaves bare hostnames/IPs alone so regular manual typing is not interrupted.
 */

export interface ParsedProxyInput {
  type?: 'http' | 'https' | 'socks5' | 'ssh';
  host: string;
  port?: number;
  username?: string;
  password?: string;
}

function isPort(val: string): boolean {
  if (!val || !/^\d+$/.test(val)) return false;
  const n = Number(val);
  return n >= 1 && n <= 65535;
}

function isHost(val: string): boolean {
  if (!val) return false;
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(val)) return true;
  // Bracketed IPv6
  if (/^\[?[0-9a-fA-F:]+\]?$/.test(val) && val.includes(':')) return true;
  // Domain name with at least one dot
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val)) return true;
  // Common local host names
  if (/^(localhost|ip6-localhost|ip6-loopback)$/i.test(val)) return true;
  return false;
}

function decode(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function parseScheme(prefix: string): ParsedProxyInput['type'] {
  const s = prefix.toLowerCase();
  if (s === 'socks5' || s === 'socks5h') return 'socks5';
  if (s === 'https') return 'https';
  if (s === 'ssh') return 'ssh';
  return 'http';
}

/** Split `host:port`, tolerating a missing port and bracketed IPv6. */
function splitHostPort(hostport: string): { host: string; port?: number } {
  const v6 = hostport.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    return { host: v6[1], port: v6[2] ? Number(v6[2]) : undefined };
  }
  const colon = hostport.lastIndexOf(':');
  if (colon === -1) return { host: hostport };
  const maybePort = hostport.slice(colon + 1);
  if (!/^\d+$/.test(maybePort)) return { host: hostport };
  return { host: hostport.slice(0, colon), port: Number(maybePort) };
}

/**
 * Parse a proxy string in any standard or provider format into individual fields.
 * Returns null for bare hostnames or empty input so normal field typing is preserved.
 */
export function parseProxyInput(raw: string): ParsedProxyInput | null {
  const input = raw.trim();
  if (!input) return null;

  let scheme: ParsedProxyInput['type'] | undefined;
  let rest = input;
  const schemeMatch = input.match(/^([a-zA-Z0-9]+):\/\//i);
  if (schemeMatch) {
    scheme = parseScheme(schemeMatch[1]);
    rest = input.slice(schemeMatch[0].length).trim();
  }
  // Format with '@' (e.g. user:pass@host:port or host:port@user:pass)
  if (rest.includes('@')) {
    const at = rest.lastIndexOf('@');
    const partA = rest.slice(0, at);
    const partB = rest.slice(at + 1);
    const candidateHost = splitHostPort(partB).host;
    let userinfo: string;
    let hostport: string;
    if (isHost(candidateHost) || isPort(partB.slice(partB.lastIndexOf(':') + 1))) {
      userinfo = partA;
      hostport = partB;
    } else {
      userinfo = partB;
      hostport = partA;
    }
    const { host, port } = splitHostPort(hostport);
    if (!host) return null;

    let username: string | undefined;
    let password: string | undefined;
    if (userinfo) {
      const colon = userinfo.indexOf(':');
      if (colon === -1) {
        username = userinfo;
      } else {
        username = userinfo.slice(0, colon);
        password = userinfo.slice(colon + 1);
      }
    }

    return {
      type: scheme,
      host,
      port,
      username: decode(username),
      password: decode(password),
    };
  }

  // Separator-based format: tab, semicolon, pipe, space, or colon
  let sep = ':';
  if (rest.includes('\t')) sep = '\t';
  else if (rest.includes(';')) sep = ';';
  else if (rest.includes('|')) sep = '|';
  else if (rest.includes(' ') && !rest.includes(':')) sep = ' ';

  const parts = (sep === ' ' ? rest.split(/\s+/) : rest.split(sep))
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 4) {
    // Pattern A: host:port:user:pass
    if (isPort(parts[1])) {
      return {
        type: scheme,
        host: parts[0],
        port: Number(parts[1]),
        username: decode(parts[2]),
        password: decode(parts.slice(3).join(sep)),
      };
    }
    // Pattern B: user:pass:host:port
    const lastIdx = parts.length - 1;
    if (isPort(parts[lastIdx]) && isHost(parts[lastIdx - 1])) {
      return {
        type: scheme,
        host: parts[lastIdx - 1],
        port: Number(parts[lastIdx]),
        username: decode(parts[0]),
        password: decode(parts.slice(1, lastIdx - 1).join(sep)),
      };
    }
    // Pattern C: first part is known host/IP
    if (isHost(parts[0])) {
      return {
        type: scheme,
        host: parts[0],
        port: isPort(parts[1]) ? Number(parts[1]) : undefined,
        username: decode(parts[2]),
        password: decode(parts.slice(3).join(sep)),
      };
    }
  }

  if (parts.length === 2) {
    if (isPort(parts[1])) {
      return { type: scheme, host: parts[0], port: Number(parts[1]) };
    }
  }

  if (parts.length === 3) {
    if (isPort(parts[1])) {
      return { type: scheme, host: parts[0], port: Number(parts[1]), username: decode(parts[2]) };
    }
  }

  // Scheme alone with host
  if (scheme && rest) {
    const { host, port } = splitHostPort(rest);
    if (host && isHost(host)) return { type: scheme, host, port };
  }

  return null;
}
