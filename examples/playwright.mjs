// Example: drive a profile with Playwright via the AdsPower-compatible Local API.
// Usage: API_KEY=<key> node examples/playwright.mjs <profileId>
import { chromium } from 'playwright';

const API = process.env.API_BASE || 'http://127.0.0.1:50325';
const API_KEY = process.env.API_KEY || '';
const profileId = process.argv[2];
if (!profileId) {
  console.error('usage: API_KEY=<key> node examples/playwright.mjs <profileId>');
  process.exit(1);
}

const res = await fetch(`${API}/api/v1/browser/start?user_id=${encodeURIComponent(profileId)}`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
}).then((r) => r.json());

if (res.code !== 0) {
  console.error('start failed:', res.msg);
  process.exit(1);
}

const browser = await chromium.connectOverCDP(res.data.ws.puppeteer);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://whoer.net');
console.log('title:', await page.title());
console.log('CDP endpoint:', res.data.ws.puppeteer);
// Keep the browser open; do not close.
