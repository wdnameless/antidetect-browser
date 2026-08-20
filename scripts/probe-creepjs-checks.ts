// Replicate creepjs headless/stealth checks to find remaining flags.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-creepjs-checks.ts
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
    body: JSON.stringify({ name: 'probe-creepjs-checks' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

    const res = await page.evaluate(async () => {
      const out: Record<string, unknown> = {};
      // headless.webDriverIsOn components
      out.cssBorderEnd = CSS.supports('border-end-end-radius: initial');
      out.webdriver = navigator.webdriver;
      out.webdriverOwnDesc = !!Object.getOwnPropertyDescriptor(navigator, 'webdriver');
      out.webdriverProtoDesc = !!Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
      // getter toString native?
      const pd = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
      out.webdriverGetterToString = pd && pd.get ? String(pd.get).slice(0, 60) : null;
      // stealth.hasIframeProxy
      try {
        const iframe = document.createElement('iframe');
        iframe.srcdoc = 'x';
        out.iframeProxy = !!iframe.contentWindow;
      } catch (e) { out.iframeProxy = 'ERR'; }
      // stealth.hasHighChromeIndex
      out.highChromeIndex = Object.keys(window).slice(-50).includes('chrome') && Object.getOwnPropertyNames(window).slice(-50).includes('chrome');
      // stealth.hasBadChromeRuntime
      try {
        const rt = (window.chrome as any)?.runtime;
        out.badChromeRuntime = rt ? (('prototype' in rt.sendMessage) || ('prototype' in rt.connect)) : false;
      } catch (e) { out.badChromeRuntime = 'ERR'; }
      // stealth.hasToStringProxy — check if any of our stub functions have non-native toString
      const rt = (window.chrome as any)?.runtime;
      out.sendMessageToString = rt ? String(rt.sendMessage).slice(0, 50) : null;
      out.connectToString = rt ? String(rt.connect).slice(0, 50) : null;
      // stealth.hasBadWebGL: main vs worker renderer
      const gl = document.createElement('canvas').getContext('webgl');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      out.mainRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
      out.workerRenderer = await new Promise((resolve) => {
        try {
          const workerSrc =
            "const gl = document.createElement('canvas').getContext('webgl');" +
            "const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');" +
            "self.postMessage(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null);";
          const w = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
          w.onmessage = (e) => { resolve(e.data); w.terminate(); };
          w.onerror = () => resolve('ERR');
        } catch (e) { resolve('ERR'); }
      });
      out.badWebGL = !!(out.mainRenderer && out.workerRenderer && out.mainRenderer !== out.workerRenderer);
      return out;
    });
    console.log(JSON.stringify(res, null, 2));
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
