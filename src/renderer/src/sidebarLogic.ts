export const SIDEBAR_COLLAPSED_KEY = 'sidebar.collapsed';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
    return window.localStorage;
  }
  const g = globalThis as unknown as { localStorage?: Storage };
  if (typeof g !== 'undefined' && g.localStorage) {
    return g.localStorage;
  }
  return null;
}

export function getStoredSidebarCollapsed(): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    const val = storage.getItem(SIDEBAR_COLLAPSED_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export function persistSidebarCollapsed(collapsed: boolean): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage write errors in restricted contexts
  }
}

export function isToggleShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  const isModifier = Boolean(e.ctrlKey || e.metaKey);
  if (!isModifier || (e.key !== 'b' && e.key !== 'B')) {
    return false;
  }

  const el = e.target as HTMLElement | null;
  if (el) {
    const tagName = el.tagName?.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return false;
    }
    if (el.isContentEditable) {
      return false;
    }
  }

  return true;
}

export function computeRunningCount(profiles: Array<{ status?: string | null }> | null | undefined): number {
  if (!Array.isArray(profiles)) return 0;
  return profiles.reduce((acc, p) => (p?.status === 'running' ? acc + 1 : acc), 0);
}
export function isEmailTab(tab: string): boolean {
  return tab === 'email';
}
