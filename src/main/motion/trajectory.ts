export interface Point {
  x: number;
  y: number;
}

export interface MoveStep {
  x: number;
  y: number;
  delayMs: number;
}

export interface GlidePlan {
  moves: MoveStep[];
  durationMs: number;
}

/**
 * Seeded Mulberry32 PRNG returning [0, 1)
 */
function createMulberry32(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plan mouse glide trajectory using Fitts's Law duration and seeded Bezier path with overshoot.
 */
export function planGlide(
  from: Point,
  to: Point,
  targetWidth: number = 32,
  seed: number,
  paceScale: number = 1
): GlidePlan {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 1) {
    return {
      moves: [{ x: Math.round(to.x), y: Math.round(to.y), delayMs: 0 }],
      durationMs: 0,
    };
  }

  const effectiveWidth = Math.max(1, targetWidth);
  // Fitts's Law: duration = (a + b * log2(2 * D / W)) * paceScale
  // a = 100ms, b = 150ms
  const a = 100;
  const b = 150;
  const rawDuration = a + b * Math.log2((2 * distance) / effectiveWidth);
  const durationMs = Math.max(10, Math.round(rawDuration * paceScale));

  const rng = createMulberry32(seed);

  // Number of intermediate move steps (targeting roughly 8ms to 16ms per step)
  const stepsCount = Math.max(5, Math.min(60, Math.round(durationMs / 12)));

  // Control points for cubic bezier with 8% overshoot-and-correct
  // P0 = from
  // P1, P2 with curvature
  // P3 = target with 8% overshoot
  // P4 = final to
  const overshootFactor = 0.08;
  const overshootX = to.x + dx * overshootFactor * (0.8 + 0.4 * rng());
  const overshootY = to.y + dy * overshootFactor * (0.8 + 0.4 * rng());

  // Perpendicular offset for curve
  const perpX = -dy / distance;
  const perpY = dx / distance;
  const curveMagnitude = (rng() - 0.5) * Math.min( distance * 0.3, 40);

  const p1x = from.x + dx * 0.3 + perpX * curveMagnitude;
  const p1y = from.y + dy * 0.3 + perpY * curveMagnitude;
  const p2x = from.x + dx * 0.7 - perpX * curveMagnitude * 0.5;
  const p2y = from.y + dy * 0.7 - perpY * curveMagnitude * 0.5;

  const moves: MoveStep[] = [];
  const baseStepDelay = durationMs / stepsCount;

  // Split into 2 phases: 85% time to overshoot, 15% time to correct back to target
  const phase1Steps = Math.max(3, Math.round(stepsCount * 0.85));
  const phase2Steps = stepsCount - phase1Steps;

  // Phase 1: from -> overshoot via cubic bezier
  for (let i = 1; i <= phase1Steps; i++) {
    const t = i / phase1Steps;
    // Cubic bezier formula: (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
    const mt = 1 - t;
    const x =
      mt * mt * mt * from.x +
      3 * mt * mt * t * p1x +
      3 * mt * t * t * p2x +
      t * t * t * overshootX;
    const y =
      mt * mt * mt * from.y +
      3 * mt * mt * t * p1y +
      3 * mt * t * t * p2y +
      t * t * t * overshootY;

    // Small delay jitter
    const delay = Math.max(1, Math.round(baseStepDelay + (rng() - 0.5) * 2));
    moves.push({ x: Math.round(x), y: Math.round(y), delayMs: delay });
  }

  // Phase 2: overshoot -> to (correction)
  for (let i = 1; i <= phase2Steps; i++) {
    const t = i / phase2Steps;
    const x = overshootX + (to.x - overshootX) * t;
    const y = overshootY + (to.y - overshootY) * t;
    const delay = Math.max(1, Math.round(baseStepDelay + (rng() - 0.5) * 2));
    moves.push({ x: Math.round(x), y: Math.round(y), delayMs: delay });
  }

  // Ensure final point is exact to
  if (moves.length > 0) {
    moves[moves.length - 1].x = Math.round(to.x);
    moves[moves.length - 1].y = Math.round(to.y);
  }

  const actualDurationMs = moves.reduce((acc, m) => acc + m.delayMs, 0);

  return {
    moves,
    durationMs: actualDurationMs,
  };
}
