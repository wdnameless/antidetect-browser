/**
 * Parsing a proxy the way an operator actually receives it.
 *
 * Providers hand out a single line — `login:password@ip:port`, often with a scheme or a country
 * marker in front — while the form asks for host, port, username and password separately. Making
 * the operator take that string apart by hand is where mistakes come from: the port ends up inside
 * the host field, or the password's `@`/`:` gets read as a separator.
 *
 * This parses the whole string into the individual fields. It is deliberately conservative: it
 * only claims a match when the string really looks like a proxy URL, so a plain hostname typed into
 * the same field is left alone rather than mangled.
 */

export interface ParsedProxyInput {
  type?: 'http' | 'https' | 'socks5' | 'ssh';
  host: string;
  port?: number;
  username?: string;
  password?: string;
}

/**
 * Split `user:pass@host` on the LAST `@`.
 *
 * A password may itself contain `@` (URL-encoded or not), and the host never does, so the last
 * separator is the only correct one. Reading the first `@` would put the tail of the password into
 * the hostname — a failure that looks like a network problem rather than a parsing one.
 */
function splitCredentials(rest: string): { userinfo: string; hostport: string } {
  const at = rest.lastIndexOf('@');
  if (at === -1) return { userinfo: '', hostport: rest };
  return { userinfo: rest.slice(0, at), hostport: rest.slice(at + 1) };
}

/** Split `host:port`, tolerating a missing port and bracketed IPv6. */
function splitHostPort(hostport: string): { host: string; port?: number } {
  const v6 = hostport.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    const p = v6[2] ? Number(v6[2]) : undefined;
    return { host: v6[1], port: Number.isInteger(p) ? p : undefined };
  }
  const colon = hostport.lastIndexOf(':');
  if (colon === -1) return { host: hostport };
  const maybePort = hostport.slice(colon + 1);
  // A colon with nothing numeric after it is part of the host, not a port.
  if (!/^\d+$/.test(maybePort)) return { host: hostport };
  return { host: hostport.slice(0, colon), port: Number(maybePort) };
}

/**
 * Parse a proxy URL, or return null when the input is not one.
 *
 * Returns null for a bare hostname (the normal case for the host field), so callers can use this
 * as a "did they paste a full line?" check without a separate guess.
 */
export function parseProxyInput(raw: string): ParsedProxyInput | null {
  const input = raw.trim();
  if (!input) return null;

  let scheme: ParsedProxyInput['type'] | undefined;
  let rest = input;
  const schemeMatch = input.match(/^(https?|socks5|ssh):\/\//i);
  if (schemeMatch) {
    const s = schemeMatch[1].toLowerCase();
    scheme = (s === 'socks5' ? 'socks5' : s === 'ssh' ? 'ssh' : s) as ParsedProxyInput['type'];
    rest = input.slice(schemeMatch[0].length);
  }

  const { userinfo, hostport } = splitCredentials(rest);
  const { host, port } = splitHostPort(hostport);
  if (!host) return null;

  // Require something that makes this unambiguous: a scheme, a port, or credentials. A bare
  // `example.com` must NOT be treated as a paste, because that is what the field is for.
  const looksLikeUrl = Boolean(schemeMatch) || port !== undefined || userinfo.length > 0;
  if (!looksLikeUrl) return null;

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

  const decode = (v: string | undefined): string | undefined => {
    if (v === undefined) return undefined;
    try {
      return decodeURIComponent(v);
    } catch {
      // A literal `%` that is not an escape sequence is still a usable password.
      return v;
    }
  };

  return {
    type: scheme,
    host,
    port,
    username: decode(username),
    password: decode(password),
  };
}
