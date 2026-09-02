import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'net';
import * as dgram from 'dgram';
import {
  probeTransportTarget,
  deriveTransportCacheKey,
  composeTransportFlags,
  invalidateTransportCache,
  registerActiveProfile,
  notifyTransportLoss,
  checkNetworkInterfaceChange,
  getNetworkInterfacesFingerprint,
} from '../../../src/main/proxy/transportPolicy';

describe('Network Transport Policy & Pre-Launch Probe Pipeline', () => {
  beforeEach(() => {
    invalidateTransportCache();
  });

  afterEach(() => {
    invalidateTransportCache();
  });

  describe('HMAC Cache Key Generation', () => {
    it('generates consistent HMAC keys and never leaks plain password', () => {
      const targetWithSecret = {
        protocol: 'socks5' as const,
        host: '127.0.0.1',
        port: 1080,
        username: 'alice',
        password: 'SUPER_SECRET_PLAINTEXT_PASSWORD',
      };
      const key1 = deriveTransportCacheKey(targetWithSecret);
      const key2 = deriveTransportCacheKey(targetWithSecret);

      expect(key1).toBe(key2);
      expect(typeof key1).toBe('string');
      expect(key1.length).toBe(64); // SHA-256 hex length
      expect(key1).not.toContain('SUPER_SECRET_PLAINTEXT_PASSWORD');
    });
  });

  describe('Flag Composition (Table 6.1)', () => {
    it('returns empty flags for NO_PROXY', () => {
      const flags = composeTransportFlags({ status: 'NO_PROXY' });
      expect(flags).toEqual([]);
    });

    it('maps SOCKS5_FULL_PASS to proxy-server, loopback bypass, and disable_non_proxied_udp', () => {
      const flags = composeTransportFlags({ status: 'SOCKS5_FULL_PASS' }, 'socks5://1.2.3.4:1080');
      expect(flags).toContain('--proxy-server=socks5://1.2.3.4:1080');
      expect(flags).toContain('--proxy-bypass-list=<-loopback>');
      expect(flags).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
      expect(flags).not.toContain('--disable-quic');
      expect(flags).not.toContain('--disable-webrtc');
    });

    it('maps CONSTRAINED to proxy-server, loopback bypass, disable-quic, and disable-webrtc', () => {
      const flags = composeTransportFlags({ status: 'CONSTRAINED' }, 'http://1.2.3.4:8080');
      expect(flags).toContain('--proxy-server=http://1.2.3.4:8080');
      expect(flags).toContain('--proxy-bypass-list=<-loopback>');
      expect(flags).toContain('--disable-quic');
      expect(flags).toContain('--disable-webrtc');
      expect(flags).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    });
  });

  describe('Mid-Session Termination & Transport Loss Notification', () => {
    it('notifies registered active profiles and unregisters cleanly', () => {
      let notifiedReason = '';
      const unregister = registerActiveProfile('profile-1', (reason) => {
        notifiedReason = reason;
      });

      notifyTransportLoss('upstream_reset', 'profile-1');
      expect(notifiedReason).toBe('upstream_reset');

      notifiedReason = '';
      unregister();
      notifyTransportLoss('upstream_reset', 'profile-1');
      expect(notifiedReason).toBe('');
    });

    it('broadcasts transport loss to all active profiles when profileId is omitted', () => {
      const calls: string[] = [];
      const unreg1 = registerActiveProfile('p1', (r) => calls.push(`p1:${r}`));
      const unreg2 = registerActiveProfile('p2', (r) => calls.push(`p2:${r}`));

      notifyTransportLoss('network_interface_changed');
      expect(calls).toEqual(['p1:network_interface_changed', 'p2:network_interface_changed']);

      unreg1();
      unreg2();
    });
  });

  describe('Direct / NO_PROXY target', () => {
    it('returns NO_PROXY immediately', async () => {
      const result = await probeTransportTarget({ protocol: 'direct', host: 'localhost', port: 0 });
      expect(result.status).toBe('NO_PROXY');
    });
  });

  describe('Mock Network Probes', () => {
    let mockTcpServer: net.Server | null = null;
    let mockUdpSocket: dgram.Socket | null = null;

    afterEach(async () => {
      if (mockTcpServer) {
        await new Promise<void>((r) => mockTcpServer!.close(() => r()));
        mockTcpServer = null;
      }
      if (mockUdpSocket) {
        await new Promise<void>((r) => mockUdpSocket!.close(() => r()));
        mockUdpSocket = null;
      }
    });

    it('returns REFUSE on TCP connection refused', async () => {
      const result = await probeTransportTarget({
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 59999, // Unused port
      }, { timeoutMs: 500 });

      expect(result.status).toBe('REFUSE');
      expect(result.error?.stage).toBe('tcpConnect');
    });

    it('returns REFUSE on SOCKS5 auth failure', async () => {
      mockTcpServer = net.createServer((conn) => {
        conn.once('data', (greeting) => {
          // Send back username/password auth required (0x02)
          conn.write(Buffer.from([0x05, 0x02]));
          conn.once('data', (_authBuf) => {
            // Reject auth (0x01 = fail)
            conn.write(Buffer.from([0x01, 0x01]));
          });
        });
      });

      const port = await new Promise<number>((r) => {
        mockTcpServer!.listen(0, '127.0.0.1', () => {
          const addr = mockTcpServer!.address() as net.AddressInfo;
          r(addr.port);
        });
      });

      const result = await probeTransportTarget({
        protocol: 'socks5',
        host: '127.0.0.1',
        port,
        username: 'user',
        password: 'wrong_password',
      }, { timeoutMs: 500 });

      expect(result.status).toBe('REFUSE');
      expect(result.error?.stage).toBe('auth');
    });

    it('returns CONSTRAINED for HTTP proxy with valid auth', async () => {
      mockTcpServer = net.createServer((conn) => {
        conn.on('data', (data) => {
          const req = data.toString('utf8');
          if (req.startsWith('CONNECT')) {
            conn.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          }
        });
      });

      const port = await new Promise<number>((r) => {
        mockTcpServer!.listen(0, '127.0.0.1', () => {
          const addr = mockTcpServer!.address() as net.AddressInfo;
          r(addr.port);
        });
      });

      const result = await probeTransportTarget({
        protocol: 'http',
        host: '127.0.0.1',
        port,
      }, { timeoutMs: 500 });

      expect(result.status).toBe('CONSTRAINED');
      expect(result.stages.tcpConnect).toBe(true);
      expect(result.stages.auth).toBe(true);
      expect(result.stages.proxyDns).toBe(true);
    });

    it('returns CONSTRAINED for SOCKS5 when UDP_ASSOCIATE fails', async () => {
      mockTcpServer = net.createServer((conn) => {
        conn.on('data', (data) => {
          if (data[0] === 0x05 && data.length <= 4) {
            // Greeting -> no auth required
            conn.write(Buffer.from([0x05, 0x00]));
          } else if (data[0] === 0x05 && data[1] === 0x01) {
            // CONNECT -> success
            conn.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
          } else if (data[0] === 0x05 && data[1] === 0x03) {
            // UDP_ASSOCIATE -> reject (0x07 = Command not supported)
            conn.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          }
        });
      });

      const port = await new Promise<number>((r) => {
        mockTcpServer!.listen(0, '127.0.0.1', () => {
          const addr = mockTcpServer!.address() as net.AddressInfo;
          r(addr.port);
        });
      });

      const result = await probeTransportTarget({
        protocol: 'socks5',
        host: '127.0.0.1',
        port,
      }, { timeoutMs: 500 });

      expect(result.status).toBe('CONSTRAINED');
      expect(result.stages.tcpConnect).toBe(true);
      expect(result.stages.auth).toBe(true);
      expect(result.stages.proxyDns).toBe(true);
      expect(result.stages.udpAssociate).toBe(false);
    });

    it('returns SOCKS5_FULL_PASS when SOCKS5 supports UDP, STUN, and QUIC echo', async () => {
      // Create mock UDP relay responder
      mockUdpSocket = dgram.createSocket('udp4');
      const udpPort = await new Promise<number>((r) => {
        mockUdpSocket!.bind(0, '127.0.0.1', () => {
          const addr = mockUdpSocket!.address();
          r(addr.port);
        });
      });

      mockUdpSocket.on('message', (msg, rinfo) => {
        // Echo back packet with SOCKS5 UDP header
        mockUdpSocket!.send(msg, rinfo.port, rinfo.address);
      });

      mockTcpServer = net.createServer((conn) => {
        conn.on('data', (data) => {
          if (data[0] === 0x05 && data.length <= 4) {
            // Greeting -> no auth required
            conn.write(Buffer.from([0x05, 0x00]));
          } else if (data[0] === 0x05 && data[1] === 0x01) {
            // CONNECT -> success
            conn.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
          } else if (data[0] === 0x05 && data[1] === 0x03) {
            // UDP_ASSOCIATE -> reply with mock UDP relay port
            const reply = Buffer.alloc(10);
            reply[0] = 0x05;
            reply[1] = 0x00;
            reply[2] = 0x00;
            reply[3] = 0x01; // IPv4
            Buffer.from([127, 0, 0, 1]).copy(reply, 4);
            reply.writeUInt16BE(udpPort, 8);
            conn.write(reply);
          }
        });
      });

      const port = await new Promise<number>((r) => {
        mockTcpServer!.listen(0, '127.0.0.1', () => {
          const addr = mockTcpServer!.address() as net.AddressInfo;
          r(addr.port);
        });
      });

      const result = await probeTransportTarget({
        protocol: 'socks5',
        host: '127.0.0.1',
        port,
      }, { timeoutMs: 1000 });

      expect(result.status).toBe('SOCKS5_FULL_PASS');
      expect(result.stages.tcpConnect).toBe(true);
      expect(result.stages.auth).toBe(true);
      expect(result.stages.proxyDns).toBe(true);
      expect(result.stages.udpAssociate).toBe(true);
      expect(result.stages.stunIpv4).toBe(true);
      expect(result.stages.quic).toBe(true);
    });
  });

  describe('Single-Flight & Cache Invalidation', () => {
    let mockTcpServer: net.Server | null = null;

    afterEach(async () => {
      if (mockTcpServer) {
        await new Promise<void>((r) => mockTcpServer!.close(() => r()));
        mockTcpServer = null;
      }
    });

    it('deduplicates concurrent probe requests with single-flight', async () => {
      let connectionCount = 0;
      mockTcpServer = net.createServer((conn) => {
        connectionCount++;
        conn.on('data', (data) => {
          if (data[0] === 0x05 && data.length <= 4) {
            conn.write(Buffer.from([0x05, 0x00]));
          } else if (data[0] === 0x05 && data[1] === 0x01) {
            conn.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
          } else if (data[0] === 0x05 && data[1] === 0x03) {
            conn.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          }
        });
      });

      const port = await new Promise<number>((r) => {
        mockTcpServer!.listen(0, '127.0.0.1', () => {
          const addr = mockTcpServer!.address() as net.AddressInfo;
          r(addr.port);
        });
      });

      const target = {
        protocol: 'socks5' as const,
        host: '127.0.0.1',
        port,
      };

      // Launch 5 concurrent probe calls simultaneously
      const results = await Promise.all([
        probeTransportTarget(target, { timeoutMs: 1000 }),
        probeTransportTarget(target, { timeoutMs: 1000 }),
        probeTransportTarget(target, { timeoutMs: 1000 }),
        probeTransportTarget(target, { timeoutMs: 1000 }),
        probeTransportTarget(target, { timeoutMs: 1000 }),
      ]);

      // All 5 returned identical CONSTRAINED result
      for (const res of results) {
        expect(res.status).toBe('CONSTRAINED');
      }

      // Initial probe uses 2 TCP connects (1 for DNS connect, 1 for UDP_ASSOCIATE)
      expect(connectionCount).toBe(2);

      // Subsequent call hits cache without opening new connections
      const cached = await probeTransportTarget(target);
      expect(cached.status).toBe('CONSTRAINED');
      expect(connectionCount).toBe(2);
    });

    it('computes network interfaces fingerprint and detects interface change', () => {
      const fp = getNetworkInterfacesFingerprint();
      expect(typeof fp).toBe('string');
      expect(fp.length).toBe(64);

      const changed = checkNetworkInterfaceChange();
      expect(typeof changed).toBe('boolean');
    });
  });
});
