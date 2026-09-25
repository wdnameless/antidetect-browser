// The endpoint and the catalog must agree. A renderer-side list silently lost 14 locales; this
// pins the served list to the catalog so the two can never diverge again.
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import * as http from 'http';
import browserRoutes from '../../src/main/api/routes/browser';
import { EXTENDED_FINGERPRINT_CATALOG, WINDOWS_FINGERPRINT_CATALOG } from '../../src/main/fingerprints/catalog';

function get(server: http.Server, path: string): Promise<{ code: number; data: { list: string[] } }> {
  const { port } = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const R = (m: unknown) => (typeof m === 'function' ? m : (m as { default: unknown }).default) as express.Router;

describe('GET /api/v1/browser-profile/languages', () => {
  let server: http.Server;
  beforeAll(async () => {
    const app = express();
    app.use(R(browserRoutes));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  });

  it('serves exactly the locales the fingerprint catalog can assign', async () => {
    const res = await get(server, '/api/v1/browser-profile/languages');
    const expected = Array.from(
      new Set([...WINDOWS_FINGERPRINT_CATALOG, ...EXTENDED_FINGERPRINT_CATALOG].flatMap((f) => f.localePool))
    ).sort();
    expect(res.code).toBe(0);
    expect(res.data.list).toEqual(expected);
  });

  it('covers every locale a real profile could already hold, so none is unrepresentable', async () => {
    const res = await get(server, '/api/v1/browser-profile/languages');
    // These are the locales the old hand-written list omitted; each one made its profile's
    // language impossible to display, and saving that profile wiped it.
    for (const code of ['es-MX', 'en-CA', 'en-AU', 'zh-CN', 'ja-JP', 'pl-PL', 'id-ID', 'nl-NL']) {
      expect(res.data.list, `${code} must be selectable or saving such a profile destroys it`).toContain(code);
    }
  });
});
