import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import * as dgram from 'dgram';
import {
  encapsulateUdpDatagram,
  decapsulateUdpDatagram,
  createUdpRelaySession,
  probeUdpSupport,
  clearUdpProbeCache,
  getUdpProbeCacheSize,
  getUdpRelayState,
  setUdpRelayState,
  registerUdpRelayState,
  unregisterUdpRelayState,
} from '../../../src/main/proxy/udpRelay';
import {
  composeTransportFlags,
} from '../../../src/main/proxy/transportPolicy';

describe('UDP Relay Core (RFC 1928 SOCKS5 UDP ASSOCIATE)', () => {
  let mockSocksServer: net.Server | undefined;
  let mockUdpRelay: dgram.Socket | undefined;
  let socksPort: number;
  let udpRelayPort: number;

  beforeEach(() => {
    clearUdpProbeCache();
  });

  afterEach(async () => {
    if (mockSocksServer) {
      const server = mockSocksServer;
      mockSocksServer = undefined;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (mockUdpRelay) {
      const socket = mockUdpRelay;
      mockUdpRelay = undefined;
      try {
        socket.close();
      } catch {
        // ignore if already closed
      }
    }
  });

  it('correctly builds and parses SOCKS5 UDP datagram encapsulation', () => {
    const payload = Buffer.from('hello quic');
    const encoded = encapsulateUdpDatagram('1.2.3.4', 443, payload);
    const parsed = decapsulateUdpDatagram(encoded);

    expect(parsed).not.toBeNull();
    expect(parsed.targetHost).toBe('1.2.3.4');
    expect(parsed.targetPort).toBe(443);
    expect(parsed.data.toString()).toBe('hello quic');
  });

  it('correctly parses domain name destination datagrams', () => {
    const payload = Buffer.from('domain packet');
    const encoded = encapsulateUdpDatagram('example.com', 8443, payload);
    const parsed = decapsulateUdpDatagram(encoded);

    expect(parsed).not.toBeNull();
    expect(parsed.targetHost).toBe('example.com');
    expect(parsed.targetPort).toBe(8443);
    expect(parsed.data.toString()).toBe('domain packet');
  });

  it('rejects malformed datagrams (too short or unsupported atyp)', () => {
    expect(() => decapsulateUdpDatagram(Buffer.from([0x00, 0x00]))).toThrow();
    expect(() => decapsulateUdpDatagram(Buffer.from([0x00, 0x00, 0x01, 0x05]))).toThrow();
  });

  it('performs successful SOCKS5 UDP ASSOCIATE handshake with user/pass auth', async () => {
    mockUdpRelay = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => mockUdpRelay!.bind(0, '127.0.0.1', () => resolve()));
    udpRelayPort = mockUdpRelay.address().port;

    mockSocksServer = net.createServer((socket) => {
      let state = 'AUTH_SELECT';
      socket.on('data', (chunk) => {
        if (state === 'AUTH_SELECT') {
          expect(chunk[0]).toBe(0x05);
          socket.write(Buffer.from([0x05, 0x02]));
          state = 'AUTH_VERIFY';
        } else if (state === 'AUTH_VERIFY') {
          expect(chunk[0]).toBe(0x01);
          socket.write(Buffer.from([0x01, 0x00]));
          state = 'COMMAND';
        } else if (state === 'COMMAND') {
          expect(chunk[0]).toBe(0x05);
          expect(chunk[1]).toBe(0x03);
          const rep = Buffer.alloc(10);
          rep[0] = 0x05;
          rep[1] = 0x00;
          rep[2] = 0x00;
          rep[3] = 0x01;
          rep.writeUInt8(127, 4);
          rep.writeUInt8(0, 5);
          rep.writeUInt8(0, 6);
          rep.writeUInt8(1, 7);
          rep.writeUInt16BE(udpRelayPort, 8);
          socket.write(rep);
          state = 'ASSOCIATED';
        }
      });
    });

    await new Promise<void>((resolve) => mockSocksServer!.listen(0, '127.0.0.1', () => resolve()));
    socksPort = (mockSocksServer.address() as net.AddressInfo).port;

    const session = await createUdpRelaySession({
      upstreamHost: '127.0.0.1',
      upstreamPort: socksPort,
      username: 'testuser',
      password: 'testpass',
    });

    expect(session.relayPort).toBe(udpRelayPort);
    expect(session.relayHost).toBe('127.0.0.1');
    expect(session.localPort).toBeGreaterThan(0);
    expect(session.isAlive()).toBe(true);

    await session.close();
    expect(session.isAlive()).toBe(false);
  });

  it('fails with auth-failed when upstream proxy rejects credentials', async () => {
    mockSocksServer = net.createServer((socket) => {
      let state = 'AUTH_SELECT';
      socket.on('data', (chunk) => {
        if (state === 'AUTH_SELECT') {
          socket.write(Buffer.from([0x05, 0x02]));
          state = 'AUTH_VERIFY';
        } else if (state === 'AUTH_VERIFY') {
          socket.write(Buffer.from([0x01, 0x01]));
        }
      });
    });

    await new Promise<void>((resolve) => mockSocksServer!.listen(0, '127.0.0.1', () => resolve()));
    socksPort = (mockSocksServer.address() as net.AddressInfo).port;

    await expect(createUdpRelaySession({
      upstreamHost: '127.0.0.1',
      upstreamPort: socksPort,
      username: 'wrong',
      password: 'bad',
    })).rejects.toThrow(/auth/i);
  });

  it('fails with udp-associate-refused when SOCKS5 returns failure REP', async () => {
    mockSocksServer = net.createServer((socket) => {
      let state = 'AUTH_SELECT';
      socket.on('data', () => {
        if (state === 'AUTH_SELECT') {
          socket.write(Buffer.from([0x05, 0x00]));
          state = 'COMMAND';
        } else if (state === 'COMMAND') {
          socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        }
      });
    });

    await new Promise<void>((resolve) => mockSocksServer!.listen(0, '127.0.0.1', () => resolve()));
    socksPort = (mockSocksServer.address() as net.AddressInfo).port;

    await expect(createUdpRelaySession({
      upstreamHost: '127.0.0.1',
      upstreamPort: socksPort,
    })).rejects.toThrow(/refused/i);
  });

  it('handles idle timeout teardown', async () => {
    mockUdpRelay = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => mockUdpRelay!.bind(0, '127.0.0.1', () => resolve()));
    udpRelayPort = mockUdpRelay.address().port;

    mockSocksServer = net.createServer((socket) => {
      let state = 'AUTH_SELECT';
      socket.on('data', () => {
        if (state === 'AUTH_SELECT') {
          socket.write(Buffer.from([0x05, 0x00]));
          state = 'COMMAND';
        } else if (state === 'COMMAND') {
          const rep = Buffer.alloc(10);
          rep[0] = 0x05;
          rep[1] = 0x00;
          rep[2] = 0x00;
          rep[3] = 0x01;
          rep.writeUInt8(127, 4);
          rep.writeUInt8(0, 5);
          rep.writeUInt8(0, 6);
          rep.writeUInt8(1, 7);
          rep.writeUInt16BE(udpRelayPort, 8);
          socket.write(rep);
        }
      });
    });

    await new Promise<void>((resolve) => mockSocksServer!.listen(0, '127.0.0.1', () => resolve()));
    socksPort = (mockSocksServer.address() as net.AddressInfo).port;

    let teardownReason = '';
    const session = await createUdpRelaySession({
      upstreamHost: '127.0.0.1',
      upstreamPort: socksPort,
      idleTimeoutMs: 40,
      onTeardown: (reason) => {
        teardownReason = reason;
      },
    });

    // Wait for idle teardown to fire
    await new Promise((r) => setTimeout(r, 120));
    expect(teardownReason).toMatch(/idle/i);
    expect(session.isAlive()).toBe(false);
  });
});

