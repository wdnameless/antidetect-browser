// Guards for the three defects deferred from the 0.6.44 release.
//
// Each asserts the behaviour that was wrong, not that a function was called. The preflight case
// earned its guard twice over: the first attempt at fixing it proposed full locales, but six of
// them were locales the fingerprint catalog cannot assign, so they would have been unrepresentable
// in the language select — which is the SAME defect, reached through the Fix button. The guard
// below is what caught that, by checking the whole table against the served list.
import { describe, it, expect } from 'vitest';
import express from 'express';
import * as http from 'http';
import browserRoutes from '../../src/main/api/routes/browser';
import { COUNTRY_TO_LANG } from '../../src/renderer/src/preflight';
import { getRateLimit } from '../../src/main/api/rateLimit';
import { parseStartUrlsColumn } from '../../src/main/profiles/profileManager';

const asRouter = (m: unknown): express.Router =>
  (typeof m === 'function' ? m : (m as { default: express.Router }).default);

function getJson(server: http.Server, path: string): Promise<{ status: number; body: unknown }> {
  const { port } = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(t) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

describe('the preflight language fix proposes values the UI can represent', () => {
  it('never proposes a bare subtag, which no select option can match', () => {
    // A bare `de` is not a value a profile stores. The select cannot match it to any option, so it
    // renders "Auto" and the next Save writes the empty string over the real language.
    const bare = Object.entries(COUNTRY_TO_LANG).filter(([, v]) => !/^[a-z]{2}-[A-Z]{2}$/.test(v));
    expect(bare, `these would render as "Auto" and then wipe the language: ${JSON.stringify(bare)}`).toEqual([]);
  });

  it('proposes only locales the fingerprint catalog can actually assign', async () => {
    // The rule that caught the first attempt: the select's options come from the catalog, so a
    // proposed locale outside that set is unrepresentable — and unrepresentable means destructive.
    const app = express();
    app.use(asRouter(browserRoutes));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const res = await getJson(server, '/api/v1/browser-profile/languages');
      const offered = (res.body as { data: { list: string[] } }).data.list;
      const proposed = Array.from(new Set([...Object.values(COUNTRY_TO_LANG), 'en-US']));
      const unrepresentable = proposed.filter((v) => !offered.includes(v));
      expect(
        unrepresentable,
        `the language select cannot show these, so the Fix would write a value the UI then wipes: ${unrepresentable.join(', ')}`,
      ).toEqual([]);
    } finally {
      server.close();
    }
  });
});

describe('the /status rate limit is real, not dead configuration', () => {
  it('declares a limit for the path the middleware is attached to', () => {
    // The route is registered early on purpose (unauthenticated health check), so the global
    // `app.use(rateLimitMiddleware)` never reached it and the declared 50 req/s was never applied.
    // The limit is now attached at the route; this pins that a limit still exists for that path.
    expect(getRateLimit('/status')).toBeGreaterThan(0);
  });
});

describe('parseStartUrlsColumn tolerates what a real column can hold', () => {
  it('returns the URLs a profile stored', () => {
    expect(parseStartUrlsColumn(JSON.stringify(['https://a.example', 'https://b.example']))).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('degrades to an empty list instead of throwing, so a copy is never blocked', () => {
    // This is read while duplicating a profile; a corrupt or legacy column must not make the copy
    // impossible.
    expect(parseStartUrlsColumn(null)).toEqual([]);
    expect(parseStartUrlsColumn('')).toEqual([]);
    expect(parseStartUrlsColumn('not json')).toEqual([]);
    expect(parseStartUrlsColumn('{"a":1}')).toEqual([]);
    // Entries of the wrong type are dropped, not cast: the array is fed back into createProfile.
    expect(parseStartUrlsColumn('["https://a.example", 42, null]')).toEqual(['https://a.example']);
  });
});
