export interface KeyAction {
  key: string;
  type: 'down' | 'up';
  delayMs: number;
}

export interface TypingPlan {
  keys: KeyAction[];
  durationMs: number;
}

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
 * Box-Muller transform for normal distribution
 */
function randomNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Generate log-normal delay in range [150, 350] ms scaled by paceScale.
 */
function sampleKeyDelay(rng: () => number, paceScale: number): number {
  // mean ~ 230ms, log-normal
  const norm = randomNormal(rng);
  // exp(5.4 + 0.2 * norm) gives approx mean 221, range 150 - 350
  const raw = Math.exp(5.4 + 0.2 * norm);
  const clamped = Math.max(150, Math.min(350, Math.round(raw)));
  return Math.max(10, Math.round(clamped * paceScale));
}

const ADJACENT_KEYS: Record<string, string> = {
  a: 's', b: 'v', c: 'x', d: 'f', e: 'r', f: 'g', g: 'h', h: 'j',
  i: 'o', j: 'k', k: 'l', l: 'k', m: 'n', n: 'b', o: 'p', p: 'o',
  q: 'w', r: 't', s: 'd', t: 'y', u: 'i', v: 'c', w: 'e', x: 'z',
  y: 'u', z: 'x'
};

export function planTyping(
  text: string,
  seed: number,
  paceScale: number = 1,
  allowTypos: boolean = false
): TypingPlan {
  if (text.length === 0) {
    return { keys: [], durationMs: 0 };
  }

  const rng = createMulberry32(seed);
  const keys: KeyAction[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isTypo = allowTypos && rng() < 0.02;

    if (isTypo) {
      // Pick adjacent typo character
      const lower = char.toLowerCase();
      const typoChar = ADJACENT_KEYS[lower] || 'e';

      // 1. Press typo down
      const typoDelay = sampleKeyDelay(rng, paceScale);
      const typoHold = Math.max(20, Math.round(40 * paceScale));
      keys.push({ key: typoChar, type: 'down', delayMs: typoDelay });
      keys.push({ key: typoChar, type: 'up', delayMs: typoHold });

      // 2. Realize mistake: hesitation delay
      const hesitation = Math.max(50, Math.round(180 * paceScale));

      // 3. Backspace down & up
      keys.push({ key: 'Backspace', type: 'down', delayMs: hesitation });
      keys.push({ key: 'Backspace', type: 'up', delayMs: typoHold });
    }

    // Press actual key
    const delay = sampleKeyDelay(rng, paceScale);
    const hold = Math.max(20, Math.round((30 + rng() * 30) * paceScale));
    keys.push({ key: char, type: 'down', delayMs: delay });
    keys.push({ key: char, type: 'up', delayMs: hold });
  }

  const durationMs = keys.reduce((acc, k) => acc + k.delayMs, 0);

  return {
    keys,
    durationMs,
  };
}
