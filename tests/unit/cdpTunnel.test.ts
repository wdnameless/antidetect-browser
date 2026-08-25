// Integration tests for the CDP tunnel (HTTP streaming + WS upgrade piping).
// The upstream is a stub DevTools server; no Chromium is involved.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import express, { Express } from 'express';
import { createCdpRouter, tryHandleCdpUpgrade, checkTunnelAuth } from '../../src/main/api/cdpTunnel';
import { createViewerUpgradeHandler } from '../../src/main/api/viewer';
import { authMiddleware } from '../../src/main/api/auth';
import { getApiKey } from '../../src/main/config';

// Real generated key (sandbox data dir from tests/setup.ts).
const API_KEY = getApiKey();

let stubServer: http.Server;
let stubPort = 0;
let lastStubPath = '';
let lastStubHost = '';

const app: Express = express();
app.use(authMiddleware);
app.use(createCdpRouter((id) => (id === 'p1' ? { port: String(stubPort), wsPath: '/devtools/browser/stub' } : undefined)));

let testServer: http.Server;
let appPort = 0;

beforeAll(async () => {
  // Stub "DevTools" upstream: JSON endpoint + raw WS echo upgrade.
  stubServer = http.createServer((req, res) => {
    lastStubPath = req.url || '';
    lastStubHost = String(req.headers.host || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Browser: 'stub', path: req.url }));
  });
  stubServer.on('upgrade', (req, socket) => {
    const key = String(req.headers['sec-websocket-key'] || '');
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.pipe(socket); // echo everything after the handshake
  });
  await new Promise<void>((r) => stubServer.listen(0, '127.0.0.1', r));
  stubPort = (stubServer.address() as net.AddressInfo).port;

  await new Promise<void>((r) => {
    testServer = http.createServer(app);
    const viewerHandler = createViewerUpgradeHandler(() => API_KEY);
    testServer.on('upgrade', (req, socket, head) => {
      if (tryHandleCdpUpgrade(req, socket, head, (id) => (id === 'p1' ? { port: String(stubPort), wsPath: '/devtools/browser/stub' } : undefined), () => API_KEY)) return;
      viewerHandler(req, socket, head);
    });
    testServer.listen(0, '127.0.0.1', () => {
      appPort = (testServer.address() as net.AddressInfo).port;
      r();
    });
  });
});

afterAll(async () => {
  (testServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  (stubServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((r) => testServer.close(() => r()));
  await new Promise<void>((r) => stubServer.close(() => r()));
});

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: appPort, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('CDP tunnel HTTP proxying', () => {
  it('requires Bearer auth', async () => {
    const r = await get('/cdp/p1/json/version');
    expect(r.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const r = await get('/cdp/nope/json/version', { authorization: `Bearer ${API_KEY}` });
    expect(r.status).toBe(404);
  });

  it('streams the devtools endpoint with prefix stripped and host rewritten', async () => {
    const r = await get('/cdp/p1/json/version?k=1', { authorization: `Bearer ${API_KEY}` });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).path).toBe('/json/version?k=1');
    expect(lastStubPath).toBe('/json/version?k=1');
    expect(lastStubHost).toBe(`127.0.0.1:${stubPort}`);
  });
});

describe('CDP tunnel WebSocket piping', () => {
  function wsRoundTrip(path: string): Promise<{ handshake: string; echoed: Buffer }> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(appPort, '127.0.0.1');
      let buf = Buffer.alloc(0);
      let handshakeDone = false;
      const frame = Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]); // text "hello"
      const finish = (handshake: string): void => {
        sock.removeListener('data', onData);
        resolve({ handshake, echoed: buf });
        sock.end();
      };
      const onData = (chunk: Buffer): void => {
        buf = Buffer.concat([buf, chunk]);
        if (!handshakeDone) {
          const idx = buf.indexOf('\r\n\r\n');
          if (idx !== -1) {
            const head = buf.slice(0, idx).toString();
            if (/^HTTP\/1\.1 101/.test(head)) {
              handshakeDone = true;
              sock.write(frame); // exercise the pipe both ways
            } else {
              finish(head); // 401/404 — no payload will follow
            }
          }
        } else if (buf.includes(frame)) {
          finish(buf.slice(0, buf.indexOf('\r\n\r\n')).toString());
        }
      };
      sock.on('error', reject);
      sock.on('data', onData);
      setTimeout(() => {
        if (!handshakeDone || !buf.includes(frame)) {
          sock.destroy();
          reject(new Error(`ws round trip incomplete: ${buf.toString('latin1').slice(0, 120)}`));
        }
      }, 3000).unref?.();
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
          'Host: 127.0.0.1\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
  }

  it('pipes an authenticated upgrade to the loopback endpoint', async () => {
    const { handshake, echoed } = await wsRoundTrip(`/cdp/p1/devtools/browser/stub?key=${API_KEY}`);
    expect(handshake.startsWith('HTTP/1.1 101')).toBe(true);
    // The stub echoes frames back through the tunnel.
    expect(echoed.includes(Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]))).toBe(true);
  });

  it('rejects upgrades with a bad key', async () => {
    const { handshake } = await wsRoundTrip('/cdp/p1/devtools/browser/stub?key=wrong');
    expect(handshake.startsWith('HTTP/1.1 401')).toBe(true);
  });
});

describe('checkTunnelAuth', () => {
  it('accepts query key and bearer header, rejects garbage', () => {
    const mkReq = (url: string, auth?: string): http.IncomingMessage =>
      ({ url, headers: auth ? { authorization: auth } : {} }) as unknown as http.IncomingMessage;
    expect(checkTunnelAuth(mkReq(`/x?key=${API_KEY}`), API_KEY)).toBe(true);
    expect(checkTunnelAuth(mkReq('/x', `Bearer ${API_KEY}`), API_KEY)).toBe(true);
    expect(checkTunnelAuth(mkReq('/x?key=nope'), API_KEY)).toBe(false);
    expect(checkTunnelAuth(mkReq('/x'), API_KEY)).toBe(false);
  });
});

describe('viewer upgrade handler', () => {
  function viewerHandshake(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(appPort, '127.0.0.1');
      let buf = Buffer.alloc(0);
      sock.on('error', reject);
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const idx = buf.indexOf('\r\n\r\n');
        if (idx !== -1) {
          const head = buf.slice(0, idx).toString();
          sock.destroy();
          resolve(head);
        }
      });
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
          'Host: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
      );
    });
  }

  it('rejects bad key with 401', async () => {
    const head = await viewerHandshake('/cdp-view/p1?key=wrong');
    expect(head.startsWith('HTTP/1.1 401')).toBe(true);
  });

  it('accepts valid key even when the profile is not running (error frame follows)', async () => {
    // The WS handshake must succeed; runViewer then sends an error frame.
    const head = await viewerHandshake(`/cdp-view/ghost?key=${API_KEY}`);
    expect(head.startsWith('HTTP/1.1 101')).toBe(true);
  });
});
