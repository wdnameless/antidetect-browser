// Regression guard for SOCKS5 UDP address encoding.
//
// THE BUG THIS PINS
// The IPv6 branch stripped colons and hex-decoded the remainder. That yields 16 bytes only for
// a fully-expanded address, so compressed forms produced fewer bytes and then hit a silent
// `else` that wrote sixteen ZERO bytes. The datagram was addressed to `::` — a well-formed
// packet sent nowhere — and nothing raised.
//
// Measured before the fix: `::1` → 0 bytes, `fe80::1` → 2 bytes, `2001:db8::1` → 4 bytes.
//
// The assertions decode the header back and compare actual bytes, because the failure mode was
// producing a VALID-LOOKING packet: a test that only checked "a buffer was returned" would have
// passed against the bug.
import { describe, it, expect } from 'vitest';
import { encapsulateUdpDatagram } from '../../src/main/proxy/udpRelay';

/** Read the ATYP-tagged address out of a SOCKS5 UDP request header. */
function decodeHeader(buf: Buffer): { atyp: number; address: string; port: number } {
  const atyp = buf[3];
  if (atyp === 0x01) {
    return {
      atyp,
      address: `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`,
      port: buf.readUInt16BE(8),
    };
  }
  if (atyp === 0x04) {
    const words: string[] = [];
    for (let i = 0; i < 8; i++) words.push(buf.readUInt16BE(4 + i * 2).toString(16));
    return { atyp, address: words.join(':'), port: buf.readUInt16BE(20) };
  }
  const len = buf[4];
  return { atyp, address: buf.subarray(5, 5 + len).toString('utf8'), port: buf.readUInt16BE(5 + len) };
}

describe('SOCKS5 UDP header encodes the real target address', () => {
  it('encodes a compressed IPv6 loopback as ::1, not ::', () => {
    const buf = encapsulateUdpDatagram('::1', 53, Buffer.from('x'));
    const { atyp, address, port } = decodeHeader(buf);
    expect(atyp).toBe(0x04);
    expect(port).toBe(53);
    const words = address.split(':');
    expect(words.slice(0, 7)).toEqual(['0', '0', '0', '0', '0', '0', '0']);
    expect(words[7]).toBe('1');
  });

  it.each([
    ['fe80::1', 'fe80:0:0:0:0:0:0:1'],
    ['2001:db8::1', '2001:db8:0:0:0:0:0:1'],
    ['2001:db8::', '2001:db8:0:0:0:0:0:0'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0:0:0:0:1'],
  ])('expands %s to the same 16 bytes as its full form', (compressed, expected) => {
    const { address } = decodeHeader(encapsulateUdpDatagram(compressed, 1234, Buffer.from('x')));
    const normalise = (a: string) =>
      a
        .split(':')
        .map((w) => w.replace(/^0+(?=.)/, ''))
        .join(':');
    expect(normalise(address)).toBe(normalise(expected));
  });

  it('handles the IPv4-mapped form', () => {
    const { address } = decodeHeader(encapsulateUdpDatagram('::ffff:192.0.2.1', 80, Buffer.from('x')));
    const words = address.split(':');
    expect(words.slice(0, 5).every((w) => w === '0')).toBe(true);
    expect(words[5]).toBe('ffff');
    // 192.0.2.1 → 0xc000, 0x0201
    expect(words[6]).toBe('c000');
    expect(words[7]).toBe('201');
  });

  it('still encodes IPv4 and domains correctly', () => {
    const v4 = decodeHeader(encapsulateUdpDatagram('203.0.113.7', 443, Buffer.from('x')));
    expect(v4).toEqual({ atyp: 0x01, address: '203.0.113.7', port: 443 });

    const dom = decodeHeader(encapsulateUdpDatagram('example.com', 53, Buffer.from('x')));
    expect(dom.atyp).toBe(0x03);
    expect(dom.address).toBe('example.com');
    expect(dom.port).toBe(53);
  });

  it('never silently writes the unspecified address :: for a real target', () => {
    // The removed behaviour substituted sixteen zero bytes whenever expansion failed, so any
    // input reaching this function produced a well-formed packet addressed to `::`. Every
    // accepted IPv6 form must now expand to something other than all-zeroes (except `::`
    // itself, which IS the unspecified address and must encode as zeroes).
    for (const host of ['::1', 'fe80::1', '2001:db8::1', '::ffff:192.0.2.1']) {
      const { address } = decodeHeader(encapsulateUdpDatagram(host, 53, Buffer.from('x')));
      const allZero = address.split(':').every((w) => Number.parseInt(w || '0', 16) === 0);
      expect(allZero, `${host} must not encode as ::`).toBe(false);
    }

    // And the unspecified address itself still round-trips.
    const { address } = decodeHeader(encapsulateUdpDatagram('::', 53, Buffer.from('x')));
    expect(address.split(':').every((w) => Number.parseInt(w || '0', 16) === 0)).toBe(true);
  });
});
