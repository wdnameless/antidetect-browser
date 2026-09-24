// A proxy provider hands the operator ONE line — `login:password@host:port`, sometimes with a
// scheme — while the form asks for host, port, username and password separately. Splitting that by
// hand is where mistakes come from: the port ends up inside the host field, or a password that
// contains `@` splits at the wrong separator.
//
// The cases below are the ones that actually decide whether this is safe to attach to an input the
// operator types into: a bare hostname MUST pass through untouched, and a password containing `@`
// MUST split at the LAST separator rather than the first.
import { describe, it, expect } from 'vitest';
import { parseProxyInput } from '../../src/renderer/src/proxyParse';

describe('parseProxyInput — the provider line', () => {
  it('parses user:pass@host:port', () => {
    expect(parseProxyInput('bcEB84Yv7rcpRk4-country-any-ipv4-true-sid-abc-ttl-24h:secret@lime.proxyhub.team:8080')).toEqual({
      type: undefined,
      host: 'lime.proxyhub.team',
      port: 8080,
      username: 'bcEB84Yv7rcpRk4-country-any-ipv4-true-sid-abc-ttl-24h',
      password: 'secret',
    });
  });

  it('takes the scheme when one is present', () => {
    expect(parseProxyInput('socks5://user:pass@1.2.3.4:1080')).toEqual({
      type: 'socks5',
      host: '1.2.3.4',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
  });

  it('splits on the LAST @, because a password may contain one', () => {
    // Reading the first `@` would leave "b@host:8080" as the host — a failure that surfaces as a
    // network error rather than a parsing error, and sends the operator to the provider.
    const out = parseProxyInput('user:p@ss@host.example.com:8080');
    expect(out?.host).toBe('host.example.com');
    expect(out?.password).toBe('p@ss');
  });

  it('decodes percent-escapes in credentials', () => {
    expect(parseProxyInput('us%40er:pa%3Ass@h.example.com:80')).toMatchObject({
      username: 'us@er',
      password: 'pa:ss',
    });
  });

  it('keeps a literal % that is not an escape sequence', () => {
    expect(parseProxyInput('user:100%pure@h.example.com:80')?.password).toBe('100%pure');
  });

  it('handles bracketed IPv6', () => {
    expect(parseProxyInput('user:pass@[2001:db8::1]:8080')).toMatchObject({
      host: '2001:db8::1',
      port: 8080,
    });
  });

  it('parses host:port with no credentials', () => {
    expect(parseProxyInput('1.2.3.4:1080')).toEqual({ type: undefined, host: '1.2.3.4', port: 1080 });
  });
  it('parses host:port:user:pass (CIS/residential provider export)', () => {
    expect(parseProxyInput('lime.proxyhub.team:8080:bcEB84Yv7rcpRk4:mySecret123')).toEqual({
      type: undefined,
      host: 'lime.proxyhub.team',
      port: 8080,
      username: 'bcEB84Yv7rcpRk4',
      password: 'mySecret123',
    });
  });

  it('parses ip:port:user:pass', () => {
    expect(parseProxyInput('185.199.108.153:8080:login:password')).toEqual({
      type: undefined,
      host: '185.199.108.153',
      port: 8080,
      username: 'login',
      password: 'password',
    });
  });

  it('parses user:pass:host:port (inverted format)', () => {
    expect(parseProxyInput('myuser:mypassword:185.199.108.153:8080')).toEqual({
      type: undefined,
      host: '185.199.108.153',
      port: 8080,
      username: 'myuser',
      password: 'mypassword',
    });
  });

  it('parses alternative delimiters: semicolon, pipe, tab, and spaces', () => {
    const expected = {
      type: undefined,
      host: '185.199.108.153',
      port: 8080,
      username: 'login',
      password: 'password',
    };
    expect(parseProxyInput('185.199.108.153;8080;login;password')).toEqual(expected);
    expect(parseProxyInput('185.199.108.153|8080|login|password')).toEqual(expected);
    expect(parseProxyInput('185.199.108.153\t8080\tlogin\tpassword')).toEqual(expected);
    expect(parseProxyInput('185.199.108.153 8080 login password')).toEqual(expected);
  });

  it('parses scheme with host:port:user:pass', () => {
    expect(parseProxyInput('socks5://lime.proxyhub.team:8080:myuser:mypass')).toEqual({
      type: 'socks5',
      host: 'lime.proxyhub.team',
      port: 8080,
      username: 'myuser',
      password: 'mypass',
    });
    expect(parseProxyInput('http://1.2.3.4:3128:user:pass')).toEqual({
      type: 'http',
      host: '1.2.3.4',
      port: 3128,
      username: 'user',
      password: 'pass',
    });
  });

  it('parses 3-part format host:port:user without password', () => {
    expect(parseProxyInput('1.2.3.4:8080:useronly')).toEqual({
      type: undefined,
      host: '1.2.3.4',
      port: 8080,
      username: 'useronly',
    });
  });
});

describe('parseProxyInput — what it must NOT touch', () => {
  it('leaves a bare hostname alone', () => {
    // This is the ordinary case for the host field; treating it as a paste would be a bug.
    expect(parseProxyInput('proxy.example.com')).toBeNull();
    expect(parseProxyInput('1.2.3.4')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseProxyInput('')).toBeNull();
    expect(parseProxyInput('   ')).toBeNull();
  });

  it('does not invent a port from a colon that has none', () => {
    // `host:` and `host:abc` are not host:port pairs.
    expect(parseProxyInput('proxy.example.com:')).toBeNull();
    expect(parseProxyInput('proxy.example.com:abc')).toBeNull();
  });
});
