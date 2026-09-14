// Guards the noir token layer across the WHOLE renderer, not just the stylesheet.
//
// The redesign's point is that no chrome value carries a hue and that every chrome
// value resolves through tokens. Both are easy to break by accident: one `#3b82f6`
// reintroduced "just for the error state", or a `var(--x, #hex)` fallback for a token
// that was never defined (which silently renders the hex and defeats any restyle).
// Neither shows up in a type check, so this test reads the sources directly.
//
// Operator data colours (the profile/tag colour pickers) are deliberately exempt:
// they are data the operator chose, not chrome. The exemption is keyed on the palette
// that defines them rather than on a filename allowlist, so moving a picker does not
// silently open a hole.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer', 'src');
const CSS_PATH = path.join(RENDERER, 'styles.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

/** The operator's own colour palette — data, not chrome. */
const USER_PALETTE_MODULES = ['palette'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Renderer sources that are NOT the user's own colour data. */
function chromeSources(): string[] {
  return walk(RENDERER).filter((f) => {
    const base = path.basename(f).replace(/\.tsx?$/, '');
    return !USER_PALETTE_MODULES.includes(base);
  });
}

/** The `:root { ... }` block. */
function rootBlock(): string {
  const start = css.indexOf(':root');
  expect(start, ':root block must exist').toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('unterminated :root block');
}

/** Declared token names. */
function declaredTokens(): Set<string> {
  const names = new Set<string>();
  for (const m of rootBlock().matchAll(/(--[\w-]+)\s*:/g)) names.add(m[1]);
  return names;
}

/**
 * True when a colour has no perceptible chroma.
 *
 * Channels are compared with a tolerance rather than for exact equality: the ramp is
 * the standard zinc scale, whose near-black steps differ by 2-5 of 255 (e.g. #09090b
 * is 9/9/11) — a tint no one can see. The offenders this must catch are saturated
 * colours like #ef4444 (spread 189) or #3b82f6 (spread 180). Anything unparseable is
 * reported as coloured so an unknown format cannot slip through.
 */
const CHROMA_TOLERANCE = 12;

function isGreyscale(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'currentcolor' || v === 'inherit' || v === 'none') return true;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((x) => parseInt(x, 16));
    return Math.max(r, g, b) - Math.min(r, g, b) <= CHROMA_TOLERANCE;
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,[^)]*)?\)$/.exec(v);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
    return Math.max(r, g, b) - Math.min(r, g, b) <= CHROMA_TOLERANCE;
  }

  return false;
}

/** Every coloured literal in a source, with its line number. */
function hueLiterals(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)) {
    if (isGreyscale(m[0])) continue;
    out.push(`line ${source.slice(0, m.index).split('\n').length}: ${m[0]}`);
  }
  return out;
}

