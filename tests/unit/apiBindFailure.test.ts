// Bind failures must be reported, not swallowed.
//
// The shipped defect: `server.listen()` had no `error` handler, so an occupied port emitted
// an unhandled error event. The process died without printing the listening line the shell
// waits for, and the app showed a UI with no backend behind it — "failed to fetch" and dead
// menus, with the real reason nowhere the operator could see. The shell's first-run screen
// and the MCP panel both depend on this rejection being legible.
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

/** Occupies a port, runs `fn`, then frees it. */
async function withPortTaken(port: number, fn: () => Promise<void>): Promise<void> {
  const blocker = net.createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', () => resolve());
  });
  try {
    await fn();
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
}

describe('API server bind failure', () => {
  it('rejects with an actionable message when the port is already in use', async () => {
    // A fixed high port keeps this independent of anything else on the machine.
    const port = 50391;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-'));
    setEnv('ANTIDETECT_DATA_DIR', dataDir);
    setEnv('ANTIDETECT_SETTINGS_DIR', dataDir);
    setEnv('API_PORT', String(port));
    setEnv('API_HOST', '127.0.0.1');

    await withPortTaken(port, async () => {
      vi.resetModules();
      const { startApi } = await import('../../src/main/api/server');
      // The promise must settle (reject) rather than hang or crash the process.
      await expect(startApi()).rejects.toThrow(/already in use/i);
    });

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('names the port in the error so the operator can act on it', async () => {
    const port = 50392;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bind2-'));
    setEnv('ANTIDETECT_DATA_DIR', dataDir);
    setEnv('ANTIDETECT_SETTINGS_DIR', dataDir);
    setEnv('API_PORT', String(port));
    setEnv('API_HOST', '127.0.0.1');

    await withPortTaken(port, async () => {
      vi.resetModules();
      const { startApi } = await import('../../src/main/api/server');
      await expect(startApi()).rejects.toThrow(String(port));
    });

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
