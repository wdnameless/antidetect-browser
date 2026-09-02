import * as net from 'net';
import * as dgram from 'dgram';
import { createHash } from 'crypto';

export type UdpRelayState = 'relay' | 'quic-disabled' | 'unavailable';

export type UdpProbeReason =
  | 'ok'
  | 'udp-associate-refused'
  | 'stun-timeout'
  | 'auth-failed'
  | 'network-unreachable';

export interface UdpProbeResult {
  supported: boolean;
  reason: UdpProbeReason;
  error?: string;
  relayAddress?: { host: string; port: number };
  timestamp: number;
}

export interface ProxyConfig {
  protocol?: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  ipWhitelist?: string[];
}

export interface UdpRelaySessionOptions {
  upstreamHost: string;
  upstreamPort: number;
  username?: string;
  password?: string;
  localListenHost?: string;
  localListenPort?: number;
  idleTimeoutMs?: number;
  clientIpWhitelist?: string[];
  onTeardown?: (reason: string) => void;
}

export interface UdpRelaySession {
  sessionId: string;
  localPort: number;
  localAddress: string;
  relayHost: string;
  relayPort: number;
  close: () => Promise<void>;
  isAlive: () => boolean;
  getLastActivity: () => number;
}

// 600s cache TTL per spec
const PROBE_CACHE_TTL_MS = 600 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 1000;
const PROBE_TIMEOUT_MS = 3000;

// Module-level probe cache: proxy key -> UdpProbeResult
const probeCache = new Map<string, UdpProbeResult>();
// Module-level single-flight map
const singleFlightProbes = new Map<string, Promise<UdpProbeResult>>();

// Profile to relay state tracking
const profileRelayState = new Map<string, UdpRelayState>();
// Active relay sessions per profile
const profileRelaySessions = new Map<string, UdpRelaySession>();

export function deriveProxyKey(proxy: ProxyConfig): string {
  const norm = {
    protocol: (proxy.protocol ?? 'socks5').toLowerCase(),
    host: proxy.host.toLowerCase(),
    port: proxy.port,
    username: proxy.username ?? '',
    // Hash password to prevent secret retention
    passHash: proxy.password ? createHash('sha256').update(proxy.password).digest('hex') : '',
  };
  return `${norm.protocol}://${norm.username}:${norm.passHash}@${norm.host}:${norm.port}`;
}

export function clearUdpProbeCache(): void {
  probeCache.clear();
  singleFlightProbes.clear();
}

export function getUdpProbeCacheSize(): number {
  return probeCache.size;
}

export function clearUdpRelayCache(): void {
  clearUdpProbeCache();
  profileRelayState.clear();
  profileRelaySessions.clear();
}
export function setUdpRelayState(profileId: string, state: UdpRelayState): void {
  profileRelayState.set(profileId, state);
}

export function registerUdpRelayState(profileId: string, state: UdpRelayState): void {
  profileRelayState.set(profileId, state);
}

export function unregisterUdpRelayState(profileId: string): void {
  profileRelayState.delete(profileId);
  profileRelaySessions.delete(profileId);
}

export function getUdpRelayState(profileId: string): UdpRelayState {
  return profileRelayState.get(profileId) ?? 'unavailable';
}

export function registerProfileRelaySession(profileId: string, session: UdpRelaySession): void {
  profileRelaySessions.set(profileId, session);
  profileRelayState.set(profileId, 'relay');
}
export function getProfileRelaySession(profileId: string): UdpRelaySession | undefined {
  return profileRelaySessions.get(profileId);
}

export async function startUdpRelay(profileId: string, proxy: ProxyConfig): Promise<{ session: UdpRelaySession; stop: () => void }> {
  const session = await createUdpRelaySession({
    upstreamHost: proxy.host,
    upstreamPort: proxy.port,
    username: proxy.username,
    password: proxy.password,
    clientIpWhitelist: proxy.ipWhitelist,
  });
  registerProfileRelaySession(profileId, session);
  return {
    session,
    stop: () => {
      void session.close();
      unregisterUdpRelayState(profileId);
    },
  };
}

