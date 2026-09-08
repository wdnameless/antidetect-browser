import { deriveMotorSeed } from './seeds';
import { planGlide, GlidePlan, Point } from './trajectory';
import { planTyping, TypingPlan } from './typing';

export interface MotionPointer {
  x: number;
  y: number;
  seed: number;
  paceScale: number;
}

export interface MotionPointerState {
  pointer: MotionPointer;
}

export interface CreatePointerOptions {
  seed?: number;
  paceScale?: number;
  profileSeed?: number;
  startX?: number;
  startY?: number;
}

export interface TapResult {
  x: number;
  y: number;
  clicks: number;
  button: 'left' | 'right' | 'middle';
  delayMs: number;
}

export class MotionSessionError extends Error {
  public code: number;

  constructor(message: string, code: number = -32001) {
    super(message);
    this.name = 'MotionSessionError';
    this.code = code;
  }
}

export class MotionSessionRegistry {
  private static instance: MotionSessionRegistry;
  private readonly sessions = new Map<string, MotionPointerState>();

  public static getInstance(): MotionSessionRegistry {
    if (!MotionSessionRegistry.instance) {
      MotionSessionRegistry.instance = new MotionSessionRegistry();
    }
    return MotionSessionRegistry.instance;
  }

  public createPointer(profileId: string, options: CreatePointerOptions = {}): MotionPointer {
    const seed = options.seed ?? (options.profileSeed ? deriveMotorSeed(options.profileSeed) : 1);
    const paceScale = options.paceScale ?? 1;
    const x = options.startX ?? 0;
    const y = options.startY ?? 0;

    const pointer: MotionPointer = {
      x,
      y,
      seed,
      paceScale,
    };

    this.sessions.set(profileId, { pointer });
    return pointer;
  }

  public getPointer(profileId: string): MotionPointer | undefined {
    return this.sessions.get(profileId)?.pointer;
  }

  public hasPointer(profileId: string): boolean {
    return this.sessions.has(profileId);
  }

  private requirePointer(profileId: string): MotionPointer {
    const session = this.sessions.get(profileId);
    if (!session || !session.pointer) {
      throw new MotionSessionError(`No pointer initialized for profile: ${profileId}`, -32001);
    }
    return session.pointer;
  }

  public glideTo(
    profileId: string,
    target: Point,
    targetWidth: number = 32
  ): { plan: GlidePlan; pointer: MotionPointer } {
    const pointer = this.requirePointer(profileId);
    const plan = planGlide(
      { x: pointer.x, y: pointer.y },
      target,
      targetWidth,
      pointer.seed,
      pointer.paceScale
    );

    // Update pointer position and advance seed deterministically
    pointer.x = target.x;
    pointer.y = target.y;
    pointer.seed = ((pointer.seed + 1013904223) & 0x7fffffff) || 1;

    return { plan, pointer };
  }

  public tap(
    profileId: string,
    options: { clickCount?: number; button?: 'left' | 'right' | 'middle'; delayMs?: number } = {}
  ): TapResult {
    const pointer = this.requirePointer(profileId);
    const clicks = options.clickCount ?? 1;
    const button = options.button ?? 'left';
    const delayMs = options.delayMs ?? Math.round(50 * pointer.paceScale);

    pointer.seed = ((pointer.seed + 1013904223) & 0x7fffffff) || 1;

    return {
      x: pointer.x,
      y: pointer.y,
      clicks,
      button,
      delayMs,
    };
  }

  public enterText(
    profileId: string,
    text: string,
    allowTypos: boolean = false
  ): { plan: TypingPlan; pointer: MotionPointer } {
    const pointer = this.requirePointer(profileId);
    const plan = planTyping(text, pointer.seed, pointer.paceScale, allowTypos);

    pointer.seed = ((pointer.seed + 1013904223) & 0x7fffffff) || 1;

    return { plan, pointer };
  }

  public destroyPointer(profileId: string): boolean {
    const session = this.sessions.get(profileId);
    if (!session) {
      throw new MotionSessionError(`No pointer initialized for profile: ${profileId}`, -32001);
    }
    return this.sessions.delete(profileId);
  }

  public clear(): void {
    this.sessions.clear();
  }
}

export const motionSessions = MotionSessionRegistry.getInstance();
