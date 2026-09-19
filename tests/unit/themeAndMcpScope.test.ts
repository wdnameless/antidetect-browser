// Tests for the follow-up work the owner asked for after running the build: the light theme,
// the MCP privilege level, and the two settings that drive them.
//
// These assert BEHAVIOUR. A test that merely greps for a token name would pass after someone
// renamed the token and broke the theme, which is the failure mode worth catching.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RENDERER = path.resolve(__dirname, '../../src/renderer/src');
const STYLES = path.join(RENDERER, 'styles.css');

/** The `:root`-scoped blocks, so a token is judged from the block it actually lives in. */
function themeBlocks(): { dark: string; light: string } {
  const css = fs.readFileSync(STYLES, 'utf8');
  // Find the plain `:root { ... }` block and the `:root[data-theme='light'] { ... }` block.
  const readBlock = (start: number): string => {
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) return css.slice(open + 1, i);
      }
    }
    throw new Error('unterminated block');
  };
  const darkStart = css.indexOf(':root');
  const lightStart = css.indexOf(":root[data-theme='light']");
  expect(lightStart, "a light theme block must exist").toBeGreaterThan(-1);
  return { dark: readBlock(darkStart), light: readBlock(lightStart) };
}

function tokenValue(block: string, token: string): string | null {
  const m = block.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** Perceptual chroma of a hex colour, using the same tolerance the noir token test uses. */
function chromaSpread(value: string): number | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b);
}