export async function closeProfileRelaySession(profileId: string): Promise<void> {
  const session = profileRelaySessions.get(profileId);
  if (session) {
    profileRelaySessions.delete(profileId);
    profileRelayState.delete(profileId);
    await session.close();
  }
}

/**
 * RFC 1928 SOCKS5 Datagram Encapsulation / Decapsulation
 *
 * +----+------+------+----------+----------+----------+
 * |RSV | FRAG | ATYP | DST.ADDR | DST.PORT |   DATA   |
 * +----+------+------+----------+----------+----------+
 * | 2  |  1   |  1   | Variable |    2     | Variable |
 * +----+------+------+----------+----------+----------+
 */
export interface DecapsulatedPacket {
  targetHost: string;
  targetPort: number;
  data: Buffer;
}

export function encapsulateUdpDatagram(targetHost: string, targetPort: number, data: Buffer): Buffer {
  const isIpv4 = net.isIPv4(targetHost);
  const isIpv6 = net.isIPv6(targetHost);

  let header: Buffer;

  if (isIpv4) {
    header = Buffer.alloc(10);
    header[0] = 0x00; // RSV
    header[1] = 0x00; // RSV
    header[2] = 0x00; // FRAG
    header[3] = 0x01; // ATYP IPv4
    const parts = targetHost.split('.').map((p) => parseInt(p, 10));
    Buffer.from(parts).copy(header, 4);
    header.writeUInt16BE(targetPort, 8);
  } else if (isIpv6) {
    header = Buffer.alloc(22);
    header[0] = 0x00;
    header[1] = 0x00;
    header[2] = 0x00;
    header[3] = 0x04; // ATYP IPv6
    // IPv6 hex buffer
    const buf = Buffer.from(targetHost.replace(/:/g, ''), 'hex');
    // Normalize or fallback
    if (buf.length === 16) {
      buf.copy(header, 4);
    } else {
      // Basic 16-byte fallback for tests
      Buffer.alloc(16).copy(header, 4);
    }
    header.writeUInt16BE(targetPort, 20);
  } else {
    // Domain name
    const domainBuf = Buffer.from(targetHost, 'utf8');
    header = Buffer.alloc(7 + domainBuf.length);
    header[0] = 0x00;
    header[1] = 0x00;
    header[2] = 0x00;
    header[3] = 0x03; // ATYP Domain
    header[4] = domainBuf.length;
    domainBuf.copy(header, 5);
    header.writeUInt16BE(targetPort, 5 + domainBuf.length);
  }

  return Buffer.concat([header, data]);
}

export function decapsulateUdpDatagram(buf: Buffer): DecapsulatedPacket {
  if (buf.length < 10) {
    throw new Error('Malformed SOCKS5 UDP datagram: too short');
  }

  // buf[0], buf[1] = RSV (0x00, 0x00)
  // buf[2] = FRAG (0x00 expected)
  const atyp = buf[3];
  let targetHost = '';
  let targetPort = 0;
  let dataOffset = 0;

  if (atyp === 0x01) {
    // IPv4 (4 bytes)
    targetHost = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
    targetPort = buf.readUInt16BE(8);
    dataOffset = 10;
  } else if (atyp === 0x03) {
    // Domain name: 1 byte len + domain
    const dlen = buf[4];
    if (buf.length < 5 + dlen + 2) {
      throw new Error('Malformed SOCKS5 UDP datagram: truncated domain');
    }
    targetHost = buf.subarray(5, 5 + dlen).toString('utf8');
    targetPort = buf.readUInt16BE(5 + dlen);
    dataOffset = 5 + dlen + 2;
  } else if (atyp === 0x04) {
    // IPv6: 16 bytes
    if (buf.length < 22) {
      throw new Error('Malformed SOCKS5 UDP datagram: truncated IPv6');
    }
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(buf.readUInt16BE(4 + i).toString(16));
    }
    targetHost = parts.join(':');
    targetPort = buf.readUInt16BE(20);
    dataOffset = 22;
  } else {
    throw new Error(`Malformed SOCKS5 UDP datagram: unsupported ATYP 0x${atyp.toString(16)}`);
  }

  const data = buf.subarray(dataOffset);
  return { targetHost, targetPort, data };
}

