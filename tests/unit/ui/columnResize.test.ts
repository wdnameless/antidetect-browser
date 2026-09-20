import { describe, it, expect } from 'vitest';
import { clampDraggedFraction } from '../../../src/renderer/src/useColumnResize';

/**
 * The no-horizontal-scroll contract, at the seam that enforces it.
 *
 * The operator asked for the profiles/proxies tables to be draggable so that everything fits
 * without the horizontal scrollbar («уберём этот стрёмный скрол горизонтальный и дадим
 * возможность… сужать или расширять, чтобы всё помещалось»). CSS alone cannot hold that: the
 * widths are set by a drag, and a drag that is allowed to grow one column without limit pushes
 * the table past its container and the scrollbar comes back. This function is that limit.
 *
 * These cases assert the INVARIANT (the total never exceeds the container), not the arithmetic:
 * a plausible bug — dropping the trailing column's reservation from the upper bound — passes
 * every narrow case and only overflows on a wide window dragged to the maximum.
 */

const CONTAINER = 1000;
const TAIL_MIN = 170;

describe('column resize clamp', () => {
  const base = {
    containerWidth: CONTAINER,
    minWidth: 130,
    tailMinWidth: TAIL_MIN,
  };

  it('never lets the sum of fractions exceed the container', () => {
    // Every other resizable column already claims 0.5; the tail needs its reservation.
    const othersTotal = 0.5;
    const result = clampDraggedFraction({
      ...base,
      startFraction: 0.2,
      deltaPx: 10_000,
      othersTotal,
    });
    expect(result + othersTotal).toBeLessThanOrEqual(1);
    // The trailing column keeps at least its reserved room.
    expect((1 - othersTotal - result) * CONTAINER).toBeGreaterThanOrEqual(TAIL_MIN);
  });

  it('reserves the trailing column even when the drag asks for everything', () => {
    const othersTotal = 0.1;
    const result = clampDraggedFraction({ ...base, startFraction: 0.3, deltaPx: 5_000, othersTotal });
    const tailPx = (1 - othersTotal - result) * CONTAINER;
    expect(tailPx).toBeGreaterThanOrEqual(TAIL_MIN);
  });

  it('stops shrinking a column at its own floor', () => {
    const result = clampDraggedFraction({ ...base, startFraction: 0.3, deltaPx: -10_000, othersTotal: 0.2, minWidth: 130 });
    expect(result * CONTAINER).toBeGreaterThanOrEqual(130);
  });

  it('applies the drag itself when it stays within both bounds', () => {
    // 100px of travel on a 1000px container is 0.1 of the width.
    const result = clampDraggedFraction({ ...base, startFraction: 0.3, deltaPx: 100, othersTotal: 0.2 });
    expect(result).toBeCloseTo(0.4, 5);
  });

  it('leaves the width untouched when the container has no measured width', () => {
    // A container that has not been laid out yet reports 0; dividing by it would produce
    // Infinity (or NaN) and the column would vanish or jump.
    const result = clampDraggedFraction({ ...base, containerWidth: 0, startFraction: 0.3, deltaPx: 250, othersTotal: 0.2 });
    expect(result).toBe(0.3);
  });

  it('produces a total that fits, for every one of the four profiles columns dragged to its maximum', () => {
    // Mirrors the real defaults from Profiles.tsx: four resizable columns summing to 0.755.
    const defaults = [0.045, 0.35, 0.24, 0.12];
    for (let i = 0; i < defaults.length; i++) {
      const othersTotal = defaults.reduce((sum, f, j) => (j === i ? sum : sum + f), 0);
      const dragged = clampDraggedFraction({ ...base, startFraction: defaults[i], deltaPx: 10_000, othersTotal });
      // Every resizable column plus the trailing column's reservation must still fit in 100%.
      expect(othersTotal + dragged + TAIL_MIN / CONTAINER).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
