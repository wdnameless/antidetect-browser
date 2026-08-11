// Downloads a Chrome for Testing build into data/chromium and prints its executable path.
// Usage: npm run install-chromium
import { install, detectBrowserPlatform, resolveBuildId, Browser } from '@puppeteer/browsers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(__dirname, '..', 'data', 'chromium');

const platform = detectBrowserPlatform();
if (!platform) {
  console.error('Could not detect platform.');
  process.exit(1);
}

const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
console.log(`Installing Chrome for Testing ${buildId} (${platform}) into ${cacheDir} ...`);

const installed = await install({
  browser: Browser.CHROME,
  buildId,
  cacheDir,
  baseUrl: 'https://storage.googleapis.com/chrome-for-testing-public',
});

console.log('Installed executable:', installed.executablePath);
console.log('Set CHROMIUM_PATH to this path (or the launcher will auto-detect it under data/chromium).');