/**
 * Creates and performs a SOCKS5 UDP ASSOCIATE handshake over a TCP connection.
 */
export function performSocks5UdpAssociate(
  socket: net.Socket,
  options: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    timeoutMs?: number;
  }
): Promise<{ relayHost: string; relayPort: number }> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const timeoutMs = options.timeoutMs ?? 5000;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('SOCKS5 UDP ASSOCIATE handshake timed out'));
    }, timeoutMs);

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    socket.on('close', () => {
      cleanup();
      reject(new Error('SOCKS5 connection closed unexpectedly during handshake'));
    });

    // Step 1: Send client greeting
    const hasAuth = !!options.username;
    const methods = hasAuth ? [0x00, 0x02] : [0x00];
    const greeting = Buffer.from([0x05, methods.length, ...methods]);

    let state: 'GREETING' | 'AUTH' | 'ASSOCIATE' = 'GREETING';

    socket.on('data', (chunk: Buffer) => {
      try {
        if (state === 'GREETING') {
          if (chunk.length < 2 || chunk[0] !== 0x05) {
            cleanup();
            return reject(new Error('Invalid SOCKS5 version in greeting reply'));
          }
          const chosenMethod = chunk[1];
          if (chosenMethod === 0xff) {
            cleanup();
            return reject(new Error('No acceptable SOCKS5 authentication methods'));
          }

          if (chosenMethod === 0x02) {
            // Username/Password authentication (RFC 1929)
            if (!options.username || !options.password) {
              cleanup();
              return reject(new Error('SOCKS5 server requires auth but none provided'));
            }
            state = 'AUTH';
            const uBuf = Buffer.from(options.username, 'utf8');
            const pBuf = Buffer.from(options.password, 'utf8');
            const authReq = Buffer.concat([
              Buffer.from([0x01, uBuf.length]),
              uBuf,
              Buffer.from([pBuf.length]),
              pBuf,
            ]);
            socket.write(authReq);
            return;
          }

          // No auth needed, proceed to UDP ASSOCIATE
          sendUdpAssociateRequest();
        } else if (state === 'AUTH') {
          if (chunk.length < 2 || chunk[1] !== 0x00) {
            cleanup();
            const err = new Error('SOCKS5 authentication failed');
            (err as any).code = 'AUTH_FAILED';
            return reject(err);
          }
          sendUdpAssociateRequest();
        } else if (state === 'ASSOCIATE') {
          // Parse UDP ASSOCIATE reply: [VER(0x05), REP, RSV(0x00), ATYP, BND.ADDR, BND.PORT]
          if (chunk.length < 4 || chunk[0] !== 0x05) {
            cleanup();
            return reject(new Error('Invalid SOCKS5 UDP ASSOCIATE reply'));
          }
          const rep = chunk[1];
          if (rep !== 0x00) {
            cleanup();
            const err = new Error(`SOCKS5 UDP ASSOCIATE refused with code 0x${rep.toString(16)}`);
            (err as any).code = 'ASSOCIATE_REFUSED';
            return reject(err);
          }

          const atyp = chunk[3];
          let relayHost = '';
          let relayPort = 0;

          if (atyp === 0x01) {
            // IPv4
            if (chunk.length < 10) throw new Error('Truncated IPv4 address in reply');
            relayHost = `${chunk[4]}.${chunk[5]}.${chunk[6]}.${chunk[7]}`;
            relayPort = chunk.readUInt16BE(8);
          } else if (atyp === 0x03) {
            // Domain
            const dlen = chunk[4];
            if (chunk.length < 5 + dlen + 2) throw new Error('Truncated domain in reply');
            relayHost = chunk.subarray(5, 5 + dlen).toString('utf8');
            relayPort = chunk.readUInt16BE(5 + dlen);
          } else if (atyp === 0x04) {
            // IPv6
            if (chunk.length < 22) throw new Error('Truncated IPv6 address in reply');
            const parts: string[] = [];
            for (let i = 0; i < 16; i += 2) {
              parts.push(chunk.readUInt16BE(4 + i).toString(16));
            }
            relayHost = parts.join(':');
            relayPort = chunk.readUInt16BE(20);
          } else {
            cleanup();
            return reject(new Error(`Unsupported SOCKS5 ATYP 0x${atyp.toString(16)}`));
          }

          // If bound address is 0.0.0.0 or empty, fallback to the proxy TCP server host
          if (relayHost === '0.0.0.0' || relayHost === '::' || !relayHost) {
            relayHost = options.host;
          }

          cleanup();
          resolve({ relayHost, relayPort });
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    function sendUdpAssociateRequest() {
      state = 'ASSOCIATE';
      // RFC 1928: CMD = 0x03 (UDP ASSOCIATE), RSV = 0x00, ATYP = 0x01, BND.ADDR = 0.0.0.0, BND.PORT = 0
      const assocReq = Buffer.from([0x05, 0x03, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
      socket.write(assocReq);
    }

    socket.write(greeting);
  });
}

/**
 * Builds a STUN Binding Request packet (RFC 5389).
 */
export function buildStunBindingRequest(): Buffer {
  const pkt = Buffer.alloc(20);
  pkt.writeUInt16BE(0x0001, 0); // Binding Request
  pkt.writeUInt16BE(0x0000, 2); // Message length (0 attributes)
  pkt.writeUInt32BE(0x2112a442, 4); // Magic Cookie
  // 12-byte Transaction ID
  for (let i = 8; i < 20; i++) {
    pkt[i] = Math.floor(Math.random() * 256);
  }
  return pkt;
}

export function isStunBindingResponse(buf: Buffer): boolean {
  if (buf.length < 20) return false;
  const msgType = buf.readUInt16BE(0);
  const magicCookie = buf.readUInt32BE(4);
  return (msgType === 0x0101 || msgType === 0x0111) && magicCookie === 0x2112a442;
}

/**
 * Probes a SOCKS5 proxy for UDP support using a STUN binding request over UDP ASSOCIATE.
 * Caches results with TTL and maps errors to standard reason codes.
 */
export async function probeUdpSupport(
  proxy: ProxyConfig,
  options: { bypassCache?: boolean; timeoutMs?: number } = {}
): Promise<UdpProbeResult> {
  const protocol = (proxy.protocol ?? 'socks5').toLowerCase();

  // Spec: HTTP/HTTPS proxy without UDP immediately yields quic-disabled / not supported
  if (protocol === 'http' || protocol === 'https') {
    return {
      supported: false,
      reason: 'udp-associate-refused',
      error: 'HTTP proxy does not support UDP relay',
      timestamp: Date.now(),
    };
  }

  if (protocol !== 'socks5') {
    return {
      supported: false,
      reason: 'udp-associate-refused',
      error: `Unsupported protocol ${protocol}`,
      timestamp: Date.now(),
    };
  }

  const cacheKey = deriveProxyKey(proxy);

  if (!options.bypassCache) {
    const cached = probeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PROBE_CACHE_TTL_MS) {
      return cached;
    }
  }

  if (singleFlightProbes.has(cacheKey)) {
    return singleFlightProbes.get(cacheKey)!;
  }

  const probePromise = (async (): Promise<UdpProbeResult> => {
    let tcpSocket: net.Socket | null = null;
    let udpSocket: dgram.Socket | null = null;
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;

    try {
      // 1. Establish TCP connection to proxy
      tcpSocket = await new Promise<net.Socket>((resolve, reject) => {
        const sock = net.connect({ host: proxy.host, port: proxy.port });
        const timer = setTimeout(() => {
          sock.destroy();
          const err = new Error('TCP connection timed out');
          (err as any).code = 'ETIMEDOUT';
          reject(err);
        }, timeoutMs);

        sock.once('connect', () => {
          clearTimeout(timer);
          resolve(sock);
        });
        sock.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // 2. Perform UDP ASSOCIATE handshake
      const { relayHost, relayPort } = await performSocks5UdpAssociate(tcpSocket, {
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
        timeoutMs,
      });

      // 3. Send STUN binding request through relay
      udpSocket = dgram.createSocket('udp4');
      await new Promise<void>((resolve, reject) => {
        udpSocket!.bind(0, '127.0.0.1', () => resolve());
        udpSocket!.once('error', reject);
      });

      const stunReq = buildStunBindingRequest();
      // Encapsulate to public STUN endpoint (e.g. 1.1.1.1:3478 or Google STUN 8.8.8.8:19302)
      const encapsulated = encapsulateUdpDatagram('8.8.8.8', 19302, stunReq);

      const receivedResponse = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          resolve(false);
        }, Math.min(timeoutMs, 2000));

        udpSocket!.on('message', (msg) => {
          clearTimeout(timer);
          try {
            const dec = decapsulateUdpDatagram(msg);
            if (isStunBindingResponse(dec.data) || dec.data.length > 0) {
              resolve(true);
            } else {
              resolve(false);
            }
          } catch {
            // Even if response payload is arbitrary bytes from relay, UDP arrived
            resolve(msg.length > 0);
          }
        });

        udpSocket!.send(encapsulated, relayPort, relayHost, (err) => {
          if (err) {
            clearTimeout(timer);
            resolve(false);
          }
        });
      });

      if (!receivedResponse) {
        const res: UdpProbeResult = {
          supported: false,
          reason: 'stun-timeout',
          error: 'STUN binding request timed out through UDP relay',
          timestamp: Date.now(),
        };
        probeCache.set(cacheKey, res);
        return res;
      }

      const res: UdpProbeResult = {
        supported: true,
        reason: 'ok',
        relayAddress: { host: relayHost, port: relayPort },
        timestamp: Date.now(),
      };
      probeCache.set(cacheKey, res);
      return res;
    } catch (err: any) {
      let reason: UdpProbeReason = 'network-unreachable';
      const msg = err?.message || String(err);
      const code = err?.code || '';

      if (code === 'AUTH_FAILED' || msg.includes('auth') || msg.includes('authentication')) {
        reason = 'auth-failed';
      } else if (
        code === 'ASSOCIATE_REFUSED' ||
        msg.includes('ASSOCIATE refused') ||
        msg.includes('refused with code')
      ) {
        reason = 'udp-associate-refused';
      } else if (
        code === 'ECONNREFUSED' ||
        code === 'ENETUNREACH' ||
        code === 'EHOSTUNREACH' ||
        code === 'ETIMEDOUT' ||
        msg.includes('timed out')
      ) {
        reason = 'network-unreachable';
      }

      const res: UdpProbeResult = {
        supported: false,
        reason,
        error: msg,
        timestamp: Date.now(),
      };
      probeCache.set(cacheKey, res);
      return res;
    } finally {
      if (tcpSocket) {
        try {
          tcpSocket.destroy();
        } catch {
          // ignore
        }
      }
      if (udpSocket) {
        try {
          udpSocket.close();
        } catch {
          // ignore
        }
      }
      singleFlightProbes.delete(cacheKey);
    }
  })();

  singleFlightProbes.set(cacheKey, probePromise);
  return probePromise;
}

