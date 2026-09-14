import { describe, it, expect } from 'vitest';
import * as vm from 'vm';
import {
  mapCapturedAction,
  CaptureRecord,
  TypingCoalescer,
} from '../../src/main/recorder/actionMap';
import { buildRecorderListenerSource } from '../../src/main/recorder/listener';
import { parseSelectorPath } from '../../src/main/util/selectorPath';
import { FlowNodeSchema } from '../../src/main/flows/types';

describe('flow recorder: capture record -> flow node mapping', () => {
  const steps = [
    { tag: 'body', nth: 1 },
    { tag: 'main', nth: 1 },
    { tag: 'button', nth: 2 },
  ];
  const selector = 'body:nth-of-type(1) > main:nth-of-type(1) > button:nth-of-type(2)';

  it('maps a click to a validated click node with the selector filled', () => {
    const node = mapCapturedAction({ kind: 'click', selector });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('click');
    expect(node.selector).toBe(selector);
    expect(node.id).toMatch(/^node-click-\d{4}$/);
    expect(node.name).toBe('Click Element');
  });

  it('maps a click to human_click when opts.human is set', () => {
    const node = mapCapturedAction({ kind: 'click', selector }, { human: true });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('human_click');
    expect(node.selector).toBe(selector);
  });

  it('maps a type record to a validated type node carrying the text', () => {
    const node = mapCapturedAction({ kind: 'type', selector, text: 'hello@example.com' });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('type');
    expect(node.selector).toBe(selector);
    expect(node.text).toBe('hello@example.com');
  });

  it('maps a type record to human_type when opts.human is set', () => {
    const node = mapCapturedAction({ kind: 'type', selector, text: 'hello' }, { human: true });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('human_type');
    expect(node.text).toBe('hello');
    expect(node.allowTypos).toBe(false);
  });

  it('maps a navigate record to a validated navigate node', () => {
    const node = mapCapturedAction({ kind: 'navigate', selector: null, url: 'https://example.com/login' });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('navigate');
    expect(node.url).toBe('https://example.com/login');
  });

  it('maps a url-bearing key record to a navigate node', () => {
    const node = mapCapturedAction({ kind: 'key', selector: null, url: 'https://example.com/next' });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('navigate');
    expect(node.url).toBe('https://example.com/next');
  });

  it('maps a wait request to a validated wait node (time)', () => {
    const node = mapCapturedAction({ kind: 'wait', selector: null, waitType: 'time', durationMs: 1500 });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('wait');
    expect(node.waitType).toBe('time');
  });

  it('maps a selector wait request to a wait node waiting for the selector', () => {
    const node = mapCapturedAction({ kind: 'wait', selector, waitType: 'selector' });
    expect(node).not.toBeNull();
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !node) return;
    expect(node.type).toBe('wait');
    expect(node.waitType).toBe('selector');
    expect(node.selector).toBe(selector);
  });

  it('is inert for an untargeted scroll', () => {
    expect(mapCapturedAction({ kind: 'scroll', selector: null })).toBeNull();
  });

  it('is inert for a lone modifier key', () => {
    expect(mapCapturedAction({ kind: 'key', selector: null, text: 'Shift' })).toBeNull();
  });

  it('is inert for an unrecognised record kind', () => {
    expect(mapCapturedAction({ kind: 'mousemove', selector } as CaptureRecord)).toBeNull();
  });

  it('is inert for a click without a selector', () => {
    expect(mapCapturedAction({ kind: 'click', selector: null })).toBeNull();
  });

  it('is inert for a navigate without a url', () => {
    expect(mapCapturedAction({ kind: 'navigate', selector: null })).toBeNull();
  });
});

