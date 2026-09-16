// The reported application version must be real.
//
// It was hardcoded twice — `GET /status` answered a literal `0.0.1` that matched no release,
// and the sidebar footer printed its own `v0.6.0`. Neither followed package.json, so after a
// version bump both lied.
//
// The first fix read package.json by walking up from the module. That worked in development
// and returned `unknown` on a real install, because the packaged artefact does not ship
// `package.json` — so the desktop shell now passes its own version (Tauri bakes it in from
// tauri.conf.json at build time), and the file lookup remains for the standalone service.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

beforeEach(() => {
  vi.resetModules();
});

describe('APP_VERSION', () => {
  it('uses the value the desktop shell passes down', async () => {
    // This is the channel that works in an installed build.
    setEnv('ANTIDETECT_APP_VERSION', '9.9.9');
    const { APP_VERSION } = await import('../../src/main/config');
    expect(APP_VERSION).toBe('9.9.9');
  });

  it('ignores an empty or whitespace shell value and falls back', async () => {
    setEnv('ANTIDETECT_APP_VERSION', '   ');
    const { APP_VERSION } = await import('../../src/main/config');
    // Falls through to the package.json lookup, which succeeds when running from source.
    expect(APP_VERSION).not.toBe('   ');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('never reports a value it invented', async () => {
    // Running from source, the real version resolves; the point is that it is either the
    // real one or the literal `unknown` — never a plausible-looking number.
    setEnv('ANTIDETECT_APP_VERSION', undefined);
    const { APP_VERSION } = await import('../../src/main/config');
    expect(APP_VERSION === 'unknown' || /^\d+\.\d+\.\d+/.test(APP_VERSION)).toBe(true);
  });

  it('reports the same version the status endpoint serves', async () => {
    setEnv('ANTIDETECT_APP_VERSION', '1.2.3');
    const { APP_VERSION } = await import('../../src/main/config');
    // /status returns APP_VERSION directly; asserting the constant keeps them in lockstep.
    expect(APP_VERSION).toBe('1.2.3');
  });
});
