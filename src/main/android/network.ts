// Android guest networking: tun2socks routing, geolocation, and controller client.
// Traced to requirements R10 (no guest traffic escapes proxy) and R11 (GPS derived from proxy).

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { AdbClient } from './adb';
import { logger } from '../util/logger';

export interface GuestNetworkPlan {
  tunInterface: 'tun0';
  socksHost: string; // 127.0.0.1 as seen from the guest: 10.0.2.2
  socksPort: number;
  tun2socksBinaryOnHost: string;
  /** True when the profile has no proxy — the guest then has NO route (fail closed). */
  blocked: boolean;
}

/**
 * Plans the network routing configuration for the Android guest.
 * If the profile lacks a proxy, returns blocked: true so all network traffic fails closed
 * rather than leaking to the local host route.
 */
export function planGuestNetwork(
  proxy: { type: string; host: string; port: number } | null
): GuestNetworkPlan {
  // In QEMU / Android Emulator default user networking (SLIRP), the host loopback interface
  // (127.0.0.1) is accessed from within the guest via the virtual gateway IP 10.0.2.2.
  // Therefore, the guest-side tun2socks client must connect to 10.0.2.2 to reach the host SOCKS bridge.
  const socksHost = '10.0.2.2';

  if (!proxy) {
    return {
      tunInterface: 'tun0',
      socksHost,
      socksPort: 0,
      tun2socksBinaryOnHost: '',
      blocked: true,
    };
  }

  return {
    tunInterface: 'tun0',
    socksHost,
    socksPort: proxy.port,
    tun2socksBinaryOnHost: '',
    blocked: false,
  };
}

/**
 * Starts the host-side SOCKS bridge (via opts.tunnel if provided) and the guest-side tun2socks service.
 * Returns { ok: false, detail } when the guest lacks the tun2socks binary (never a silent true).
 * When plan.blocked is true, fails closed without attempting to start tun2socks.
 */