describe('token layer: nothing carries a hue', () => {
  it('every colour token is greyscale', () => {
    const offenders: string[] = [];
    for (const m of rootBlock().matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const [, name, value] = m;
      if (/font|radius|shadow/.test(name)) continue;
      if (/^var\(/.test(value.trim())) continue;
      if (/gradient\(/.test(value)) continue;
      if (!isGreyscale(value)) offenders.push(`${name}: ${value.trim()}`);
    }
    expect(offenders, 'tokens must be greyscale — the palette is monochrome').toEqual([]);
  });

  it('the stylesheet contains no hue-bearing literal', () => {
    expect(hueLiterals(css), 'chrome must contain no hue').toEqual([]);
  });

  it('no renderer source contains a hue-bearing literal', () => {
    // This is the guard the page sweep exists to satisfy: it covers every page and
    // component, so a reintroduced colour fails the build wherever it lands.
    const offenders: string[] = [];
    for (const file of chromeSources()) {
      const rel = path.relative(RENDERER, file);
      for (const hit of hueLiterals(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel} ${hit}`);
      }
    }
    expect(offenders, 'page and component chrome must contain no hue').toEqual([]);
  });
});

describe('token layer: no orphan references', () => {
  it('every var(--x) reference resolves to a declared token', () => {
    const declared = declaredTokens();
    const orphans = new Set<string>();
    for (const file of chromeSources()) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/var\((--[\w-]+)/g)) {
        if (!declared.has(m[1])) orphans.add(`${path.relative(RENDERER, file)}: ${m[1]}`);
      }
    }
    expect([...orphans], 'a var() referencing an undefined token silently renders its fallback').toEqual([]);
  });

  it('no var() anywhere carries a colour fallback', () => {
    // The old dialect was `var(--bg-secondary, #1e1e24)` where the token never
    // existed — the fallback silently became the real value and the theme broke.
    const offenders: string[] = [];
    for (const file of chromeSources()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const m of source.matchAll(/var\(\s*--[\w-]+\s*,\s*[^)]*\)/g)) {
        offenders.push(`${path.relative(RENDERER, file)} line ${source.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders, 'tokens must be defined, not defaulted inline').toEqual([]);
  });
});

describe('token layer: the noir building blocks exist', () => {
  it('defines surface steps, a divider, control backgrounds and a radius scale', () => {
    const declared = declaredTokens();
    for (const token of [
      '--surface-1',
      '--surface-2',
      '--surface-3',
      '--divider',
      '--control-bg',
      '--control-bg-hover',
      '--control-bg-selected',
      '--border-focus',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-full',
    ]) {
      expect(declared.has(token), `${token} must be defined`).toBe(true);
    }
  });

  it('keeps a focus token that is clearly perceptible', () => {
    // Controls lost their outlines, so the focus ring is now the only affordance
    // telling a keyboard user where they are. It must not be subtle.
    const focus = /--border-focus\s*:\s*([^;]+);/.exec(rootBlock());
    expect(focus).not.toBeNull();
    const alpha = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(focus![1]);
    expect(alpha, 'focus must be an rgba with explicit opacity').not.toBeNull();
    expect(Number(alpha![1])).toBeGreaterThanOrEqual(0.4);
  });
});

describe('frames: boxes gone, dividers kept', () => {
  const ruleFor = (selector: string): string | null => {
    const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
    const m = re.exec(css);
    return m ? m[2] : null;
  };

  it('containers no longer draw a full-perimeter border', () => {
    for (const selector of ['.table-container', '.panel']) {
      const body = ruleFor(selector);
      if (body === null) continue; // selector may have been restructured
      // `border: none` IS the removal; only a real border declaration is a failure.
      const drawsBorder = /(^|;)\s*border\s*:\s*(?!none\b)\S/.test(body);
      expect(drawsBorder, `${selector} must not draw a box border`).toBe(false);
      const elevates = /box-shadow\s*:\s*(?!none\b)\S/.test(body);
      expect(elevates, `${selector} must not rely on elevation to separate itself`).toBe(false);
    }
  });

  it('the modal keeps its border-less card but may still cast a shadow', () => {
    // A modal is an overlay, not an inline container: its shadow is what tells the
    // operator it sits above the page. The border is the part that must go.
    const body = ruleFor('.modal-card');
    if (body !== null) {
      const drawsBorder = /(^|;)\s*border\s*:\s*(?!none\b)\S/.test(body);
      expect(drawsBorder, '.modal-card must not draw a box border').toBe(false);
    }
  });

  it('the structural dividers are still present', () => {
    // R62: boxes go, but the hairlines that carry structure stay. Losing these
    // would make table rows and modal headers run together.
    const rules = css.match(/[^{}]+\{[^}]*\}/g) ?? [];
    const dividers = rules.filter((r) => /border-(top|bottom|left)\s*:\s*1px solid var\(--(divider|border)/.test(r));
    expect(dividers.length, 'hairline dividers must survive the frame removal').toBeGreaterThanOrEqual(4);
  });
});
