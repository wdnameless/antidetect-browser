import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getChromiumPath } from '../config';
import type { LaunchConfig } from '../profiles/profileManager';
import { createSshTunnel, SshTunnel } from '../proxy/sshTunnel';
import { installProxyAuth } from '../proxy/proxyAuth';
import { applyDeviceEmulation } from '../proxy/deviceEmulation';
import { applyGeolocation } from '../proxy/geoEmulation';
import { injectCookies } from '../proxy/cookieInjector';
import { detectMachineTimezone } from '../util/ipInfo';

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

function toResult(r: RunningProfile): StartResult {
  return {
    ws: { puppeteer: r.wsPuppeteer, selenium: r.wsSelenium },
    debug_port: r.port,
    // AdsPower returns a chromedriver path here for Selenium. In MVP callers supply their own driver.
    webdriver: '',
    pid: r.pid,
  };
}

function cleanup(rec: RunningProfile): void {
  try {
    rec.process.kill();
  } catch {
    // ignore
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
}

export async function startProfile(cfg: LaunchConfig): Promise<StartResult> {
  const existing = running.get(cfg.profileId);
  if (existing) return toResult(existing);

  const executable = getChromiumPath();
  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  // SSH proxies are tunneled to a local SOCKS5 endpoint first.
  let tunnel: SshTunnel | undefined;
  let proxyServer = cfg.proxyServer;
  if (cfg.sshTunnel) {
    tunnel = await createSshTunnel(cfg.sshTunnel);
    proxyServer = `socks5://127.0.0.1:${tunnel.port}`;
  }

  const args: string[] = [
    `--user-data-dir=${cfg.userDataDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
    // NOTE: --proxy-server does not accept inline credentials; authenticated
    // proxies are handled via CDP Fetch.continueWithAuth below.
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

  // Extensions (Sprint B): load bound unpacked extensions.
  if (cfg.extensionPaths && cfg.extensionPaths.length) {
    const joined = cfg.extensionPaths.join(',');
    args.push(`--load-extension=${joined}`);
  }

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

    // Geolocation spoofing via CDP (Sprint A).
    let cleanupGeo: (() => void) | undefined;
    if (cfg.geolocation) {
      cleanupGeo = await applyGeolocation(wsPuppeteer, cfg.geolocation);
    }

    // Cookie injection via CDP (Sprint A).
    if (cfg.cookies && cfg.cookies.length) {
      await injectCookies(wsPuppeteer, cfg.cookies);
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
    };
    running.set(cfg.profileId, rec);
    child.on('exit', () => {
      running.delete(cfg.profileId);
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
    });
    return toResult(rec);
  } catch (err) {
    cleanup({ pid: child.pid, port: '', wsPuppeteer: '', wsSelenium: '', process: child, tunnel });
    throw err;
  }
}

export function stopProfile(profileId: string): boolean {
  const rec = running.get(profileId);
  if (!rec) return false;
  cleanup(rec);
  running.delete(profileId);
  return true;
}

export function stopAll(): void {
  for (const id of Array.from(running.keys())) stopProfile(id);
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
