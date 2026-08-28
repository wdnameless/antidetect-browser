// Stable CSS selector path builder (Sprint 3.2).
//
// A selector path is a chain from <body> down to the target element where every
// step is `tag:nth-of-type(k)` (1-based position among same-tag siblings). The
// chain is stable across identical DOM structures — which is what slaves have,
// since they replay the same sites — and is cheap to resolve with
// document.querySelectorAll in the slave.
//
// Pure string/AST helpers live here so they can be unit-tested without a
// browser; the DOM walking itself happens in the injected master script (see
// actionSyncer.ts MASTER_LISTENER) using the same nth-of-type scheme.

export interface SelectorStep {
  tag: string;
  nth: number;
  id?: string;
}

/** Build the path string from pre-computed steps (pure). */
export function selectorPathFromSteps(steps: SelectorStep[]): string {
  return steps
    .map((s) => (s.id ? `#${cssEscapeIdent(s.id)}` : `${s.tag}:nth-of-type(${s.nth})`))
    .join(' > ');
}

/** Minimal CSS identifier escape for id steps (#my-id, no quotes needed). */
export function cssEscapeIdent(ident: string): string {
  // Escape anything that is not a valid ident char.
  return ident.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export function nthOfTypeSelector(tag: string, nth: number): string {
  return `${tag}:nth-of-type(${Math.max(1, Math.round(nth))})`;
}

/**
 * Match a slave-side element against the master path: a slave step list equals
 * the master's when every step matches tag+nth (ids match when both present).
 * Pure — used by tests; the slave runtime uses querySelector directly.
 */
export function selectorStepsMatch(master: SelectorStep[], slave: SelectorStep[]): boolean {
  if (master.length === 0 || master.length !== slave.length) return false;
  for (let i = 0; i < master.length; i++) {
    const m = master[i];
    const s = slave[i];
    if (m.id && s.id) {
      if (m.id !== s.id) return false;
    } else if (m.tag.toLowerCase() !== s.tag.toLowerCase() || m.nth !== s.nth) {
      return false;
    }
  }
  return true;
}

/** Parse a generated path back into steps (inverse of selectorPathFromSteps for nth chains). */
export function parseSelectorPath(path: string): SelectorStep[] {
  return path
    .split(' > ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('#')) {
        const id = part.slice(1).replace(/\\(.)/g, '$1');
        return { tag: '', nth: 1, id };
      }
      const m = part.match(/^([a-zA-Z][\w-]*):nth-of-type\((\d+)\)$/);
      if (!m) return { tag: part, nth: 1 };
      return { tag: m[1], nth: Number(m[2]) };
    });
}