describe('UDP Capability Probe & Reason Codes', () => {
  let mockSocksServer: net.Server | undefined;
  let mockUdpRelay: dgram.Socket | undefined;
  let socksPort: number;
  let udpRelayPort: number;

  beforeEach(() => {
    clearUdpProbeCache();
  });

  afterEach(async () => {
    if (mockSocksServer) {
      const server = mockSocksServer;
      mockSocksServer = undefined;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (mockUdpRelay) {
      const socket = mockUdpRelay;
      mockUdpRelay = undefined;
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  });

  it('maps network-unreachable when connecting to closed port', async () => {
    const res = await probeUdpSupport({
      host: '127.0.0.1',
      port: 59999,
    });

    expect(res.supported).toBe(false);
    expect(res.reason).toBe('network-unreachable');
  });

  it('maps auth-failed on bad credentials', async () => {
    mockSocksServer = net.createServer((socket) => {
      let state = 'AUTH_SELECT';
      socket.on('data', () => {
        if (state === 'AUTH_SELECT') {
          socket.write(Buffer.from([0x05, 0x02]));
          state = 'AUTH_VERIFY';
        } else if (state === 'AUTH_VERIFY') {
          socket.write(Buffer.from([0x01, 0x01]));
        }
      });
    });

    await new Promise<void>((resolve) => mockSocksServer!.listen(0, '127.0.0.1', () => resolve()));
    socksPort = (mockSocksServer.address() as net.AddressInfo).port;

    const res = await probeUdpSupport({
      host: '127.0.0.1',
      port: socksPort,
      username: 'user',
      password: 'bad',
    });

    expect(res.supported).toBe(false);
    expect(res.reason).toBe('auth-failed');
  });

  it('maps udp-associate-refused when proxy rejects UDP ASSOCIATE', async () => {
    mockSocksServer = net.createServer((socket) => {
      let state = 'AUTH_SELECT';
      socket.on('data', () => {
        if (state === 'AUTH_SELECT') {
          socket.write(Buffer.from([0x05, 0x00]));
          state = 'COMMAND';
        } else if (state === 'COMMAND') {
          socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        }
      });
    });

    await new Promise<void>((resolve) => mockSocksServer!.listen(0, '127.0.0.1', () => resolve()));
    socksPort = (mockSocksServer.address() as net.AddressInfo).port;

    const res = await probeUdpSupport({
      host: '127.0.0.1',
      port: socksPort,
    });

    expect(res.supported).toBe(false);
    expect(res.reason).toBe('udp-associate-refused');
  });

  it('maps stun-timeout when STUN server does not answer through the relay', async () => {
    mockUdpRelay = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => mockUdpRelay!.bind(0, '127.0.0.1', () => resolve()));
    udpRelayPort = mockUdpRelay.address().port;

    mockSocksServer = net.createServer((socket) => {
      let state = 'AUTH_SELECT';
      socket.on('data', () => {
        if (state === 'AUTH_SELECT') {
          socket.write(Buffer.from([0x05, 0x00]));
          state = 'COMMAND';
        } else if (state === 'COMMAND') {
          const rep = Buffer.alloc(10);
          rep[0] = 0x05;
          rep[1] = 0x00;
          rep[2] = 0x00;
          rep[3] = 0x01;
          rep.writeUInt8(127, 4);
          rep.writeUInt8(0, 5);
          rep.writeUInt8(0, 6);
          rep.writeUInt8(1, 7);
          rep.writeUInt16BE(udpRelayPort, 8);
          socket.write(rep);
        }
      });
    });

    await new Promise<void>((resolve) => mockSocksServer!.listen(0, '127.0.0.1', () => resolve()));
    socksPort = (mockSocksServer.address() as net.AddressInfo).port;

    const res = await probeUdpSupport(
      { host: '127.0.0.1', port: socksPort },
      { timeoutMs: 150 }
    );

    expect(res.supported).toBe(false);
    expect(res.reason).toBe('stun-timeout');
  });

  it('supports probe caching and respects TTL hit', async () => {
    const proxy = { host: '127.0.0.1', port: 59998 };
    const first = await probeUdpSupport(proxy);
    expect(getUdpProbeCacheSize()).toBe(1);

    const second = await probeUdpSupport(proxy);
    expect(second.timestamp).toBe(first.timestamp);
    expect(second.reason).toBe(first.reason);
  });
});

describe('Transport Policy Flag Matrix & Relay State Tracking', () => {
  it('composes flags for udp-capable socks5 (SOCKS5_FULL_PASS)', () => {
    const flags = composeTransportFlags(
      { status: 'SOCKS5_FULL_PASS' },
      'socks5://127.0.0.1:1080'
    );
    expect(flags).toContain('--proxy-server=socks5://127.0.0.1:1080');
    expect(flags).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(flags).not.toContain('--disable-quic');
  });

  it('composes flags for tcp-only socks5 (CONSTRAINED)', () => {
    const flags = composeTransportFlags(
      { status: 'CONSTRAINED' },
      'socks5://127.0.0.1:1080'
    );
    expect(flags).toContain('--proxy-server=socks5://127.0.0.1:1080');
    expect(flags).toContain('--disable-quic');
    expect(flags).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(flags).toContain('--disable-webrtc');
  });

  it('composes flags for http proxy (CONSTRAINED)', () => {
    const flags = composeTransportFlags(
      { status: 'CONSTRAINED' },
      'http://1.2.3.4:8080'
    );
    expect(flags).toContain('--proxy-server=http://1.2.3.4:8080');
    expect(flags).toContain('--disable-quic');
    expect(flags).toContain('--disable-webrtc');
  });

  it('composes flags for no proxy (DIRECT_OK)', () => {
    const flags = composeTransportFlags({ status: 'DIRECT_OK' });
    expect(flags).toEqual([]);
  });

  it('manages profile relay state via exported getters/setters', () => {
    expect(getUdpRelayState('profile-1')).toBe('unavailable');
    registerUdpRelayState('profile-1', 'relay');
    expect(getUdpRelayState('profile-1')).toBe('relay');
    setUdpRelayState('profile-1', 'quic-disabled');
    expect(getUdpRelayState('profile-1')).toBe('quic-disabled');
    unregisterUdpRelayState('profile-1');
    expect(getUdpRelayState('profile-1')).toBe('unavailable');
  });
});
