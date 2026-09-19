import { describe, it, expect } from 'vitest';
import { computeRunningCount } from '../../../src/renderer/src/sidebarLogic';

describe('sidebarLogic', () => {
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

    it('tolerates null entries', () => {
      expect(computeRunningCount([null, { status: 'running' }])).toBe(1);
    });
  });
});
