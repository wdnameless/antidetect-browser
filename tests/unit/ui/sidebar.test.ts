import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SIDEBAR_COLLAPSED_KEY,
  getStoredSidebarCollapsed,
  persistSidebarCollapsed,
  isToggleShortcut,
  computeRunningCount,
} from '../../../src/renderer/src/sidebarLogic';

describe('sidebarLogic', () => {
  let store: Record<string, string> = {};

  const mockStorage: Storage = {
    length: 0,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
  };

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('window', { localStorage: mockStorage });
  });

  describe('getStoredSidebarCollapsed & persistSidebarCollapsed', () => {
    it('returns false when no preference stored', () => {
      expect(getStoredSidebarCollapsed()).toBe(false);
    });

    it('persists true and reads true', () => {
      persistSidebarCollapsed(true);
      expect(mockStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true');
      expect(getStoredSidebarCollapsed()).toBe(true);
    });

    it('persists false and reads false', () => {
      persistSidebarCollapsed(false);
      expect(mockStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');
      expect(getStoredSidebarCollapsed()).toBe(false);
    });
  });

  describe('isToggleShortcut', () => {
    it('detects Ctrl+B / Cmd+B shortcut', () => {
      expect(isToggleShortcut({ key: 'b', ctrlKey: true })).toBe(true);
      expect(isToggleShortcut({ key: 'B', metaKey: true })).toBe(true);
    });

    it('ignores shortcut when neither ctrl nor meta is pressed', () => {
      expect(isToggleShortcut({ key: 'b' })).toBe(false);
      expect(isToggleShortcut({ key: 'B' })).toBe(false);
    });

    it('ignores other keys with ctrl/cmd', () => {
      expect(isToggleShortcut({ key: 'c', ctrlKey: true })).toBe(false);
      expect(isToggleShortcut({ key: 'a', metaKey: true })).toBe(false);
    });

    it('ignores shortcut when focus is in input / textarea / select', () => {
      const inputEl = { tagName: 'INPUT' } as unknown as HTMLElement;
      const textareaEl = { tagName: 'TEXTAREA' } as unknown as HTMLElement;
      const selectEl = { tagName: 'SELECT' } as unknown as HTMLElement;
      const editableEl = { tagName: 'DIV', isContentEditable: true } as unknown as HTMLElement;

      expect(isToggleShortcut({ key: 'b', ctrlKey: true, target: inputEl })).toBe(false);
      expect(isToggleShortcut({ key: 'b', ctrlKey: true, target: textareaEl })).toBe(false);
      expect(isToggleShortcut({ key: 'b', ctrlKey: true, target: selectEl })).toBe(false);
      expect(isToggleShortcut({ key: 'b', ctrlKey: true, target: editableEl })).toBe(false);
    });

    it('allows shortcut when focus is on a button or div', () => {
      const btnEl = { tagName: 'BUTTON' } as unknown as HTMLElement;
      const divEl = { tagName: 'DIV', isContentEditable: false } as unknown as HTMLElement;

      expect(isToggleShortcut({ key: 'b', ctrlKey: true, target: btnEl })).toBe(true);
      expect(isToggleShortcut({ key: 'b', metaKey: true, target: divEl })).toBe(true);
    });
  });

  describe('computeRunningCount', () => {
    it('returns 0 for empty or null array', () => {
      expect(computeRunningCount(null)).toBe(0);
      expect(computeRunningCount(undefined)).toBe(0);
      expect(computeRunningCount([])).toBe(0);
    });

    it('counts only running profiles', () => {
      const list = [
        { status: 'running' },
        { status: 'stopped' },
        { status: 'running' },
        { status: 'error' },
        { status: 'ready' },
      ];
      expect(computeRunningCount(list)).toBe(2);
    });

    it('returns 0 when no profiles are running', () => {
      const list = [
        { status: 'stopped' },
        { status: 'ready' },
      ];
      expect(computeRunningCount(list)).toBe(0);
    });
  });
});
