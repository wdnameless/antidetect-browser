// Example: drive a profile with Puppeteer via the AdsPower-compatible Local API.
// Usage: API_KEY=<key> node examples/puppeteer.mjs <profileId>
import puppeteer from 'puppeteer-core';

const API = process.env.API_BASE || 'http://127.0.0.1:50325';
const API_KEY = process.env.API_KEY || '';
const profileId = process.argv[2];
if (!profileId) {
  console.error('usage: API_KEY=<key> node examples/puppeteer.mjs <profileId>');
  process.exit(1);
}

const res = await fetch(`${API}/api/v1/browser/start?user_id=${encodeURIComponent(profileId)}`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
}).then((r) => r.json());

if (res.code !== 0) {
  console.error('start failed:', res.msg);
  process.exit(1);
}

const browser = await puppeteer.connect({
  browserWSEndpoint: res.data.ws.puppeteer,
  defaultViewport: null,
});
const pages = await browser.pages();
const page = pages[0] ?? (await browser.newPage());
await page.goto('https://whoer.net');
console.log('title:', await page.title());
console.log('CDP endpoint:', res.data.ws.puppeteer);
// Keep the browser open; disconnect without closing:
browser.disconnect();