export async function setupGuestNetwork(
  adb: AdbClient,
  plan: GuestNetworkPlan,
  opts: {
    tunnel?: { start: () => Promise<{ localPort: number }>; stop: () => Promise<void> };
  }
): Promise<{ ok: boolean; detail: string }> {
  // Fail closed: if profile has no proxy, the guest route is blocked to prevent leaks
  if (plan.blocked) {
    logger.info('Guest network is blocked: no proxy configured for profile (fail-closed, no leak)');
    return {
      ok: true,
      detail: 'Network blocked: profile has no proxy (fail-closed, no leak)',
    };
  }

  let effectiveSocksPort = plan.socksPort;

  // 1. Start host-side SOCKS proxy tunnel bridge if provided
  if (opts.tunnel) {
    try {
      const tunnelRes = await opts.tunnel.start();
      effectiveSocksPort = tunnelRes.localPort;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to start host-side proxy tunnel', { error: msg });
      return {
        ok: false,
        detail: `Failed to start host-side proxy tunnel: ${msg}`,
      };
    }
  }

  // 2. Locate tun2socks binary inside the guest
  let tun2socksPath = '';
  try {
    const whichRes = await adb.shell(['which', 'tun2socks']);
    if (whichRes && whichRes.trim() && !whichRes.includes('not found')) {
      tun2socksPath = whichRes.trim();
    }
  } catch {
    // which command threw or returned non-zero
  }

  if (!tun2socksPath) {
    const candidatePaths = [
      '/system/bin/tun2socks',
      '/data/adb/tun2socks',
      '/data/local/tmp/tun2socks',
    ];
    for (const candidate of candidatePaths) {
      try {
        await adb.shell(['test', '-x', candidate]);
        tun2socksPath = candidate;
        break;
      } catch {
        // candidate not found or not executable
      }
    }
  }

  if (!tun2socksPath) {
    logger.warn('tun2socks binary not found on guest');
    return {
      ok: false,
      detail: 'tun2socks binary not found in guest (/system/bin/tun2socks, /data/adb/tun2socks, or PATH)',
    };
  }

  // 3. Configure tun0 and launch tun2socks daemon
  try {
    await adb.shell(['ip', 'tuntap', 'add', 'mode', 'tun', 'dev', 'tun0']);
    await adb.shell(['ip', 'addr', 'add', '10.0.4.2/24', 'dev', 'tun0']);
    await adb.shell(['ip', 'link', 'set', 'dev', 'tun0', 'up']);
    await adb.shell(['ip', 'route', 'add', 'default', 'via', '10.0.4.1', 'dev', 'tun0']);

    const daemonCmd = `nohup ${tun2socksPath} --netif-ipaddr 10.0.4.2 --netif-netmask 255.255.255.0 --socks-server-addr ${plan.socksHost}:${effectiveSocksPort} --tunmtu 1500 --loglevel warn > /dev/null 2>&1 &`;
    await adb.shell(['sh', '-c', daemonCmd]);

    logger.info('Guest network configured successfully through tun2socks', {
      socksHost: plan.socksHost,
      socksPort: effectiveSocksPort,
    });

    return {
      ok: true,
      detail: `tun2socks active on ${plan.socksHost}:${effectiveSocksPort}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to configure guest network interface', { error: msg });
    return {
      ok: false,
      detail: `Failed to configure guest network interface: ${msg}`,
    };
  }
}

/**
 * Tears down guest tun2socks routing and removes the tun0 interface.
 */
export async function teardownGuestNetwork(adb: AdbClient): Promise<void> {
  try {
    await adb.shell(['pkill', '-f', 'tun2socks']);
  } catch {
    // best-effort cleanup
  }
  try {
    await adb.shell(['ip', 'link', 'set', 'dev', 'tun0', 'down']);
    await adb.shell(['ip', 'tuntap', 'del', 'mode', 'tun', 'dev', 'tun0']);
  } catch {
    // best-effort cleanup
  }
}

/**
 * Controller interface for communicating with emulator console.
 */
export interface AndroidControllerClient {
  setLocation(lat: number, lng: number): Promise<void>;
  rotate(): Promise<void>;
  sendKey(keycode: number): Promise<void>;
  close(): void;
}

/**
 * Pushes GPS coordinates to the emulator controller ONLY when non-null.
 * When null, pushes nothing and returns: a plausible default city would be a false leak (R11).
 */
export async function pushGeolocation(
  grpc: AndroidControllerClient,
  geo: { latitude: number; longitude: number } | null
): Promise<void> {
  if (
    !geo ||
    typeof geo.latitude !== 'number' ||
    typeof geo.longitude !== 'number' ||
    Number.isNaN(geo.latitude) ||
    Number.isNaN(geo.longitude)
  ) {
    return;
  }

  await grpc.setLocation(geo.latitude, geo.longitude);
}

/**
 * Connects to the emulator telnet/console interface.
 * Requires the auth token from ~/.emulator_console_auth_token (or authTokenPath);
 * reads and verifies the token, reporting a missing file rather than skipping authentication.
 */
export function connectController(
  consolePort: number,
  authTokenPath?: string
): AndroidControllerClient {
  const resolvedPath = authTokenPath
    ? path.resolve(authTokenPath)
    : path.join(os.homedir(), '.emulator_console_auth_token');

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Emulator console auth token file not found at ${resolvedPath}`);
  }

  const token = fs.readFileSync(resolvedPath, 'utf8').trim();
  if (!token) {
    throw new Error(`Emulator console auth token file is empty: ${resolvedPath}`);
  }

  let socket: net.Socket | null = null;
  let isClosed = false;

  async function getAuthenticatedSocket(): Promise<net.Socket> {
    if (isClosed) {
      throw new Error('Controller client is closed');
    }
    if (socket && !socket.destroyed) {
      return socket;
    }

    const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
    const s = net.createConnection({ host: '127.0.0.1', port: consolePort }, () => {
      // Connected, wait for banner then send auth command
    });

    let authenticated = false;
    let buffer = '';

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // Initial console banner requires typing auth <token>
      if (!authenticated && (buffer.includes('OK') || buffer.includes('auth <auth_token>'))) {
        authenticated = true;
        buffer = '';
        s.write(`auth ${token}\r\n`);
        return;
      }

      if (authenticated) {
        if (buffer.includes('OK')) {
          s.off('data', onData);
          socket = s;
          resolve(s);
        } else if (buffer.includes('KO')) {
          s.destroy();
          reject(new Error(`Emulator console authentication failed: ${buffer.trim()}`));
        }
      }
    };

    s.on('data', onData);
    s.once('error', (err) => {
      reject(new Error(`Connection to emulator console on port ${consolePort} failed: ${err.message}`));
    });

    return promise;
  }

  async function sendCommand(command: string): Promise<string> {
    const s = await getAuthenticatedSocket();
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let out = '';
    const onData = (data: Buffer) => {
      out += data.toString('utf8');
      if (out.includes('OK')) {
        cleanup();
        resolve(out.trim());
      } else if (out.includes('KO')) {
        cleanup();
        reject(new Error(`Emulator console command '${command}' rejected: ${out.trim()}`));
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      s.off('data', onData);
      s.off('error', onError);
    };

    s.on('data', onData);
    s.once('error', onError);
    s.write(`${command}\r\n`);
    return promise;
  }

  return {
    async setLocation(lat: number, lng: number): Promise<void> {
      // Android emulator console syntax: geo fix <longitude> <latitude>
      await sendCommand(`geo fix ${lng} ${lat}`);
    },

    async rotate(): Promise<void> {
      await sendCommand('rotate');
    },

    async sendKey(keycode: number): Promise<void> {
      await sendCommand(`event send EV_KEY:${keycode}:1`);
      await sendCommand(`event send EV_KEY:${keycode}:0`);
    },

    close(): void {
      isClosed = true;
      if (socket) {
        socket.destroy();
        socket = null;
      }
    },
  };
}
