/**
 * Theme selection: dark (default) or light.
 *
 * The theme is expressed as `data-theme="light"` on `<html>`; the absence of the attribute
 * means dark, so the dark token block in `styles.css` stays the baseline and a light user
 * is the only one carrying state. `src/renderer/src/styles.css` redefines the colour tokens
 * under `:root[data-theme='light']`.
 *
 * The stored choice is applied as early as possible — `applyStoredTheme()` runs at module
 * import in `main.tsx`, before React renders — because applying it in an effect would paint
 * one dark frame first for a light-theme user.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';

/**
 * Guarded storage access.
 *
 * The renderer is also served to a plain browser and is exercised in tests, so storage may
 * be unavailable (private mode, disabled storage, no `window`). A theme preference must
 * never throw at startup.
 */
function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Access itself can throw when storage is blocked by policy.
  }
  return null;
}

/** The stored preference, or null when the operator has never chosen. */
export function readStoredTheme(): Theme | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : null;
}

/**
 * The theme in effect. An explicit choice always wins; with no choice, the operating
 * system preference decides, so a light-OS user is not forced into a dark app before they
 * have expressed an opinion.
 */
export function currentTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
  } catch {
    // matchMedia can be absent or throw in unusual embeds.
  }
  return 'dark';
}

/** Set the attribute that the stylesheet keys off. Dark removes it, keeping dark as baseline. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

/** Persist and apply. */
export function setTheme(theme: Theme): void {
  try {
    storage()?.setItem(STORAGE_KEY, theme);
  } catch {
    // A full or blocked storage must not stop the theme from applying for this session.
  }
  applyTheme(theme);
}

/** Flip dark↔light, persist, and return the new value. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

/**
 * Apply the stored/system theme immediately. Called once from `main.tsx` before render so
 * there is no flash of the wrong theme on startup.
 */
export function applyStoredTheme(): Theme {
  const theme = currentTheme();
  applyTheme(theme);
  return theme;
}
