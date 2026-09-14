import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { ensureEngine } from './engine.js';
import type { EnsureEngineOptions } from './engine.js';

export interface StandaloneFingerprintConfig {
  seed?: number;
  platform?: string;
  platformVersion?: string;
  brand?: string;
  brandVersion?: string;
  hardwareConcurrency?: number;
  disableSpoofing?: boolean;
  timezone?: string;
  lang?: string;
}

export interface StandaloneLaunchConfig {
  executablePath?: string;
  userDataDir?: string;
  port?: number;
  headless?: boolean;
  args?: string[];
  fingerprint?: StandaloneFingerprintConfig;
  proxyServer?: string;
  screenOverride?: { width: number; height: number };
  engineOptions?: EnsureEngineOptions;
}

export interface StandaloneProfileInstance {
  readonly cdpUrl: string;
  readonly wsEndpoint: string;
  readonly port: number;
  readonly userDataDir: string;
  readonly pid?: number;
  readonly process?: ChildProcess;
  stop(): Promise<void>;
}

export function buildStandaloneArgs(config: StandaloneLaunchConfig): string[] {
  const flags: string[] = [];

  // Remote debugging flag
  const remotePort = config.port ?? 0;
  flags.push(`--remote-debugging-port=${remotePort}`);

  // User data directory
  if (config.userDataDir) {
    flags.push(`--user-data-dir=${config.userDataDir}`);
  }

  // Headless mode
  if (config.headless) {
    flags.push('--headless=new');
  }

  // Isolation and stability flags (matching src/main/launcher/chromium.ts)
  flags.push(
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-blink-features=AutomationControlled',
    '--password-store=basic'
  );

  // Screen override flag if provided
  if (config.screenOverride) {
    flags.push(`--window-size=${config.screenOverride.width},${config.screenOverride.height}`);
  }

  // Proxy flag if provided
  if (config.proxyServer) {
    flags.push(`--proxy-server=${config.proxyServer}`);
  }

  // Fingerprint args
  const fp = config.fingerprint;
  if (fp) {
    if (fp.disableSpoofing) {
      flags.push('--disable-antidetect-spoofing');
    }
    if (typeof fp.seed === 'number') {
      flags.push(`--fingerprint-seed=${fp.seed}`);
    }
    if (fp.platform) {
      flags.push(`--fingerprint-platform=${fp.platform}`);
    }
    if (fp.platformVersion) {
      flags.push(`--fingerprint-platform-version=${fp.platformVersion}`);
    }
    if (fp.brand) {
      flags.push(`--fingerprint-brand=${fp.brand}`);
    }
    if (fp.brandVersion) {
      flags.push(`--fingerprint-brand-version=${fp.brandVersion}`);
    }
    if (typeof fp.hardwareConcurrency === 'number') {
      flags.push(`--fingerprint-hardware-concurrency=${fp.hardwareConcurrency}`);
    }
    if (fp.timezone) {
      flags.push(`--timezone=${fp.timezone}`);
    }
    if (fp.lang) {
      flags.push(`--lang=${fp.lang}`);
    }
  }

  // User-provided additional args
  if (config.args && config.args.length > 0) {
    flags.push(...config.args);
  }

  return flags;
}

export async function waitForDevToolsActivePort(
  userDataDir: string,
  timeoutMs = 30000
): Promise<{ port: number; wsPath: string }> {
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        const lines = content.split('\n').map((l) => l.trim());
        if (lines.length >= 2) {
          const port = parseInt(lines[0], 10);
          const wsPath = lines[1];
          if (!isNaN(port) && wsPath) {
            // Verify TCP socket accepts connections
            const reachable = await checkPortReachable(port);
            if (reachable) {
              return { port, wsPath: wsPath.startsWith('/') ? wsPath : `/${wsPath}` };
            }
          }
        }
      }
    } catch {
      // Ignore reading errors while file is being written
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 100);
    await promise;
  }

  throw new Error(`Timeout waiting for DevToolsActivePort in ${userDataDir} after ${timeoutMs}ms`);
}

function checkPortReachable(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = new net.Socket();
  socket.setTimeout(timeoutMs);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => {
    socket.destroy();
    resolve(false);
  });
  socket.connect(port, host);
  return promise;
}

function generateRandomProfileDir(): string {
  const rand = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  const base = process.env.ANTIDETECT_DATA_DIR
    ? path.join(process.env.ANTIDETECT_DATA_DIR, 'profiles')
    : path.join(os.tmpdir(), 'antidetect-standalone-profiles');
  const dir = path.join(base, `profile-${rand}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function launchStandaloneProfile(config: StandaloneLaunchConfig = {}): Promise<StandaloneProfileInstance> {
  let executable = config.executablePath;
  if (!executable) {
    const acquired = await ensureEngine(config.engineOptions);
    executable = acquired.executable;
  }

  if (!fs.existsSync(executable)) {
    throw new Error(`Chromium executable not found at "${executable}"`);
  }

  const userDataDir = config.userDataDir ?? generateRandomProfileDir();
  fs.mkdirSync(userDataDir, { recursive: true });

  const effectiveConfig: StandaloneLaunchConfig = {
    ...config,
    executablePath: executable,
    userDataDir,
  };

  const args = buildStandaloneArgs(effectiveConfig);

  const child = spawn(executable, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error(`Failed to spawn Chromium process from ${executable}`);
  }

  try {
    const { port, wsPath } = await waitForDevToolsActivePort(userDataDir);
    const cdpUrl = `http://127.0.0.1:${port}`;
    const wsEndpoint = `ws://127.0.0.1:${port}${wsPath}`;

    const stop = async (): Promise<void> => {
      if (child.killed) return;
      const { promise, resolve } = Promise.withResolvers<void>();
      child.once('exit', () => resolve());
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }
        }, 3000);
      } catch {
        resolve();
      }
      return promise;
    };

    return {
      cdpUrl,
      wsEndpoint,
      port,
      userDataDir,
      pid: child.pid,
      process: child,
      stop,
    };
  } catch (err) {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    throw err;
  }
}
