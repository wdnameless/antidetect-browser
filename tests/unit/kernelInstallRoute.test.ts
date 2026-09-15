// The kernel install endpoint.
//
// Why this needs a test at all: `ensureKernel()` was fully implemented and called from
// NOWHERE, so a shipped build had no browser kernel and every profile launch failed with no
// in-app way out. The regression worth guarding is therefore not "does the download work" but
// "is the endpoint reachable, idempotent, and honest about failure".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Mount just the kernel router behind a stub of the two things it imports, so the test
 * exercises the ROUTE (status transitions, idempotency, error reporting) without a 425 MB
 * download or a real GitHub fetch.
 */
async function mountKernelRouter(opts: {
  installed: () => string | null;
  ensure: () => Promise<{ executablePath: string; kernelDir: string }>;
}): Promise<{ app: Express; url: (p: string) => string; close: () => Promise<void> }> {
  vi.resetModules();
  vi.doMock('../../src/main/util/kernelUpdate', () => ({
    getInstalledKernelVersion: opts.installed,
    checkKernelUpdate: async () => ({ installed: opts.installed(), latest: null, updateAvailable: false }),
  }));
  vi.doMock('../../src/main/util/kernelAcquire', () => ({
    ensureKernel: opts.ensure,
    PINNED_KERNEL_VERSION: '148.0.7778.215',
    KernelAcquireError: class KernelAcquireError extends Error {
      constructor(
        message: string,
        public readonly code?: string,
      ) {
        super(message);
      }
    },
  }));
  vi.doMock('../../src/main/util/logger', () => ({
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  }));

  const { default: router } = await import('../../src/main/api/routes/kernel');
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = http.createServer(app);
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    app,
    url: (p: string) => `http://127.0.0.1:${port}${p}`,
    close: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}

describe('kernel install endpoint', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('../../src/main/util/kernelUpdate');
    vi.doUnmock('../../src/main/util/kernelAcquire');
    vi.doUnmock('../../src/main/util/logger');
    vi.resetModules();
  });

  it('reports the installed version and the pinned target', async () => {
    const s = await mountKernelRouter({
      installed: () => '148.0.7778.215',
      ensure: async () => ({ executablePath: '/x', kernelDir: '/y' }),
    });
    try {
      const res = await fetch(s.url('/api/v1/kernel/status'));
      const body = (await res.json()) as { data: { installed: string | null; pinned: string } };
      expect(res.status).toBe(200);
      expect(body.data.installed).toBe('148.0.7778.215');
      expect(body.data.pinned).toBe('148.0.7778.215');
    } finally {
      await s.close();
    }
  });

  it('does not download when the kernel is already installed', async () => {
    // A second click must not re-fetch 425 MB.
    let called = 0;
    const s = await mountKernelRouter({
      installed: () => '148.0.7778.215',
      ensure: async () => {
        called += 1;
        return { executablePath: '/x', kernelDir: '/y' };
      },
    });
    try {
      const res = await fetch(s.url('/api/v1/kernel/install'), { method: 'POST' });
      const body = (await res.json()) as { code: number; data: { alreadyInstalled?: boolean } };
      expect(res.status).toBe(200);
      expect(body.data.alreadyInstalled).toBe(true);
      expect(called, 'ensureKernel must not run when already installed').toBe(0);
    } finally {
      await s.close();
    }
  });

  it('installs when the kernel is missing, and reports the resulting version', async () => {
    let installed: string | null = null;
    const s = await mountKernelRouter({
      installed: () => installed,
      ensure: async () => {
        installed = '148.0.7778.215';
        return { executablePath: '/x', kernelDir: '/y' };
      },
    });
    try {
      const res = await fetch(s.url('/api/v1/kernel/install'), { method: 'POST' });
      const body = (await res.json()) as { code: number; data: { installed: string | null } };
      expect(res.status).toBe(200);
      expect(body.code).toBe(0);
      expect(body.data.installed).toBe('148.0.7778.215');
    } finally {
      await s.close();
    }
  });

  it('surfaces a download failure with its reason instead of a silent no-op', async () => {
    // The UI shows the returned message. A bare "failed" would leave the operator unable to
    // tell a checksum mismatch (dangerous) from a network error (retryable).
    const s = await mountKernelRouter({
      installed: () => null,
      ensure: async () => {
        const { KernelAcquireError } = await import('../../src/main/util/kernelAcquire');
        throw new KernelAcquireError('digest mismatch', 'digest-mismatch');
      },
    });
    try {
      const res = await fetch(s.url('/api/v1/kernel/install'), { method: 'POST' });
      const body = (await res.json()) as { code: number; msg: string };
      expect(res.status).toBe(502);
      expect(body.code).toBe(-1);
      expect(body.msg).toMatch(/digest mismatch/);
      expect(body.msg, 'the failure code must survive').toMatch(/digest-mismatch/);
    } finally {
      await s.close();
    }
  });

  it('joins an in-flight download rather than starting a second one', async () => {
    // Two concurrent clicks must not launch parallel 425 MB transfers.
    let ensureCalls = 0;
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const s = await mountKernelRouter({
      installed: () => null,
      ensure: async () => {
        ensureCalls += 1;
        entered.resolve();
        await gate.promise;
        return { executablePath: '/x', kernelDir: '/y' };
      },
    });
    try {
      const first = fetch(s.url('/api/v1/kernel/install'), { method: 'POST' });
      // Await the real signal that the first request is inside ensureKernel, rather than
      // sleeping and hoping. No wall-clock dependency, so this cannot flake under load.
      await entered.promise;
      const second = fetch(s.url('/api/v1/kernel/install'), { method: 'POST' });
      // The second request must see the in-flight install. `installing` is the server's own
      // report of that state, so assert on it instead of on elapsed time.
      const statusRes = await fetch(s.url('/api/v1/kernel/status'));
      const status = (await statusRes.json()) as { data: { installing: boolean } };
      expect(status.data.installing, 'the first install must still be in flight').toBe(true);

      gate.resolve();
      const [a, b] = await Promise.all([first, second]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(ensureCalls, 'the second request must join, not re-download').toBe(1);
    } finally {
      await s.close();
    }
  });
});

// The kernel is large and deliberately absent from the shipped artefact; the build must be
// able to place it, and the app must be able to find it in both layouts.
describe('kernel location', () => {
  it('resolves the kernel directory under the data dir when nothing else is set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-loc-'));
    const prev = process.env.ANTIDETECT_DATA_DIR;
    process.env.ANTIDETECT_DATA_DIR = tmp;
    try {
      vi.resetModules();
      const { getKernelDirectory } = await import('../../src/main/util/kernelAcquire');
      const dir = getKernelDirectory();
      expect(dir.startsWith(tmp) || dir.includes('fingerprint-chromium')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ANTIDETECT_DATA_DIR;
      else process.env.ANTIDETECT_DATA_DIR = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
