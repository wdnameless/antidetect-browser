import { describe, it, expect } from 'vitest';
import { planTyping } from '../../../src/main/motion/typing';

describe('Motion - Typing Planning', () => {
  it('same seed and text yield identical typing plan', () => {
    const text = 'Hello world!';
    const seed = 54321;

    const plan1 = planTyping(text, seed, 1, false);
    const plan2 = planTyping(text, seed, 1, false);

    expect(plan1).toEqual(plan2);
  });

  it('allowTypos=false NEVER introduces typos or backspaces', () => {
    const text = 'Strict typing without errors';
    const plan = planTyping(text, 999, 1, false);

    const backspaces = plan.keys.filter((k) => k.key === 'Backspace');
    expect(backspaces.length).toBe(0);

    const downKeys = plan.keys.filter((k) => k.type === 'down').map((k) => k.key);
    expect(downKeys.join('')).toBe(text);
  });

  it('allowTypos=true with typo introduces backspace corrections and recovers text', () => {
    // Generate across enough characters to trigger typo (or run through multiple seeds)
    const text = 'A sufficiently long sentence to ensure that simulated motor typing will trigger at least one typo and correction.';
    let foundTypo = false;

    for (let seed = 1; seed <= 20; seed++) {
      const plan = planTyping(text, seed, 1, true);
      const backspaces = plan.keys.filter((k) => k.key === 'Backspace' && k.type === 'down');
      if (backspaces.length > 0) {
        foundTypo = true;
        // Verify that every typo down is followed by up, hesitation, backspace down, backspace up
        // And if we replay typing:
        let buffer = '';
        for (const action of plan.keys) {
          if (action.type === 'down') {
            if (action.key === 'Backspace') {
              buffer = buffer.slice(0, -1);
            } else {
              buffer += action.key;
            }
          }
        }
        expect(buffer).toBe(text);
        break;
      }
    }

    expect(foundTypo).toBe(true);
  });

  it('delays fall within expected bounds ~150-350ms (at paceScale 1)', () => {
    const text = 'Performance metrics test';
    const plan = planTyping(text, 1234, 1, false);

    const downDelays = plan.keys.filter((k) => k.type === 'down').map((k) => k.delayMs);
    for (const delay of downDelays) {
      expect(delay).toBeGreaterThanOrEqual(150);
      expect(delay).toBeLessThanOrEqual(350);
    }
  });

  it('handles empty string gracefully', () => {
    const plan = planTyping('', 123, 1, false);
    expect(plan.keys.length).toBe(0);
    expect(plan.durationMs).toBe(0);
  });
});
