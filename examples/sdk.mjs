// Antidetect Browser — Local API SDK (zero-dependency, Node 18+).
// Wraps the AdsPower-compatible Local API with automatic retry on rate limits (429)
// and convenience helpers for Puppeteer/Playwright automation.
//
// Usage:
//   import { Antidetect } from './sdk.mjs';
//   const ad = new Antidetect({ apiKey: '...', base: 'http://127.0.0.1:50325' });
//   const { user_id } = await ad.create({ name: 'acc-1', start_urls: ['https://example.com'] });
//   const browser = await ad.connectPuppeteer(user_id);   // puppeteer-core
//   const browser = await ad.connectPlaywright(user_id); // playwright
//
// Rate limits (AdsPower parity): ALL endpoints are rate-limited per (client, path).
// list/cookies = 1 req/s, start/stop = 5 req/s, everything else = 10 req/s.
// The SDK retries automatically on HTTP 429, honoring `retry_after_ms` from the response.

// Mirrors src/main/api/rateLimit.ts (requests per second per path).
export const RATE_LIMITS = {
  '/api/v1/browser/list': 1,
  '/api/v2/browser-profile/list': 1,
  '/api/v1/proxy/list': 1,
  '/api/v1/device/list': 1,
  '/api/v1/extension/list': 1,
  '/api/v1/group/list': 1,
  '/api/v1/browser-profile/cookies/import': 1,
  '/api/v1/browser-profile/cookies/export': 1,
  '/api/v1/browser/start': 5,
  '/api/v1/browser/stop': 5,
  '/api/v2/browser-profile/start': 5,
  '/api/v2/browser-profile/stop': 5,
  default: 10,
};

export class Antidetect {
  constructor({ apiKey = '', base = 'http://127.0.0.1:50325', maxRetries = 5 } = {}) {
    this.apiKey = apiKey;
    this.base = base.replace(/\/$/, '');
    this.maxRetries = maxRetries;
  }

  async request(path, { method = 'GET', body, retries = this.maxRetries } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`API ${method} ${path} -> HTTP ${res.status} (non-JSON response)`);
    }
    if (res.status === 429 && retries > 0) {
      const wait = json?.data?.retry_after_ms ?? 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.request(path, { method, body, retries: retries - 1 });
    }
    if (json.code !== 0) {
      const err = new Error(json.msg || `API error on ${path}`);
      err.code = json.code;
      err.data = json.data;
      throw err;
    }
    return json.data;
  }

  // --- Core ---
  status() {
    return this.request('/status');
  }
  list({ page = 1, page_size = 100, group_id } = {}) {
    const q = new URLSearchParams({ page: String(page), page_size: String(page_size) });
    if (group_id) q.set('group_id', group_id);
    return this.request(`/api/v1/browser/list?${q}`);
  }
  create(body = {}) {
    return this.request('/api/v1/browser-profile/create', { method: 'POST', body });
  }
  update(user_id, body = {}) {
    return this.request('/api/v1/browser-profile/update', { method: 'POST', body: { user_id, ...body } });
  }
  detail(user_id) {
    return this.request(`/api/v1/browser-profile/detail?user_id=${encodeURIComponent(user_id)}`);
  }
  delete(user_id) {
    return this.request('/api/v1/browser-profile/delete', { method: 'POST', body: { user_id } });
  }
  start(user_id) {
    return this.request(`/api/v1/browser/start?user_id=${encodeURIComponent(user_id)}`);
  }
  stop(user_id) {
    return this.request(`/api/v1/browser/stop?user_id=${encodeURIComponent(user_id)}`);
  }
  randomizeFingerprint(user_id) {
    return this.request('/api/v1/browser-profile/randomize-fingerprint', { method: 'POST', body: { user_id } });
  }

  // --- Groups / proxies / devices ---
  groupList() {
    return this.request('/api/v1/group/list');
  }
  groupCreate(name) {
    return this.request('/api/v1/group/create', { method: 'POST', body: { name } });
  }
  proxyList() {
    return this.request('/api/v1/proxy/list');
  }
  proxyCreate(body) {
    return this.request('/api/v1/proxy/create', { method: 'POST', body });
  }
  proxyTest(body) {
    return this.request('/api/v1/proxy/test', { method: 'POST', body });
  }
  deviceList() {
    return this.request('/api/v1/device/list');
  }

  // --- Automation helpers ---
  // Start a profile and connect with puppeteer-core (must be installed by the caller).
  async connectPuppeteer(user_id) {
    const { default: puppeteer } = await import('puppeteer-core');
    const data = await this.start(user_id);
    return puppeteer.connect({ browserWSEndpoint: data.ws.puppeteer, defaultViewport: null });
  }

  // Start a profile and connect with Playwright (must be installed by the caller).
  async connectPlaywright(user_id) {
    const { chromium } = await import('playwright');
    const data = await this.start(user_id);
    return chromium.connectOverCDP(data.ws.puppeteer);
  }
}
