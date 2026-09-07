import { describe, it, expect } from 'vitest';
import { planGlide } from '../../../src/main/motion/trajectory';
import { deriveMotorSeed } from '../../../src/main/motion/seeds';

describe('Motion - Trajectory Planning', () => {
  it('same seed and params yield byte-identical plan', () => {
    const from = { x: 100, y: 100 };
    const to = { x: 800, y: 600 };
    const seed = 12345;

    const plan1 = planGlide(from, to, 32, seed, 1);
    const plan2 = planGlide(from, to, 32, seed, 1);

    expect(plan1).toEqual(plan2);
    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
  });

  it('different seeds yield different paths', () => {
    const from = { x: 100, y: 100 };
    const to = { x: 800, y: 600 };

    const plan1 = planGlide(from, to, 32, 11111, 1);
    const plan2 = planGlide(from, to, 32, 22222, 1);

    expect(plan1.moves).not.toEqual(plan2.moves);
  });

  it('trajectory starts at from and finishes exactly at to', () => {
    const from = { x: 50, y: 50 };
    const to = { x: 500, y: 300 };
    const seed = 999;

    const plan = planGlide(from, to, 32, seed, 1);
    expect(plan.moves.length).toBeGreaterThan(0);
    const lastMove = plan.moves[plan.moves.length - 1];
    expect(lastMove.x).toBe(to.x);
    expect(lastMove.y).toBe(to.y);
  });

  it('scales duration with paceScale', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 300 };
    const seed = 42;

    const fastPlan = planGlide(from, to, 32, seed, 0.5);
    const normalPlan = planGlide(from, to, 32, seed, 1.0);
    const slowPlan = planGlide(from, to, 32, seed, 2.0);

    expect(fastPlan.durationMs).toBeLessThan(normalPlan.durationMs);
    expect(slowPlan.durationMs).toBeGreaterThan(normalPlan.durationMs);
  });

  it('handles zero distance glide gracefully', () => {
    const point = { x: 150, y: 250 };
    const plan = planGlide(point, point, 32, 42, 1);
    expect(plan.moves.length).toBe(1);
    expect(plan.moves[0].x).toBe(point.x);
    expect(plan.moves[0].y).toBe(point.y);
    expect(plan.durationMs).toBe(0);
  });

  it('derives deterministic motor seed from profile primary seed', () => {
    const seed1 = deriveMotorSeed(12345);
    const seed2 = deriveMotorSeed(12345);
    expect(seed1).toBe(seed2);
    expect(seed1).toBeGreaterThan(0);
    expect(seed1).toBeLessThanOrEqual(2147483647);

    const seed3 = deriveMotorSeed(54321);
    expect(seed3).not.toBe(seed1);
  });
});