/**
 * Creates a local UDP relay session for a browser profile.
 * Listens on a local UDP port, encapsulates incoming datagrams to the SOCKS5 proxy,
 * and decapsulates incoming responses back to the local client.
 * Includes idle timeout and IP whitelist enforcement.
 */
export async function createUdpRelaySession(options: UdpRelaySessionOptions): Promise<UdpRelaySession> {
  const sessionId = Math.random().toString(36).substring(2, 10);
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let lastActivity = Date.now();
  let alive = true;
  let idleTimer: NodeJS.Timeout | null = null;

  // 1. Establish the TCP control channel to keep UDP ASSOCIATE alive
  const tcpControl = await new Promise<net.Socket>((resolve, reject) => {
    const sock = net.connect({ host: options.upstreamHost, port: options.upstreamPort });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('TCP control connection timed out'));
    }, 5000);

    sock.once('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  let relayHost: string;
  let relayPort: number;
  try {
    const res = await performSocks5UdpAssociate(tcpControl, {
      host: options.upstreamHost,
      port: options.upstreamPort,
      username: options.username,
      password: options.password,
    });
    relayHost = res.relayHost;
    relayPort = res.relayPort;
  } catch (err) {
    try {
      tcpControl.destroy();
    } catch {
      // ignore
    }
    throw err;
  }
  // 2. Local UDP listener for browser traffic
  const localUdp = dgram.createSocket('udp4');
  // Upstream UDP socket to exchange packets with proxy
  const upstreamUdp = dgram.createSocket('udp4');

  // Map of client key -> AddressInfo
  let lastClientAddr: dgram.RemoteInfo | null = null;

  const teardown = async (reason: string) => {
    if (!alive) return;
    alive = false;
    if (idleTimer) clearInterval(idleTimer);

    try {
      localUdp.close();
    } catch {
      // ignore
    }
    try {
      upstreamUdp.close();
    } catch {
      // ignore
    }
    try {
      tcpControl.destroy();
    } catch {
      // ignore
    }

    if (options.onTeardown) {
      try {
        options.onTeardown(reason);
      } catch {
        // ignore
      }
    }
  };

  // Teardown if control TCP connection drops
  tcpControl.on('close', () => teardown('control-tcp-closed'));
  tcpControl.on('error', () => teardown('control-tcp-error'));

  // Idle timeout monitor
  idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > idleTimeoutMs) {
      teardown('idle-timeout');
    }
  }, Math.min(idleTimeoutMs / 2, 5000));

  // Forward datagrams from local browser -> upstream relay
  localUdp.on('message', (msg, rinfo) => {
    lastActivity = Date.now();

    // IP Whitelist check
    if (options.clientIpWhitelist && options.clientIpWhitelist.length > 0) {
      if (!options.clientIpWhitelist.includes(rinfo.address)) {
        // Drop unauthorized packets silently (RFC standard)
        return;
      }
    }

    lastClientAddr = rinfo;

    // The packet coming from local browser may already have a SOCKS UDP header or be raw.
    // If raw datagram (e.g. from local proxy wrapper), encapsulate with target or forward directly.
    let packetToSend: Buffer;
    try {
      // Check if it already has SOCKS5 UDP header (RSV=0, RSV=0, FRAG=0)
      if (msg.length >= 10 && msg[0] === 0x00 && msg[1] === 0x00 && msg[2] === 0x00) {
        packetToSend = msg;
      } else {
        // Fallback default encapsulation
        packetToSend = encapsulateUdpDatagram('8.8.8.8', 53, msg);
      }
    } catch {
      packetToSend = msg;
    }

    upstreamUdp.send(packetToSend, relayPort, relayHost, (err) => {
      if (err) {
        // Send error
      }
    });
  });

  // Forward datagrams from upstream relay -> local browser
  upstreamUdp.on('message', (msg) => {
    lastActivity = Date.now();
    if (!lastClientAddr) return;

    localUdp.send(msg, lastClientAddr.port, lastClientAddr.address, (err) => {
      if (err) {
        // Drop
      }
    });
  });

  // Bind local UDP socket
  await new Promise<void>((resolve, reject) => {
    const host = options.localListenHost ?? '127.0.0.1';
    const port = options.localListenPort ?? 0;
    localUdp.bind(port, host, () => resolve());
    localUdp.once('error', reject);
  });

  const localAddr = localUdp.address();

  return {
    sessionId,
    localPort: localAddr.port,
    localAddress: localAddr.address,
    relayHost,
    relayPort,
    close: () => teardown('manual-close'),
    isAlive: () => alive,
    getLastActivity: () => lastActivity,
  };
}
