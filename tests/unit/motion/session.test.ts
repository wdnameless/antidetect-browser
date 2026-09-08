import { describe, it, expect, beforeEach } from 'vitest';
import { motionSessions, MotionSessionError } from '../../../src/main/motion/session';

describe('Motion - Session Registry', () => {
  beforeEach(() => {
    motionSessions.clear();
  });

  it('createPointer registers a pointer state', () => {
    const pointer = motionSessions.createPointer('prof-1', {
      seed: 42,
      paceScale: 1.2,
      startX: 10,
      startY: 20,
    });

    expect(pointer.x).toBe(10);
    expect(pointer.y).toBe(20);
    expect(pointer.seed).toBe(42);
    expect(pointer.paceScale).toBe(1.2);

    expect(motionSessions.hasPointer('prof-1')).toBe(true);
    expect(motionSessions.getPointer('prof-1')).toBe(pointer);
  });

  it('fails closed (-32001) for all commands when pointer is not initialized', () => {
    expect(() => motionSessions.glideTo('missing', { x: 100, y: 100 })).toThrowError(
      MotionSessionError
    );
    try {
      motionSessions.glideTo('missing', { x: 100, y: 100 });
    } catch (e) {
      expect((e as MotionSessionError).code).toBe(-32001);
    }

    expect(() => motionSessions.tap('missing')).toThrowError(MotionSessionError);
    expect(() => motionSessions.enterText('missing', 'abc')).toThrowError(MotionSessionError);
    expect(() => motionSessions.destroyPointer('missing')).toThrowError(MotionSessionError);
  });

  it('glideTo updates pointer coordinates and advances seed', () => {
    const pointer = motionSessions.createPointer('prof-2', {
      seed: 100,
      startX: 0,
      startY: 0,
    });

    const initialSeed = pointer.seed;
    const { plan, pointer: updatedPointer } = motionSessions.glideTo('prof-2', { x: 300, y: 400 });

    expect(updatedPointer.x).toBe(300);
    expect(updatedPointer.y).toBe(400);
    expect(updatedPointer.seed).not.toBe(initialSeed);
    expect(plan.moves.length).toBeGreaterThan(0);
  });

  it('tap advances seed and returns click payload', () => {
    const pointer = motionSessions.createPointer('prof-3', {
      seed: 555,
      startX: 50,
      startY: 60,
    });

    const initialSeed = pointer.seed;
    const tapRes = motionSessions.tap('prof-3', { clickCount: 2, button: 'right' });

    expect(tapRes.x).toBe(50);
    expect(tapRes.y).toBe(60);
    expect(tapRes.clicks).toBe(2);
    expect(tapRes.button).toBe('right');
    expect(pointer.seed).not.toBe(initialSeed);
  });

  it('destroyPointer removes pointer and subsequent operations fail closed', () => {
    motionSessions.createPointer('prof-4');
    expect(motionSessions.hasPointer('prof-4')).toBe(true);

    const destroyed = motionSessions.destroyPointer('prof-4');
    expect(destroyed).toBe(true);
    expect(motionSessions.hasPointer('prof-4')).toBe(false);

    expect(() => motionSessions.tap('prof-4')).toThrowError(MotionSessionError);
  });
});
