// Kernel audit (Phase 0): test fingerprint-chromium 148 mobile support.
// Launches chrome.exe directly with candidate flags and reads signals via CDP.
// Run: npx tsx scripts/audit-kernel-mobile.ts
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer-core';

const KERNEL = path.join(
  'data', 'chromium', 'fingerprint-chromium',
  'ungoogled-chromium_148.0.7778.215-1.1_windows_x64', 'chrome.exe'
);
const TMP = path.join('data', 'audit-tmp');

interface Signals {
  platform: string;
  userAgent: string;
  userAgentData: unknown;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  screen: { w: number; h: number; dpr: number };
  touch: boolean;
  webglRenderer: string;
  webglVendor: string;
  webgl2Renderer: string;
  webgl2Vendor: string;
  languages: string[];
  timezone: string;
}

async function launchAndRead(label: string, extraArgs: string[]): Promise<Signals> {
  const dir = path.join(TMP, label.replace(/[^a-z0-9]/gi, '_'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const args = [
    `--user-data-dir=${path.resolve(dir)}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    ...extraArgs,
  ];

  const child: ChildProcess = spawn(path.resolve(KERNEL), args, { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  const deadline = Date.now() + 25000;
  let port = '';
  let wsPath = '';
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const lines = fs.readFileSync(portFile, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length >= 2) { port = lines[0].trim(); wsPath = lines[1].trim(); break; }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!port) {
    child.kill();
    throw new Error(`no DevToolsActivePort for ${label}`);
  }

  const ws = `ws://127.0.0.1:${port}${wsPath}`;
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await page.goto('about:blank');
    const signals = await page.evaluate(`(async () => {
      const gl = document.createElement('canvas').getContext('webgl');
      const gl2 = document.createElement('canvas').getContext('webgl2');
      const dbg = (c) => (c ? c.getExtension('WEBGL_debug_renderer_info') : null);
      const ext = (c) => {
        const d = dbg(c);
        return d
          ? {
              renderer: c.getParameter(d.UNMASKED_RENDERER_WEBGL),
              vendor: c.getParameter(d.UNMASKED_VENDOR_WEBGL),
            }
          : { renderer: 'n/a', vendor: 'n/a' };
      };
      const uaData = navigator.userAgentData ?? null;
      return {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        userAgentData: uaData,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? -1,
        maxTouchPoints: navigator.maxTouchPoints,
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
        touch: 'ontouchstart' in window,
        webglRenderer: ext(gl).renderer,
        webglVendor: ext(gl).vendor,
        webgl2Renderer: ext(gl2).renderer,
        webgl2Vendor: ext(gl2).vendor,
        languages: navigator.languages,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    })()`);
    return signals;
  } finally {
    browser.disconnect();
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main(): Promise<void> {
  const seed = 123456789;
  const cases: Array<{ label: string; args: string[] }> = [
    {
      label: 'baseline-windows',
      args: [`--fingerprint=${seed}`, '--fingerprint-platform=windows'],
    },
    {
      label: 'android-platform',
      args: [`--fingerprint=${seed}`, '--fingerprint-platform=android'],
    },
    {
      label: 'android-mobile-ua',
      args: [
        `--fingerprint=${seed}`,
        '--fingerprint-platform=android',
        '--fingerprint-screen-width=412',
        '--fingerprint-screen-height=915',
        '--fingerprint-device-scale-factor=2.625',
        '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
      ],
    },
  ];

  for (const c of cases) {
    try {
      const s = await launchAndRead(c.label, c.args);
      console.log(`\n=== ${c.label} ===`);
      console.log(JSON.stringify(s, null, 2));
    } catch (e) {
      console.log(`\n=== ${c.label} === ERROR: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error('AUDIT FAILED', e);
  process.exit(1);
});