describe('light theme', () => {
  const { dark, light } = themeBlocks();

  it('defines every colour token the dark theme defines', () => {
    // A token defined only in dark would silently keep its dark value in light mode — the
    // exact way a light theme ends up with an unreadable, half-dark UI.
    const colourTokens = (block: string): string[] =>
      [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
        .filter(([, , value]) => /#|rgb|hsl|gradient/i.test(value))
        .map(([, name]) => name)
        // Metrics that legitimately differ are still colours, so nothing is excluded here:
        // if it carries a colour in dark, light must answer for it too.
        .filter((n) => !n.startsWith('--palette-width') && !n.startsWith('--flow-'));

    const darkTokens = colourTokens(dark);
    const lightTokens = new Set(colourTokens(light));
    const missing = darkTokens.filter((t) => !lightTokens.has(t));
    expect(missing, 'every colour token needs a light value').toEqual([]);
  });

  it('inverts background and text rather than repeating the dark values', () => {
    const darkBg = tokenValue(dark, '--bg-app');
    const lightBg = tokenValue(light, '--bg-app');
    const darkText = tokenValue(dark, '--text');
    const lightText = tokenValue(light, '--text');
    expect(lightBg).not.toBe(darkBg);
    expect(lightText).not.toBe(darkText);
    // Luminance must actually flip: a "light" background that is still dark is not a theme.
    const lum = (hex: string | null): number => {
      const h = (hex ?? '#000').replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return (r + g + b) / 3;
    };
    expect(lum(lightBg)).toBeGreaterThan(200);
    expect(lum(darkBg)).toBeLessThan(60);
    expect(lum(lightText)).toBeLessThan(60);
    expect(lum(darkText)).toBeGreaterThan(200);
  });

  it('stays monochrome — no token carries a hue in either theme, except status tokens', () => {
    // The project's palette is monochrome; a blue-tinted light theme would not be this product,
    // and `noirTokens.test.ts` would reject it too.
    //
    // Status tokens are the deliberate exception (operator decision, R06): a running profile
    // and a failure must be distinguishable by hue, not only by brightness. The exception is
    // named rather than pattern-matched, so it cannot widen by accident, and every other
    // token — accent, surfaces, text, borders — is still required to be greyscale here AND in
    // `noirTokens.test.ts`, which checks the dark theme by name.
    const statusHueTokens = new Set(['--ok', '--ok-bg', '--warn', '--warn-bg', '--danger', '--danger-bg']);
    const offenders: string[] = [];
    for (const block of [dark, light]) {
      for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g)) {
        if (statusHueTokens.has(m[1])) continue;
        const spread = chromaSpread(m[2]);
        if (spread !== null && spread > 12) offenders.push(`${m[1]}: ${m[2]}`);
      }
    }
    expect(offenders, 'tokens must be greyscale').toEqual([]);
  });

  it('gives status colours enough contrast on their own background', () => {
    // The status tokens are the only tokens allowed hue, and the light theme initially got
    // values that looked right but measured 3.05:1 on `--bg-app` — below WCAG AA for text.
    // The dark green that reads well on near-black is not the green that reads on near-white,
    // so the pair has to be measured, not eyeballed. 4.5:1 is the AA threshold for body text.
    const relLum = (hex: string): number => {
      const h = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (a: string, b: string): number => {
      const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    for (const [label, block] of [['dark', dark], ['light', light]] as const) {
      const bg = tokenValue(block, '--bg-app');
      expect(bg, `${label} must define --bg-app`).toBeTruthy();
      for (const token of ['--ok', '--warn', '--danger']) {
        const value = tokenValue(block, token);
        expect(value, `${label} must define ${token}`).toBeTruthy();
        const ratio = contrast(value as string, bg as string);
        expect(ratio, `${label} ${token} (${value}) on ${bg} has ${ratio.toFixed(2)}:1, needs 4.5:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives the accent a foreground that inverts with it', () => {
    // The badge on an accent fill was hardcoded '#fff', which merged with the near-white
    // accent in dark mode and with the near-black accent in light mode.
    const darkFg = tokenValue(dark, '--accent-foreground');
    const lightFg = tokenValue(light, '--accent-foreground');
    expect(darkFg).toBeTruthy();
    expect(lightFg).toBeTruthy();
    expect(darkFg).not.toBe(lightFg);
  });

  it('flips color-scheme so native controls follow', () => {
    // `color-scheme` lives on the `:root` rule itself, not inside the block we parsed.
    const css = fs.readFileSync(STYLES, 'utf8');
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-theme='light'\]\s*\{[^}]*color-scheme:\s*light/);
  });
});

describe('theme module', () => {
  const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() { return map.size; },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => { map.delete(k); },
      setItem: (k: string, v: string) => { map.set(k, v); },
    } as Storage;
  };

  /** Minimal document stand-in: only the attribute API `theme.ts` actually uses. */
  interface FakeElement {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    getAttribute(name: string): string | null;
  }
  let root: FakeElement;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { localStorage: makeStorage(), matchMedia: () => ({ matches: false }) });
    const attrs = new Map<string, string>();
    root = {
      setAttribute: (n, v) => { attrs.set(n, v); },
      removeAttribute: (n) => { attrs.delete(n); },
      getAttribute: (n) => attrs.get(n) ?? null,
    };
    vi.stubGlobal('document', { documentElement: root });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores the choice and applies the attribute the stylesheet keys off', async () => {
    const { setTheme, currentTheme } = await import('../../src/renderer/src/theme');
    setTheme('light');
    expect(currentTheme()).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    // Dark is the baseline: the attribute is REMOVED rather than set to 'dark', so the default
    // token block needs no companion rule.
    setTheme('dark');
    expect(root.getAttribute('data-theme')).toBeNull();
  });

  it('honours the OS preference only when the operator has not chosen', async () => {
    vi.stubGlobal('window', {
      localStorage: makeStorage(),
      matchMedia: () => ({ matches: true }),
    });
    const { currentTheme, setTheme } = await import('../../src/renderer/src/theme');
    expect(currentTheme(), 'light OS preference wins with no stored choice').toBe('light');
    setTheme('dark');
    expect(currentTheme(), 'an explicit choice beats the OS preference').toBe('dark');
  });

  it('does not throw when storage is unavailable', async () => {
    // The renderer is also served to a plain browser and runs in tests; private mode and
    // blocked storage both make localStorage throw on ACCESS, which must not break startup.
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked by policy');
      },
      matchMedia: () => ({ matches: false }),
    });
    const { currentTheme, setTheme } = await import('../../src/renderer/src/theme');
    expect(() => setTheme('light')).not.toThrow();
    expect(currentTheme()).toBe('dark');
  });
});

describe('MCP privilege level', () => {
  const SETTINGS_SRC = path.resolve(__dirname, '../../src/main/api/routes/settings.ts');

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ANTIDETECT_MCP_SCOPE;
    vi.resetModules();
  });

  it('defaults to standard and never grants admin implicitly', async () => {
    delete process.env.ANTIDETECT_MCP_SCOPE;
    const { getMcpScope } = await import('../../src/main/api/routes/settings');
    expect(getMcpScope()).toBe('standard');
  });

  it('lets the environment pin the level, and ignores an unknown value', async () => {
    process.env.ANTIDETECT_MCP_SCOPE = 'admin';
    let mod = await import('../../src/main/api/routes/settings');
    expect(mod.getMcpScope()).toBe('admin');

    vi.resetModules();
    process.env.ANTIDETECT_MCP_SCOPE = 'superuser';
    mod = await import('../../src/main/api/routes/settings');
    // An unrecognised level must fall back to the safe one, not be passed through to the
    // server where it would silently behave as `standard` anyway.
    expect(mod.getMcpScope()).toBe('standard');
  });

  it('grants a destructive tool over HTTP only when the scope env says admin', async () => {
    // This drives the REAL request path instead of grepping the source. The defect was that
    // `defaultScope` was hardcoded and the env was read only inside `startStdio`, so over
    // HTTP — the only transport this app uses — the 12 destructive tools were refused
    // regardless of configuration. A text assertion missed that; a request does not.
    process.env.ANTIDETECT_MCP_SCOPE = 'admin';
    vi.resetModules();
    const { McpServer } = await import('../../mcp/src/server');
    const server = new McpServer();
    const asAdmin = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'profiles.delete', arguments: { profile_id: 'not-a-real-id' } },
    });
    // Authorization passed, so the failure must now be about the missing profile — NOT scope.
    const adminText = JSON.stringify(asAdmin);
    expect(adminText).not.toMatch(/Insufficient scope|Forbidden/);

    delete process.env.ANTIDETECT_MCP_SCOPE;
    vi.resetModules();
    const fresh = await import('../../mcp/src/server');
    const stdServer = new fresh.McpServer();
    const asStandard = await stdServer.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'profiles.delete', arguments: { profile_id: 'not-a-real-id' } },
    });
    expect(JSON.stringify(asStandard)).toMatch(/Insufficient scope|Forbidden/);
  });

  it('still allows a non-destructive tool at the default scope', async () => {
    delete process.env.ANTIDETECT_MCP_SCOPE;
    vi.resetModules();
    const { McpServer } = await import('../../mcp/src/server');
    const server = new McpServer();
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'profiles.list', arguments: {} },
    });
    expect(JSON.stringify(res)).not.toMatch(/Insufficient scope|Forbidden/);
  });

  it('the app passes the resolved scope to the MCP child', () => {
    const svc = fs.readFileSync(path.resolve(__dirname, '../../src/main/mcpService.ts'), 'utf8');
    expect(svc).toMatch(/ANTIDETECT_MCP_SCOPE:\s*getMcpScope\(\)/);
  });
});
