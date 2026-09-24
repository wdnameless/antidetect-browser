// Every proxy gets looked up, once, at a pace the free geo service tolerates.
//
// The reported defect was not that the check was wrong — it was that on most paths it never
// happened at all. A proxy created through the Proxies page was checked by that page; a proxy
// created by an agent, an SDK, a batch create or an import was written with `country = NULL,
// status = 'unknown'` and nothing ever asked where it exits, so its row said "Not checked yet"
// forever. The queue in `proxyManager` is the single owner now, and these cases pin the two things
// that make it work: it runs no matter which door created the proxy, and it does not fire every
// request at once.
//
// The second half is why this cannot simply be "await a check inside createProxy": a 142-line
// import would open 142 concurrent lookups, the provider would rate-limit them, and the operator
// would see the geo feature fail — the defect, reintroduced in the name of fixing it.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import {
  createProxy,
  getProxy,
  getGeoFillStatus,
  queueGeoChecks,
  startGeoFill,
  stopGeoFill,
  onProxyGeoResolved,
} from '../../../src/main/proxy/proxyManager';
import { createProfile } from '../../../src/main/profiles/profileManager';
import { initDb, getDb } from '../../../src/main/db';

/*
 * A transparent proxy agent, standing in for `http-proxy-agent`.
 *
 * Not a mock of the behaviour under test: it does exactly what the real agent does — opens a
 * socket to the proxy and sends the request with an absolute URI, so `checkProxy` still builds a
 * real `http.request`, sends real bytes and parses a real response.
 *
 * It has to be defined HERE rather than imported, because under Vitest the `http` builtin that
 * `http-proxy-agent` resolves is a different module instance from the one this file imports, so
 * its class fails Node's `agent instanceof Agent` check and the request silently falls back to a
 * DIRECT connection — the stub is never reached and the proxy path is never exercised. The real
 * agent works correctly outside the test runner; this only works around the runner's module
 * identity.
 */
const PROXY_TARGET = vi.hoisted(() => ({ port: 0 }));
vi.mock('http-proxy-agent', () => ({
  HttpProxyAgent: class extends http.Agent {
    constructor() {
      super({ keepAlive: false });
    }
    /**
     * Hand the request a socket to the PROXY, addressed the way a proxy is: an absolute URI in the
     * request line. `req.onSocket` is the mechanism `http-proxy-agent` itself uses — Node then
     * writes the request line from `req.path` and parses the reply, so the code under test does a
     * real HTTP exchange over a real socket.
     */
    addRequest(req: http.ClientRequest): void {
      const socket = net.connect(PROXY_TARGET.port, '127.0.0.1');
      req.path = `http://${req.getHeader('host')}${req.path}`;
      req.onSocket(socket);
    }
  },
}));

/**
 * Stop the queue and wait for the worker to actually finish, so a test can assert a total request
 * count without racing an in-flight check that has already been paid for.
 */
