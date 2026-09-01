import { spawn, ChildProcess, execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import puppeteer from 'puppeteer-core';
import { getChromiumPath, getChromedriverPath } from '../config';
import type { LaunchConfig } from '../profiles/profileManager';
import { setStatus } from '../profiles/profileManager';
import {
  isTemporaryProfile,
  cleanTemporaryDirectory,
  unregisterTemporaryProfile,
} from '../profiles/temporaryRegistry';
import { createSshTunnel, SshTunnel } from '../proxy/sshTunnel';
import { installProxyAuth } from '../proxy/proxyAuth';
import { applyDeviceEmulation } from '../proxy/deviceEmulation';
import { applyStealth, writeStealthExtension, LogicalPlatform } from '../proxy/stealthInjection';
import { applyGeolocation } from '../proxy/geoEmulation';
import { injectCookies } from '../proxy/cookieInjector';
import { detectMachineTimezone } from '../util/ipInfo';
import {
  probeTransportTarget,
  composeTransportFlags,
  registerActiveProfile,
  unregisterActiveProfile,
  TransportProbeTarget,
} from '../proxy/transportPolicy';

interface RunningProfile {
  pid: number;
  port: string;
  wsPuppeteer: string;
  wsSelenium: string;
  process: ChildProcess;
  tunnel?: SshTunnel;
  cleanupAuth?: () => void;
  cleanupEmulation?: () => void;
  cleanupGeo?: () => void;
  cleanupStealth?: () => void;
  cleanupTransport?: () => void;
}

export interface StartResult {
  ws: { puppeteer: string; selenium: string };
  debug_port: string;
  webdriver: string;
  pid: number;
}

const running = new Map<string, RunningProfile>();

export function isRunning(profileId: string): boolean {
  return running.has(profileId);
}

export function getRunningWs(profileId: string): string | undefined {
  return running.get(profileId)?.wsPuppeteer;
}

/** Loopback CDP endpoint of a running profile (port + ws path), for the tunnel. */
export function getCdpEndpoint(profileId: string): { port: string; wsPath: string } | undefined {
  const rec = running.get(profileId);
  if (!rec) return undefined;
  const wsPath = rec.wsPuppeteer.slice(rec.wsPuppeteer.indexOf('/devtools/'));
  return { port: rec.port, wsPath };
}

/** Loopback CDP debug port of a running profile (diagnostics/CDP helpers). */
export function getRunningPort(profileId: string): string | undefined {
  return running.get(profileId)?.port;
}

function toResult(r: RunningProfile): StartResult {
  return {
    ws: { puppeteer: r.wsPuppeteer, selenium: r.wsSelenium },
    debug_port: r.port,
    // Selenium via debuggerAddress: path to chromedriver matching the kernel (Chromium 148).
    webdriver: getChromedriverPath() ?? '',
    pid: r.pid,
  };
}

/**
 * Kill the browser process tree. Chromium spawns multiple child processes;
 * on Windows `kill()` alone may leave orphans, so prefer `taskkill /T /F`.
 */
function killTree(rec: RunningProfile): void {
  if (process.platform === 'win32' && rec.pid) {
    try {
      execFile('taskkill', ['/pid', String(rec.pid), '/T', '/F'], () => {
        // fallback if taskkill failed for any reason
        try {
          rec.process.kill();
        } catch {
          // ignore
        }
      });
      return;
    } catch {
      // fall through to plain kill
    }
  }
  try {
    rec.process.kill();
  } catch {
    // ignore
  }
}

function cleanup(rec: RunningProfile): void {
  killTree(rec);
  if (rec.cleanupTransport) {
    try {
      rec.cleanupTransport();
    } catch {
      // ignore
    }
  }
  if (rec.tunnel) void rec.tunnel.close();
  if (rec.cleanupAuth) {
    try {
      rec.cleanupAuth();
    } catch {
      // ignore
    }
  }
  if (rec.cleanupEmulation) {
    try {
      rec.cleanupEmulation();
    } catch {
      // ignore
    }
  }
  if (rec.cleanupGeo) {
    try {
      rec.cleanupGeo();
    } catch {
      // ignore
    }
  }
  if (rec.cleanupStealth) {
    try {
      rec.cleanupStealth();
    } catch {
      // ignore
    }
  }
}

export async function buildChromiumArgs(
  cfg: LaunchConfig,
  proxyServer?: string,
  transportFlags: string[] = []
): Promise<string[]> {
  const args: string[] = [
    `--user-data-dir=${cfg.userDataDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    // Keep session cookies on disk too — logins must survive restarts.
    '--persist-session-cookies',
  ];
  if (cfg.headless) {
    args.push('--headless=new');
  }
  if (transportFlags.length > 0) {
    args.push(...transportFlags);
  } else if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }

  // Desktop screen resolution override (AdsPower-style, from fingerprint config).
  if (cfg.screenOverride) {
    args.push(`--window-size=${cfg.screenOverride.width},${cfg.screenOverride.height}`);
    args.push(`--window-position=0,0`);
  }

  // Kernel fingerprint flags (fingerprint-chromium). Stock Chromium ignores unknown flags,
  // so this is safe even when a stock binary is resolved.
  if (cfg.fingerprint && cfg.fingerprint.seed > 0) {
    args.push(`--fingerprint=${cfg.fingerprint.seed}`);
    if (cfg.fingerprint.platform) args.push(`--fingerprint-platform=${cfg.fingerprint.platform}`);
    if (cfg.fingerprint.platformVersion) {
      args.push(`--fingerprint-platform-version=${cfg.fingerprint.platformVersion}`);
    }
    if (cfg.fingerprint.brand) args.push(`--fingerprint-brand=${cfg.fingerprint.brand}`);
    if (cfg.fingerprint.brandVersion) {
      args.push(`--fingerprint-brand-version=${cfg.fingerprint.brandVersion}`);
    }
    if (cfg.fingerprint.hardwareConcurrency) {
      args.push(`--fingerprint-hardware-concurrency=${cfg.fingerprint.hardwareConcurrency}`);
    }
    if (cfg.fingerprint.disableSpoofing) {
      args.push(`--disable-spoofing=${cfg.fingerprint.disableSpoofing}`);
    }
    // Explicit profile timezone wins; otherwise auto-detect from the proxy IP;
    // otherwise detect from the machine's egress IP (keeps timezone coherent with IP).
    const timezone =
      cfg.fingerprint.timezone ?? cfg.proxyTimezone ?? (await detectMachineTimezone());
    if (timezone) args.push(`--timezone=${timezone}`);
    if (cfg.fingerprint.lang) {
      args.push(`--lang=${cfg.fingerprint.lang}`);
      args.push(`--accept-lang=${cfg.fingerprint.lang}`);
    }
  }

  // Extensions & Stealth layer: load bound unpacked extensions and stealth MV3 extension.
  // CDP script injection is broken in this kernel, so the stealth script ships as an
  // extension loaded via --load-extension (kernel supports it, verified in Sprint B).
  const extensionsToLoad: string[] = [];
  if (cfg.extensionPaths && cfg.extensionPaths.length) {
    extensionsToLoad.push(...cfg.extensionPaths);
  }
  if (cfg.stealth) {
    const stealthExtDir = path.join(cfg.userDataDir, 'stealth-ext');
    writeStealthExtension(stealthExtDir, cfg.stealth);
    extensionsToLoad.push(stealthExtDir);
  }
  if (extensionsToLoad.length > 0) {
    args.push(`--load-extension=${extensionsToLoad.join(',')}`);
  }

  return args;
}

export async function startProfile(cfg: LaunchConfig): Promise<StartResult> {
  const existing = running.get(cfg.profileId);
  if (existing) return toResult(existing);

  const executable = getChromiumPath();
  fs.mkdirSync(cfg.userDataDir, { recursive: true });
  // Remove a stale DevToolsActivePort from a previous run: otherwise waitForDevToolsPort
  // may read the old (dead) port before the new process writes its own.
  try {
    fs.rmSync(path.join(cfg.userDataDir, 'DevToolsActivePort'), { force: true });
  } catch {
    // ignore
  }

  // SSH proxies are tunneled to a local SOCKS5 endpoint first.
  let tunnel: SshTunnel | undefined;
  let proxyServer = cfg.proxyServer;
  if (cfg.sshTunnel) {
    tunnel = await createSshTunnel(cfg.sshTunnel);
    proxyServer = `socks5://127.0.0.1:${tunnel.port}`;
  }

  // Network Transport Policy pre-launch probe & flag composition
  let transportFlags: string[] = [];
  if (proxyServer || cfg.sshTunnel) {
    let target: TransportProbeTarget;
    if (cfg.sshTunnel) {
      target = { protocol: 'ssh', host: cfg.sshTunnel.host, port: cfg.sshTunnel.port };
    } else {
      try {
        const url = new URL(proxyServer!.startsWith('http') || proxyServer!.startsWith('socks') ? proxyServer! : `http://${proxyServer!}`);
        const protocol = url.protocol.replace(':', '') as TransportProbeTarget['protocol'];
        target = {
          protocol,
          host: url.hostname,
          port: parseInt(url.port, 10) || (protocol === 'socks5' ? 1080 : 80),
          username: cfg.proxyAuth?.username,
          password: cfg.proxyAuth?.password,
        };
      } catch {
        target = { protocol: 'socks5', host: '127.0.0.1', port: 1080 };
      }
    }

    const probeResult = await probeTransportTarget(target);
    if (probeResult.status === 'REFUSE') {
      const err = new Error(`Proxy transport probe failed at stage ${probeResult.error?.stage}: ${probeResult.error?.message}`);
      (err as unknown as { stage?: string; code?: string }).stage = probeResult.error?.stage;
      (err as unknown as { stage?: string; code?: string }).code = probeResult.error?.code;
      throw err;
    }

    transportFlags = composeTransportFlags(probeResult, proxyServer);
  }
  const args = await buildChromiumArgs(cfg, proxyServer, transportFlags);
  let child: ChildProcess;
  try {
    if (!fs.existsSync(executable) && executable !== 'chrome.exe') {
      if (tunnel) void tunnel.close();
      throw new Error(`Chromium binary not found at "${executable}". Please check installation.`);
    }
    child = spawn(executable, args, { stdio: 'ignore' });
  } catch (err) {
    if (tunnel) void tunnel.close();
    throw new Error(`Failed to launch browser (${executable}): ${(err as Error).message}`);
  }

  child.on('error', (err) => {
    console.error('[chromium] child process error:', err.message);
  });

  if (!child.pid) {
    if (tunnel) void tunnel.close();
    throw new Error(`failed to spawn chromium (${executable})`);
  }

  try {
    const { port, wsPath } = await waitForDevToolsPort(cfg.userDataDir);
    const wsPuppeteer = `ws://127.0.0.1:${port}${wsPath}`;

    // Install proxy auth handler (CDP Fetch) before handing the endpoint to the caller.
    let cleanupAuth: (() => void) | undefined;
    if (cfg.proxyAuth) {
      cleanupAuth = await installProxyAuth(wsPuppeteer, cfg.proxyAuth);
    }

    // Mobile device emulation (touch/screen/UA) via CDP.
    let cleanupEmulation: (() => void) | undefined;
    if (cfg.deviceEmulation) {
      cleanupEmulation = await applyDeviceEmulation(wsPuppeteer, cfg.deviceEmulation);
    }

    // Stealth layer: Client Hints + headless-trace fixes (always applied).
    let cleanupStealth: (() => void) | undefined;
    if (cfg.stealth) {
      cleanupStealth = await applyStealth(wsPuppeteer, cfg.stealth);
    }

    // Geolocation spoofing via CDP (Sprint A).
    let cleanupGeo: (() => void) | undefined;
    if (cfg.geolocation) {
      cleanupGeo = await applyGeolocation(wsPuppeteer, cfg.geolocation);
    }

    // Cookie injection via CDP (Sprint A).
    if (cfg.cookies && cfg.cookies.length) {
      await injectCookies(wsPuppeteer, cfg.cookies);
    }

    // Desktop screen resolution override via CDP (screen.* metrics + viewport).
    if (cfg.screenOverride) {
      try {
        const sBrowser = await puppeteer.connect({ browserWSEndpoint: wsPuppeteer, defaultViewport: null });
        try {
          const targets = await sBrowser.targets();
          const pageTarget = targets.find((t) => t.type() === 'page');
          if (pageTarget) {
            const session = await pageTarget.createCDPSession();
            await session.send('Emulation.setDeviceMetricsOverride', {
              width: cfg.screenOverride.width,
              height: cfg.screenOverride.height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await session.detach().catch(() => undefined);
          }
        } finally {
          sBrowser.disconnect();
        }
      } catch {
        // screen override is best-effort; window-size flag already applied
      }
    }

    // Start URLs (v0.2.6): open on start (first in current tab, rest in new tabs).
    if (cfg.startUrls && cfg.startUrls.length) {
      try {
        const sBrowser = await puppeteer.connect({ browserWSEndpoint: wsPuppeteer, defaultViewport: null });
        const pages = await sBrowser.pages();
        const first = pages[0] ?? (await sBrowser.newPage());
        await first.goto(cfg.startUrls[0], { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        for (const url of cfg.startUrls.slice(1)) {
          const p = await sBrowser.newPage();
          await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        }
        sBrowser.disconnect();
      } catch {
        // start_urls are convenience; not fatal if a navigation fails
      }
    }

    const rec: RunningProfile = {
      pid: child.pid,
      port,
      wsPuppeteer,
      wsSelenium: `127.0.0.1:${port}`,
      process: child,
      tunnel,
      cleanupAuth,
      cleanupEmulation,
      cleanupGeo,
      cleanupStealth,
    };
    const unregisterTransport = registerActiveProfile(cfg.profileId, (reason) => {
      // Immediate mid-session termination on transport loss (zero direct fallback)
      const current = running.get(cfg.profileId);
      if (current) {
        cleanup(current);
        running.delete(cfg.profileId);
      }
    });
    rec.cleanupTransport = unregisterTransport;

    child.on('exit', () => {
      running.delete(cfg.profileId);
      unregisterTransport();
      if (rec.tunnel) void rec.tunnel.close();
      if (rec.cleanupAuth) {
        try {
          rec.cleanupAuth();
        } catch {
          // ignore
        }
      }
      if (rec.cleanupEmulation) {
        try {
          rec.cleanupEmulation();
        } catch {
          // ignore
        }
      }
      if (rec.cleanupGeo) {
        try {
          rec.cleanupGeo();
        } catch {
          // ignore
        }
      }
      if (rec.cleanupStealth) {
        try {
          rec.cleanupStealth();
        } catch {
          // ignore
        }
      }
      // Watchdog: keep the DB status in sync when the kernel exits on its own
      // (crash, manual close of the browser window). Intentionally swallows
      // errors so the exit path never throws.
      if (!cfg.temporary && !isTemporaryProfile(cfg.profileId)) {
        try {
          setStatus(cfg.profileId, 'closed');
        } catch {
          // ignore
        }
      }

      // Temporary profile cleanup: purge ephemeral directory on exit and unregister
      if (cfg.temporary || isTemporaryProfile(cfg.profileId)) {
        void cleanTemporaryDirectory(cfg.userDataDir).catch(() => {});
        unregisterTemporaryProfile(cfg.profileId);
      }
    });
    return toResult(rec);
  } catch (err) {
    cleanup({ pid: child.pid, port: '', wsPuppeteer: '', wsSelenium: '', process: child, tunnel });
    throw err;
  }
}

/**
 * Stop a profile: graceful close first (Chromium flushes cookies/sessions to
 * disk on clean shutdown), wait for the process to exit, force-kill as fallback.
 */
export async function stopProfile(profileId: string): Promise<boolean> {
  const rec = running.get(profileId);
  if (!rec) return false;
  try {
    const b = await puppeteer.connect({ browserWSEndpoint: rec.wsPuppeteer, defaultViewport: null });
    await b.close().catch(() => undefined);
  } catch {
    // already dead — the exit handler cleaned up
  }
  // Wait for the exit handler to run (up to 5s).
  await new Promise<void>((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (!running.has(profileId) || Date.now() - t0 > 5000) {
        clearInterval(iv);
        resolve();
      }
    }, 150);
  });
  // Still alive? Force-kill the tree.
  if (running.has(profileId)) {
    cleanup(rec);
    running.delete(profileId);
  }
  return true;
}

export async function stopAll(): Promise<void> {
  for (const id of Array.from(running.keys())) await stopProfile(id);
}

async function waitForDevToolsPort(userDataDir: string): Promise<{ port: string; wsPath: string }> {
  const file = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length >= 2) {
        return { port: lines[0].trim(), wsPath: lines[1].trim() };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for DevToolsActivePort (is a Chromium binary available?)');
}
