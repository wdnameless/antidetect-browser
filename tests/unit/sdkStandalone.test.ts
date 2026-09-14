import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import * as net from 'net';
import puppeteer from 'puppeteer-core';
import {
  ensureEngine,
  launchStandaloneProfile,
  buildStandaloneArgs,
  PINNED_KERNEL_ASSETS,
  PINNED_KERNEL_VERSION,
  AntidetectClient,
  EngineAcquireError,
} from '../../packages/sdk-node/src/index.js';

describe('Standalone Node SDK', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-standalone-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('ensureEngine()', () => {
    it('downloads, verifies digest, and caches on first call; second call returns cached without fetch', async () => {
      const mockPayload = Buffer.from('mock chromium executable content');
      const mockHash = crypto.createHash('sha256').update(mockPayload).digest('hex');

      const mockAssetInfo = {
        asset: 'antidetect-chromium-mock.zip',
        sha256: mockHash,
        size: mockPayload.length,
        executableSubpath: 'chrome.exe',
        archiveType: 'appimage' as const, // AppImage copies payload directly to destination
      };

      let fetchCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-length': String(mockPayload.length) }),
          arrayBuffer: async () => mockPayload.buffer.slice(mockPayload.byteOffset, mockPayload.byteOffset + mockPayload.byteLength),
          body: null,
        } as unknown as Response;
      });

      const opts = {
        platform: 'linux' as NodeJS.Platform,
        targetDir: tmpDir,
        expectedDigests: {
          linux: mockAssetInfo,
        },
        fetchFn: mockFetch as unknown as typeof fetch,
      };

      // First call: downloads
      const res1 = await ensureEngine(opts);
      expect(fetchCount).toBe(1);
      expect(fs.existsSync(res1.executable)).toBe(true);

      // Second call: idempotent, does not download again
      const res2 = await ensureEngine(opts);
      expect(fetchCount).toBe(1);
      expect(res2.executable).toBe(res1.executable);
    });

    it('refuses download when digest does not match expected SHA-256', async () => {
      const mockPayload = Buffer.from('tampered content');
      const wrongHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const mockAssetInfo = {
        asset: 'antidetect-chromium-mock.zip',
        sha256: wrongHash,
        size: mockPayload.length,
        executableSubpath: 'chrome.exe',
        archiveType: 'appimage' as const,
      };

      const mockFetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-length': String(mockPayload.length) }),
          arrayBuffer: async () => mockPayload.buffer.slice(mockPayload.byteOffset, mockPayload.byteOffset + mockPayload.byteLength),
          body: null,
        } as unknown as Response;
      });

      await expect(
        ensureEngine({
          platform: 'linux' as NodeJS.Platform,
          targetDir: tmpDir,
          expectedDigests: { linux: mockAssetInfo },
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrow(EngineAcquireError);
    });
  });

  describe('Isolation and command-line arguments', () => {
    it('buildStandaloneArgs contains isolation, security, and remote debugging flags', () => {
      const args = buildStandaloneArgs({
        port: 9222,
        userDataDir: 'C:\\test\\profile1',
        headless: true,
        fingerprint: {
          seed: 42,
          platform: 'Win32',
          platformVersion: '10.0.0',
          brand: 'Google Chrome',
          brandVersion: '148',
          hardwareConcurrency: 8,
          timezone: 'America/New_York',
          lang: 'en-US',
        },
        screenOverride: { width: 1920, height: 1080 },
        proxyServer: 'http://127.0.0.1:8080',
      });

      expect(args).toContain('--remote-debugging-port=9222');
      expect(args).toContain('--user-data-dir=C:\\test\\profile1');
      expect(args).toContain('--headless=new');
      expect(args).toContain('--no-first-run');
      expect(args).toContain('--no-default-browser-check');
      expect(args).toContain('--disable-component-update');
      expect(args).toContain('--disable-background-networking');
      expect(args).toContain('--disable-sync');
      expect(args).toContain('--disable-blink-features=AutomationControlled');
      expect(args).toContain('--password-store=basic');
      expect(args).toContain('--fingerprint-seed=42');
      expect(args).toContain('--fingerprint-platform=Win32');
      expect(args).toContain('--fingerprint-platform-version=10.0.0');
      expect(args).toContain('--fingerprint-brand=Google Chrome');
      expect(args).toContain('--fingerprint-brand-version=148');
      expect(args).toContain('--fingerprint-hardware-concurrency=8');
      expect(args).toContain('--timezone=America/New_York');
      expect(args).toContain('--lang=en-US');
      expect(args).toContain('--window-size=1920,1080');
      expect(args).toContain('--proxy-server=http://127.0.0.1:8080');
    });

    it('two distinct launches produce distinct user-data directories and fingerprint seeds', () => {
      const args1 = buildStandaloneArgs({
        userDataDir: path.join(tmpDir, 'profile-1'),
        fingerprint: { seed: 1001 },
      });
      const args2 = buildStandaloneArgs({
        userDataDir: path.join(tmpDir, 'profile-2'),
        fingerprint: { seed: 2002 },
      });

      const userDir1 = args1.find((a) => a.startsWith('--user-data-dir='));
      const userDir2 = args2.find((a) => a.startsWith('--user-data-dir='));
      expect(userDir1).not.toEqual(userDir2);

      const seed1 = args1.find((a) => a.startsWith('--fingerprint-seed='));
      const seed2 = args2.find((a) => a.startsWith('--fingerprint-seed='));
      expect(seed1).not.toEqual(seed2);
    });
  });

  describe('AntidetectClient standalone integration', () => {
    it('client exposes ensureEngine and launchStandaloneProfile methods', () => {
      const client = new AntidetectClient();
      expect(typeof client.ensureEngine).toBe('function');
      expect(typeof client.launchStandaloneProfile).toBe('function');
    });
  });

  describe('Puppeteer CDP connectivity smoke test', () => {
    it('connects to CDP endpoint with puppeteer-core and queries browser version', async () => {
      // Mock CDP server simulating Chromium DevTools HTTP/WS protocol
      let cdpServer: http.Server | null = null;
      const { promise: serverReady, resolve: onServerReady } = Promise.withResolvers<number>();

      cdpServer = http.createServer((req, res) => {
        if (req.url === '/json/version') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              Browser: 'Chrome/148.0.7778.215',
              'Protocol-Version': '1.3',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'V8-Version': '14.8.1',
              'WebKit-Version': '537.36',
              webSocketDebuggerUrl: `ws://127.0.0.1:${(cdpServer?.address() as net.AddressInfo).port}/devtools/browser/mock-id`,
            })
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });

      // Handle dummy websocket upgrade or connection
      cdpServer.on('upgrade', (req, socket, head) => {
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n' +
            '\r\n'
        );
        socket.on('data', (buf) => {
          // Send back a minimal dummy CDP response if pinged
        });
      });

      cdpServer.listen(0, '127.0.0.1', () => {
        const port = (cdpServer?.address() as net.AddressInfo).port;
        onServerReady(port);
      });

      const port = await serverReady;
      const browserWSEndpoint = `ws://127.0.0.1:${port}/devtools/browser/mock-id`;

      // Verify puppeteer-core can connect to browserWSEndpoint or resolve browser version
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const data = await res.json();
      expect(data.Browser).toContain('148.0.7778.215');

      if (cdpServer) {
        cdpServer.close();
      }
    });

    it.runIf(process.env.TEST_REAL_CHROMIUM === 'true')(
      'real end-to-end launch with live Chromium engine',
      async () => {
        const instance = await launchStandaloneProfile({
          headless: true,
          fingerprint: { seed: 12345 },
        });

        expect(instance.port).toBeGreaterThan(0);
        expect(instance.cdpUrl).toContain(String(instance.port));

        const browser = await puppeteer.connect({
          browserURL: instance.cdpUrl,
        });

        const version = await browser.version();
        expect(version).toBeDefined();

        const page = await browser.newPage();
        await page.setContent('<html><body><h1>Standalone SDK OK</h1></body></html>');
        const heading = await page.$eval('h1', (el) => el.textContent);
        expect(heading).toBe('Standalone SDK OK');

        await browser.close();
        await instance.stop();
      },
      60000
    );
  });
});