async function stopAndSettle(): Promise<void> {
  stopGeoFill();
  const DEADLINE_MS = 4000;
  const started = Date.now();
  while (getGeoFillStatus().current_proxy_id !== null || getGeoFillStatus().running) {
    if (Date.now() - started > DEADLINE_MS) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** The provider's real answer shape, including the field the flag is derived from. */
const GEO_BODY = JSON.stringify({
  status: 'success',
  country: 'Germany',
  countryCode: 'DE',
  city: 'Falkenstein',
  timezone: 'Europe/Berlin',
  lat: 50.4777,
  lon: 12.3649,
  query: '88.99.90.19',
});

describe('proxy geo queue', () => {
  let server: http.Server;
  let port = 0;
  let requests: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  /**
   * Delay before the stub answers, so a test can hold a request "in flight" and exercise the
   * window where the id is reserved but unresolved. With an instant answer that window does not
   * exist, and a test that means to cover it silently proves nothing.
   */
  let responseDelayMs = 0;
  /**
   * When true the stub answers with the provider's FAILURE body, so the check leaves the row
   * unresolved (`country_code` stays null). That is the only state in which a proxy can be checked
   * twice — a resolved row is skipped — so a test about duplicate requests needs it.
   */
  let respondWithFailure = false;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    stopGeoFill();
    requests = [];
    inFlight = 0;
    maxInFlight = 0;
    responseDelayMs = 0;
    respondWithFailure = false;
    const db = getDb();
    db.exec('DELETE FROM profiles;');
    db.exec('DELETE FROM proxies;');

    // Stands in for BOTH the proxy and the geo provider: the request arrives with an absolute URI
    // (that is what an HTTP proxy receives), and the body is the provider's answer. No network.
    server = http.createServer((_req, res) => {
      requests.push(String(_req.url));
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const respond = (): void => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // `status: 'fail'` is what an unreachable/reserved address returns; it is a fact about the
        // proxy, so `checkProxy` returns ok:false without retrying.
        res.end(respondWithFailure ? JSON.stringify({ status: 'fail', message: 'reserved range' }) : GEO_BODY);
        inFlight--;
      };
      if (responseDelayMs > 0) setTimeout(respond, responseDelayMs);
      else respond();
    });
    // `Promise.withResolvers()` returns the promise ALONGSIDE its resolvers. Awaiting the returned
    // object is a no-op — it is not a thenable — so this fixture once continued before `listen` had
    // fired, read the port as 0 and connected to an unbound port, which surfaced as an
    // intermittent EADDRNOTAVAIL. The port is read inside the callback and the PROMISE is awaited.
    const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as net.AddressInfo).port;
      onListening();
    });
    await listening;
    PROXY_TARGET.port = port;
  });

  afterEach(async () => {
    stopGeoFill();
    // `close()` alone waits for every open connection to end, so a socket left behind by a check
    // that was still in flight hangs the suite rather than failing it. Connections are dropped
    // first, and the close is raced against a short bound so a leak reports as a failure instead
    // of stalling the run.
    server.closeAllConnections();
    await Promise.race([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  });

  /** Resolve when the named proxy's check has STORED its result. */
  function waitForGeo(proxyId: string): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const unsubscribe = onProxyGeoResolved((id) => {
      if (id !== proxyId) return;
      unsubscribe();
      resolve();
    });
    return promise;
  }

  it('checks a proxy created through the plain create path, and stores its ISO code', async () => {
    const id = createProxy({ type: 'http', host: '127.0.0.1', port });
    const pending = waitForGeo(id);

    // The row is 'unknown' the instant it exists — that is what the operator sees for the moment
    // before the queue reaches it.
    expect(getProxy(id)?.status).toBe('unknown');

    await pending;
    const row = getProxy(id);
    expect(row?.status).toBe('ok');
    expect(row?.country).toBe('Germany');
    // The code, not the name: the flag and the two-letter label derive from this value, and a name
    // has no derivable flag.
    expect(row?.country_code).toBe('DE');
    expect(row?.city).toBe('Falkenstein');
  });

  it('checks a proxy that arrives as part of a profile, which no page ever checked', async () => {
    // The reported case. This path is what the SDKs, agents, batch create and the importers use,
    // and it never touched the Proxies page's own check.
    const profileId = createProfile({
      name: 'geo-queue-profile',
      proxy: { type: 'http', host: '127.0.0.1', port },
    });

    const bound = getDb()
      .prepare('SELECT proxy_id FROM profiles WHERE id = ?')
      .get(profileId) as { proxy_id: string };
    expect(bound.proxy_id).toBeTruthy();

    const pending = waitForGeo(bound.proxy_id);
    await pending;

    const row = getProxy(bound.proxy_id);
    expect(row?.status).toBe('ok');
    expect(row?.country_code).toBe('DE');
  });

  it('walks a batch one request at a time, never opening them all at once', async () => {
    // Three is enough to show the shape; the pacing is per request, not per batch.
    //
    // This is the one case here that genuinely runs on the real clock, and it has to: the pacing
    // exists to stay under a provider's per-minute quota, so the interval IS the behaviour under
    // test. Fake timers would let the queue pass while proving nothing about the spacing a real
    // provider sees.
    const ids = [
      createProxy({ type: 'http', host: '127.0.0.1', port }),
      createProxy({ type: 'http', host: '127.0.0.1', port }),
      createProxy({ type: 'http', host: '127.0.0.1', port }),
    ];
    const pending = Promise.all(ids.map((id) => waitForGeo(id)));
    await pending;

    expect(requests.length).toBe(3);
    // The whole point: sequential. A parallel implementation would report 3 here.
    expect(maxInFlight).toBe(1);
    for (const id of ids) expect(getProxy(id)?.country_code).toBe('DE');
  }, 20000);

  it('asks once per proxy, so a re-queued id cannot spend a second lookup', async () => {
    const id = createProxy({ type: 'http', host: '127.0.0.1', port });
    const pending = waitForGeo(id);
    // The same id, again, while the first check is still queued. Idempotent by design: an update
    // that re-sends the same proxy must not cost a request.
    queueGeoChecks([id]);
    await pending;

    expect(requests.length).toBe(1);
  });

  it('backfills a row that has a name but no code, so an existing database gains its flags', async () => {
    // Exactly the shape of every row written before the column existed: a resolved name, no code.
    // Treated as unresolved, because without the code the column still cannot show a flag.
    const db = getDb();
    const id = 'x_legacy_geo';
    db.prepare(
      `INSERT INTO proxies (id, type, host, port, country, city, timezone, status, created_at)
       VALUES (?, 'http', '127.0.0.1', ?, 'Germany', 'Falkenstein', 'Europe/Berlin', 'ok', ?)`
    ).run(id, port, Date.now());

    const pending = waitForGeo(id);
    startGeoFill();
    await pending;

    expect(getProxy(id)?.country_code).toBe('DE');
  });

  it('does not re-check a row that already carries its code', async () => {
    const db = getDb();
    const id = 'x_resolved_geo';
    db.prepare(
      `INSERT INTO proxies (id, type, host, port, country, country_code, city, timezone, status, created_at)
       VALUES (?, 'http', '127.0.0.1', ?, 'Germany', 'DE', 'Falkenstein', 'Europe/Berlin', 'ok', ?)`
    ).run(id, port, Date.now());

    startGeoFill();
    // Deterministic, not a sleep: `queueGeoChecks` flips `running` to true synchronously when it
    // accepts even one id, so a worker that was never started is proof that this row was not a
    // candidate. Waiting a guessed duration would only prove the request was slow.
    expect(getGeoFillStatus().running).toBe(false);
    expect(requests.length).toBe(0);
  });

  it('keeps an in-flight id reserved, so a re-queue during the request cannot double-check it', async () => {
    // The window this guards: the id has been taken off the queue but its request has not answered
    // yet. Releasing the reservation at that moment let `queueGeoChecks` queue the SAME proxy
    // again, and a proxy that then failed was checked twice against a rate-limited quota and
    // counted twice.
    //
    // The stub is made SLOW and made to FAIL here on purpose. With an instant answer the window
    // does not exist; with a SUCCESSFUL answer the row is already resolved and the duplicate is
    // skipped as unnecessary. Only a slow, failing proxy exposes the bug: the id is off the queue,
    // the row is still unresolved, and a re-queue therefore costs a second real request. Verified
    // by reintroducing the bug — the fast-success version of this test did not catch it.
    responseDelayMs = 400;
    respondWithFailure = true;
    const id = createProxy({ type: 'http', host: '127.0.0.1', port });
    const pending = waitForGeo(id);
    await new Promise((r) => setTimeout(r, 100)); // let the request actually start
    queueGeoChecks([id]); // re-queued while that request is in flight
    await pending;

    // Give the worker the chance to act on the re-queue, rather than stopping it: `stopGeoFill`
    // clears the pending queue, which would cancel the very duplicate this test is about and make
    // it pass regardless. The bounded wait is long enough to cover the pacing interval that
    // separates two requests, so a duplicate has every opportunity to appear.
    const deadline = Date.now() + 4000;
    while (requests.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(requests.length).toBe(1);
    expect(getProxy(id)?.status).toBe('fail');
  });

  it('reports running again when work is accepted while a worker is still alive', async () => {
    // After a stop, `running` is cleared but an in-flight check keeps the worker alive. New work
    // accepted in that state used to be drained while every status query said "not running", so the
    // progress display showed nothing at all.
    createProxy({ type: 'http', host: '127.0.0.1', port });
    stopGeoFill();
    const second = createProxy({ type: 'http', host: '127.0.0.1', port });
    queueGeoChecks([second]);

    expect(getGeoFillStatus().running).toBe(true);
    await waitForGeo(second);
  });

  it('leaves total as the size of the attempted pass when a stop cancels the rest', async () => {
    // A stopped pass of 100 used to report "3/3" — it read as a finished job rather than a
    // cancelled one, which is the opposite of what happened to the other 97 proxies.
    const ids = [
      createProxy({ type: 'http', host: '127.0.0.1', port }),
      createProxy({ type: 'http', host: '127.0.0.1', port }),
      createProxy({ type: 'http', host: '127.0.0.1', port }),
      createProxy({ type: 'http', host: '127.0.0.1', port }),
    ];
    startGeoFill();
    const attempted = getGeoFillStatus().total;
    expect(attempted).toBeGreaterThan(1);

    stopGeoFill();
    // Whatever was attempted stays visible; the count is not rewritten to whatever completed.
    expect(getGeoFillStatus().total).toBe(attempted);
    await stopAndSettle();
    void ids;
  }, 20000);
});
