// Full headless-signal dump on creepjs page: languages, deviceMemory, AudioContext, WebGL, canvas.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-headless.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'probe-headless' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    await page.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));

    const res = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      out.languages = navigator.languages;
      out.language = navigator.language;
      out.deviceMemory = navigator.deviceMemory;
      out.hardwareConcurrency = navigator.hardwareConcurrency;
      out.maxTouchPoints = navigator.maxTouchPoints;
      out.platform = navigator.platform;
      out.vendor = navigator.vendor;
      out.uaDataBrands = navigator.userAgentData ? navigator.userAgentData.brands : null;
      out.uaDataMobile = navigator.userAgentData ? navigator.userAgentData.mobile : null;
      out.uaDataPlatform = navigator.userAgentData ? navigator.userAgentData.platform : null;
      out.uaDataArch = navigator.userAgentData ? navigator.userAgentData.architecture : null;
      out.uaDataBitness = navigator.userAgentData ? navigator.userAgentData.bitness : null;
      out.uaDataModel = navigator.userAgentData ? navigator.userAgentData.model : null;
      out.uaDataPlatformVersion = navigator.userAgentData ? navigator.userAgentData.platformVersion : null;
      out.uaDataFullVersionList = navigator.userAgentData ? navigator.userAgentData.fullVersionList : null;
      out.uaDataFormFactors = navigator.userAgentData ? navigator.userAgentData.formFactors : null;
      out.uaDataWow64 = navigator.userAgentData ? navigator.userAgentData.wow64 : null;
      out.webdriver = navigator.webdriver;
      out.chromeKeys = Object.keys(window.chrome || {});
      out.runtime = !!window.chrome?.runtime;
      out.webstore = !!window.chrome?.webstore;
      out.notification = Notification.permission;
      out.plugins = navigator.plugins.length;
      out.mimeTypes = navigator.mimeTypes.length;
      out.orientation = screen.orientation?.type;
      out.outerW = window.outerWidth;
      out.innerW = window.innerWidth;
      out.outerH = window.outerHeight;
      out.innerH = window.innerHeight;
      out.screenW = screen.width;
      out.screenH = screen.height;
      out.screenAvailW = screen.availWidth;
      out.screenAvailH = screen.availHeight;
      out.colorDepth = screen.colorDepth;
      out.pixelDepth = screen.pixelDepth;
      out.dpr = window.devicePixelRatio;
      out.visibility = document.visibilityState;
      out.hidden = document.hidden;
      out.hasCdc = !!window.cdc_;
      out.domAutomation = !!window.domAutomation;
      out.domAutomationController = !!window.domAutomationController;
      out.permissionsQuery = null;
      try {
        out.permissionsQuery = navigator.permissions.query({ name: 'notifications' }).then((s) => s.state);
      } catch (e) {
        out.permissionsQuery = 'ERR';
      }
      out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      out.audioSampleRate = null;
      try {
        const ctx = new AudioContext();
        out.audioSampleRate = ctx.sampleRate;
        ctx.close();
      } catch (e) {
        out.audioSampleRate = 'ERR';
      }
      out.webglRenderer = null;
      out.webglVendor = null;
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          out.webglRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          out.webglVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        }
      } catch (e) {
        out.webglRenderer = 'ERR';
      }
      out.canvasHash = null;
      try {
        const c = document.createElement('canvas');
        c.width = 200; c.height = 50;
        const ctx = c.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Hello, world! 1234567890', 2, 2);
        out.canvasHash = c.toDataURL().slice(0, 80);
      } catch (e) {
        out.canvasHash = 'ERR';
      }
      out.mediaDevices = null;
      try {
        out.mediaDevices = navigator.mediaDevices.enumerateDevices().then((d) => d.map((x) => x.kind).join(','));
      } catch (e) {
        out.mediaDevices = 'ERR';
      }
      return out;
    });
    // resolve promises
    const final = await page.evaluate(async () => {
      const r: Record<string, unknown> = {};
      r.permissionsQuery = await (window as any).__pq;
      r.mediaDevices = await (window as any).__md;
      return r;
    });
    console.log(JSON.stringify(res, null, 2));
    console.log('resolved:', JSON.stringify(final));
  } finally {
    browser.disconnect();
  }
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  process.exit(0);
}

main().catch((err) => {
  console.error('PROBE FAILED', err);
  process.exit(1);
});