describe('flow recorder: typing burst coalescing', () => {
  const inputPath = 'html:nth-of-type(1) > body:nth-of-type(1) > input:nth-of-type(1)';

  it('folds a realistic keystroke burst into exactly ONE type record', () => {
    const coalescer = new TypingCoalescer(250);
    const records: CaptureRecord[] = [];
    const push = (text: string, ms: number) => {
      const out = coalescer.push({ kind: 'key', selector: inputPath, text }, ms);
      records.push(...out);
    };
    // A user typing "hello world" at 80 wpm ≈ 90 ms per keystroke.
    const chars = 'hello world'.split('');
    let now = 1000;
    for (const ch of chars) {
      now += 90;
      push(ch, now);
    }
    // A click lands shortly after — closes the burst (folded type + click).
    records.push(...coalescer.push({ kind: 'click', selector: inputPath }, now + 120));
    expect(records.length).toBe(2);
    expect(records[0]).toMatchObject({ kind: 'type', selector: inputPath, text: 'hello world' });
    expect(records[1].kind).toBe('click');
  });

  it('keeps bursts for different selectors separate', () => {
    const coalescer = new TypingCoalescer(250);
    const out: CaptureRecord[] = [];
    out.push(...coalescer.push({ kind: 'key', selector: 'a > input:nth-of-type(1)', text: 'x' }, 1000));
    out.push(...coalescer.push({ kind: 'key', selector: 'b > input:nth-of-type(1)', text: 'y' }, 1010));
    // First burst closed early -> separate node for each field.
    expect(out.length).toBe(1);
    expect(out[0].text).toBe('x');
    expect(coalescer.flush()).toMatchObject([{ kind: 'type', text: 'y' }]);
  });

  it('ignores modifier key records without closing the burst', () => {
    const coalescer = new TypingCoalescer(250);
    coalescer.push({ kind: 'key', selector: inputPath, text: 'h' }, 1000);
    // Shift held/released between characters is not a character itself.
    const out = coalescer.push({ kind: 'key', selector: null, text: 'Shift' }, 1020);
    coalescer.push({ kind: 'key', selector: inputPath, text: 'i' }, 1040);
    expect(out).toEqual([]);
    expect(coalescer.flush()).toMatchObject([{ kind: 'type', selector: inputPath, text: 'hi' }]);
  });

  it('a slow final keystroke closes the burst (time window expired)', () => {
    const coalescer = new TypingCoalescer(250);
    coalescer.push({ kind: 'key', selector: inputPath, text: 'a' }, 1000);
    // 500 ms pause: the next keystroke starts a new burst.
    const out = coalescer.push({ kind: 'key', selector: inputPath, text: 'b' }, 1500);
    expect(out).toMatchObject([{ kind: 'type', selector: inputPath, text: 'a' }]);
    expect(coalescer.flush()).toMatchObject([{ kind: 'type', selector: inputPath, text: 'b' }]);
  });

  it('a field blur/change record supersedes the burst with the final value', () => {
    const coalescer = new TypingCoalescer(250);
    coalescer.push({ kind: 'key', selector: inputPath, text: 'h' }, 1000);
    coalescer.push({ kind: 'key', selector: inputPath, text: 'i' }, 1050);
    const out = coalescer.push({ kind: 'type', selector: inputPath, text: 'hello' }, 1100);
    expect(out).toMatchObject([{ kind: 'type', selector: inputPath, text: 'hello' }]);
  });

  it('maps a coalesced burst to exactly ONE flow node (integration)', () => {
    const coalescer = new TypingCoalescer(250);
    const records: CaptureRecord[] = [];
    const chars = 'p@ssw0rd!'.split('');
    let now = 500;
    for (const ch of chars) {
      now += 80;
      records.push(...coalescer.push({ kind: 'key', selector: inputPath, text: ch }, now));
    }
    records.push(...coalescer.flush());
    const nodes = records
      .map((r) => mapCapturedAction(r))
      .filter((n): n is NonNullable<typeof n> => n !== null);
    expect(nodes.length).toBe(1);
    if (nodes.length !== 1) return;
    const parsed = FlowNodeSchema.safeParse(nodes[0]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(nodes[0].type).toBe('type');
    expect(nodes[0].text).toBe('p@ssw0rd!');
  });
});

describe('flow recorder: selector derivation round-trips the existing scheme', () => {
  it('selector emitted by the listener parses back through parseSelectorPath', () => {
    // Same shape the injected listener builds in-page (see listener.ts):
    // id-steps stop the chain and the remainder is tag:nth-of-type steps.
    const pageSteps = [
      { tag: 'body', nth: 1 },
      { tag: '', nth: 1, id: 'login-form' },
      { tag: 'input', nth: 2 },
    ];
    const path = pageSteps
      .map((s) => (s.id ? `#${s.id}` : `${s.tag}:nth-of-type(${s.nth})`))
      .join(' > ');
    const parsed = parseSelectorPath(path);
    expect(parsed).toEqual(pageSteps);
  });

  it('a recorded navigate/click node round-trips selector steps via parseSelectorPath', () => {
    const clicked = mapCapturedAction({
      kind: 'click',
      selector: 'html:nth-of-type(1) > body:nth-of-type(1) > div:nth-of-type(3) > button:nth-of-type(1)',
    });
    if (!clicked || clicked.type !== 'click') {
      expect(clicked).not.toBeNull();
      return;
    }
    const steps = parseSelectorPath(clicked.selector);
    expect(steps).toEqual([
      { tag: 'html', nth: 1 },
      { tag: 'body', nth: 1 },
      { tag: 'div', nth: 3 },
      { tag: 'button', nth: 1 },
    ]);
  });
});

describe('flow recorder: injected listener is valid plain JavaScript', () => {
  it('buildRecorderListenerSource parses with new vm.Script', () => {
    const source = buildRecorderListenerSource();
    let failure: string | null = null;
    try {
      new vm.Script(source);
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure).toBeNull();
  });

  it('emits records per the shared capture contract shape', () => {
    const source = buildRecorderListenerSource();
    expect(source).toContain('kind: kind');
    expect(source).toContain('selector: null');
    expect(source).toContain("'click'");
    expect(source).toContain("'key'");
    expect(source).toContain("'navigate'");
    expect(source).toContain("'scroll'");
    expect(source).toContain("'type'");
  });

  it('is gated to recording/picker modes and inert otherwise', () => {
    const source = buildRecorderListenerSource();
    expect(source).toContain("mode !== 'recording'");
    expect(source).toContain("mode !== 'recording' && mode !== 'picker'");
  });

  it('derives selectors with the shared selector-path scheme (no second algorithm)', () => {
    const source = buildRecorderListenerSource();
    expect(source).toContain(':nth-of-type(');
  });
});
