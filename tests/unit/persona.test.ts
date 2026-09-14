import { describe, it, expect } from 'vitest';
import {
  generatePersona,
  passesLuhn,
  luhnCheckDigit,
  personaFieldValue,
  Persona,
  PERSONA_FIELDS,
} from '../../src/main/motion/persona';
import { planTyping } from '../../src/main/motion/typing';
import { validateFlow } from '../../src/main/flows/validator';
import { compileFlowToScript } from '../../src/main/flows/compiler';
import type { FlowDocument } from '../../src/main/flows/types';
import { fillForm } from '../../src/main/motion/formFill';
import type { CdpHandle } from '../../src/main/motion/cdpClient';

// UK postcode area per region, mirroring the locale table in persona.ts. Kept
// here so the test asserts region/postcode agreement independently of the
// implementation's own data.
const POSTCODE_AREA_BY_REGION: Record<string, string> = {
  London: 'W',
  'Greater Manchester': 'M',
  Bristol: 'BS',
  'West Yorkshire': 'LS',
  Edinburgh: 'EH',
  Cardiff: 'CF',
};

describe('Persona generation', () => {
  it('is deterministic across runs — same seed, same person, forever', () => {
    const a = generatePersona(424242, { now: 1_750_000_000_000 });
    const b = generatePersona(424242, { now: 1_750_000_000_000 });
    expect(a).toEqual(b);
  });

  it('is distinct across seeds — no shared name/address/email/phone/card', () => {
    // Collect a decent sample and assert pairwise distinctness of identity atoms.
    const identities = Array.from({ length: 12 }, (_, i) => generatePersona(1000 + i, { now: 1_750_000_000_000 }));
    for (let i = 0; i < identities.length; i++) {
      for (let j = i + 1; j < identities.length; j++) {
        const a = identities[i];
        const b = identities[j];
        expect(a.fullName).not.toBe(b.fullName);
        expect(a.address).not.toBe(b.address);
        expect(a.email).not.toBe(b.email);
        expect(a.phone).not.toBe(b.phone);
        expect(a.card.number).not.toBe(b.card.number);
      }
    }
  });

  it('derives the email local part from the name', () => {
    const persona = generatePersona(777, { country: 'US', now: 1_750_000_000_000 });
    const local = persona.email.split('@')[0];
    const base = `${persona.givenName}.${persona.familyName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    // local part is base, or base + digits suffix.
    expect(local === base || /^[a-z0-9]+\d+$/.test(local)).toBe(true);
    expect(local.includes(persona.givenName.toLowerCase()) && local.includes(persona.familyName.toLowerCase())).toBe(true);
  });

  it('produces a US persona whose postcode digits match its region prefix', () => {
    const persona = generatePersona(555, { country: 'US', now: 1_750_000_000_000 });
    expect(persona.country).toBe('US');
    expect(persona.postcode).toMatch(/^\d{5}$/);
    // region -> leading digits: CA=9, NY=1, TX=7, CO=8, FL=3, WA=98
    const regionPrefix: Record<string, string> = { CA: '9', NY: '1', TX: '7', CO: '8', FL: '3', WA: '98' };
    expect(persona.postcode.startsWith(regionPrefix[persona.region])).toBe(true);
  });

  it('produces a GB persona whose postcode matches its region prefix', () => {
    const persona = generatePersona(556, { country: 'GB', now: 1_750_000_000_000 });
    expect(persona.country).toBe('GB');
    // UK shape: outward (1-2 letters + digit, optional letter) SPACE inward (digit + 2 letters).
    expect(persona.postcode).toMatch(/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/);
    // The outward area code must belong to the persona's own region, so postcode
    // and region agree. Compare against the region's postcode area, not its name.
    const area = persona.postcode.split(' ')[0].replace(/\d.*$/, '');
    expect(POSTCODE_AREA_BY_REGION[persona.region]).toBe(area);
  });

  it('produces a phone number in the country national shape', () => {
    const us = generatePersona(557, { country: 'US', now: 1_750_000_000_000 });
    expect(us.phone).toMatch(/^\+1\d{10}$/);
    // UK mobile: +44 7xxxx xxxx — leading 7, 4 more area digits, 4-digit subscriber.
    const gb = generatePersona(558, { country: 'GB', now: 1_750_000_000_000 });
    expect(gb.phone).toMatch(/^\+44 7\d{4} \d{4}$/);
    const de = generatePersona(559, { country: 'DE', now: 1_750_000_000_000 });
    expect(de.phone).toMatch(/^\+49 \d{2,3} \d{7}$/);
    const fr = generatePersona(560, { country: 'FR', now: 1_750_000_000_000 });
    expect(fr.phone).toMatch(/^\+33 \d \d{7}$/);
  });

  it('card passes Luhn and its check digit is correct', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const persona = generatePersona(seed * 97, { now: 1_750_000_000_000 });
      expect(passesLuhn(persona.card.number)).toBe(true);
      expect(Number(persona.card.number.slice(-1))).toBe(
        luhnCheckDigit(persona.card.number.slice(0, -1))
      );
    }
  });

  it('expiry is strictly in the future relative to opts.now', () => {
    const now = 1_750_000_000_000; // stable clock
    const persona = generatePersona(31337, { now });
    const [mmStr, yyStr] = persona.card.expiry.split('/');
    const mm = Number(mmStr);
    const yy = 2000 + Number(yyStr);
    const nowDate = new Date(now);
    const curYear = nowDate.getFullYear();
    const curMonth = nowDate.getMonth() + 1;
    expect(yy > curYear || (yy === curYear && mm > curMonth)).toBe(true);
  });

  it('date of birth yields an adult age', () => {
    const now = 1_750_000_000_000;
    for (let seed = 1; seed <= 10; seed++) {
      const persona = generatePersona(seed * 131, { now });
      const birthYear = Number(persona.dateOfBirth.slice(0, 4));
      const age = new Date(now).getFullYear() - birthYear;
      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(80);
    }
  });

  it('unknown country falls back to US', () => {
    const persona = generatePersona(42, { country: 'XX', now: 1_750_000_000_000 });
    expect(persona.country).toBe('US');
    expect(persona.postcode).toMatch(/^\d{5}$/);
  });

  it('personaFieldValue resolves dotted card fields', () => {
    const persona: Persona = generatePersona(1, { now: 1_750_000_000_000 });
    expect(personaFieldValue(persona, 'card.number')).toBe(persona.card.number);
    expect(personaFieldValue(persona, 'card.expiry')).toBe(persona.card.expiry);
    expect(personaFieldValue(persona, 'card.cvv')).toBe(persona.card.cvv);
    expect(personaFieldValue(persona, 'givenName')).toBe(persona.givenName);
    expect(personaFieldValue(persona, 'nope')).toBeUndefined();
    expect(PERSONA_FIELDS.length).toBeGreaterThan(10);
  });
});

describe('Form filling via Motion input path', () => {
  it('fill path never assigns element.value — it uses Input.dispatchKeyEvent frames only', () => {
    // The compiled fill node and the executor must NOT contain any value assignment.
    const flow: FlowDocument = {
      version: 1,
      id: 'fill-flow',
      name: 'Fill Flow',
      entryNodeId: 'n-fill',
      variables: [],
      nodes: [
        {
          id: 'n-fill',
          type: 'fill_form',
          mapping: { '#email': 'email', '#name': 'fullName' },
        },
      ],
      edges: [],
    };
    const compiled = compileFlowToScript(flow);
    expect(compiled).not.toMatch(/\.value\s*=/);
    expect(compiled).toContain('app.persona.fillForm');

    const executorSource = fillForm.toString();
    expect(executorSource).not.toMatch(/\.value\s*=/);
  });

  it('fillForm dispatches real key events through a CdpHandle (no DOM event synthesis)', async () => {
    const cdp: CdpHandle = {
      send: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        return {};
      },
      close: () => {},
    };
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const persona = generatePersona(99, { now: 1_750_000_000_000 });
    const result = await fillForm(
      cdp,
      persona,
      { '#name': 'fullName', '#email': 'email' },
      99,
      { paceScale: 1 }
    );
    // focus via Runtime.evaluate + Motion typing via Input.dispatchKeyEvent
    expect(calls.some((c) => c.method === 'Runtime.evaluate')).toBe(true);
    const keyFrames = calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
    expect(keyFrames.length).toBeGreaterThan(0);
    // Every typed char is a keyDown with text — the page receives keystrokes.
    const typed = keyFrames
      .filter((f) => f.params.type === 'keyDown' && typeof f.params.text === 'string')
      .map((f) => String(f.params.text))
      .join('');
    expect(typed).toContain(persona.fullName);
    expect(typed).toContain(persona.email);
    expect(result.allFilled).toBe(true);
    expect(result.unfilled).toHaveLength(0);
  });

  it('reports unmapped fields instead of skipping them', async () => {
    const cdp: CdpHandle = {
      send: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        return {};
      },
      close: () => {},
    };
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const persona = generatePersona(100, { now: 1_750_000_000_000 });
    const result = await fillForm(cdp, persona, { '#a': 'email', '#b': 'wat' }, 100);
    expect(result.allFilled).toBe(false);
    const miss = result.unfilled.find((u) => u.selector === '#b');
    expect(miss).toBeDefined();
    expect(miss?.error).toMatch(/unmapped/);
    expect(result.filled.some((f) => f.selector === '#a')).toBe(true);
  });

  it('typing plans produced through the persona seed are deterministic', () => {
    const plan1 = planTyping('hello', 42, 1, false);
    const plan2 = planTyping('hello', 42, 1, false);
    expect(plan1).toEqual(plan2);
  });
});

describe('Flow key binding nodes', () => {
  const keyFlow = (extra?: unknown): FlowDocument => {
    const nodes: unknown[] = [
      {
        id: 'n1',
        type: 'key_read',
        key: 'api_token',
        variable: 'token',
      },
      {
        id: 'n2',
        type: 'key_write',
        key: 'api_token',
        value: 'new-value',
      },
    ];
    if (extra !== undefined && extra !== null) nodes.push(extra);
    return {
      version: 1,
      id: 'key-flow',
      name: 'Key Flow',
      entryNodeId: 'n1',
      variables: [{ name: 'local', type: 'string', defaultValue: 'local-value' }],
      nodes: nodes as FlowDocument['nodes'],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', branch: 'default' }],
    };
  };

  it('compiled output reads a global key through app.keys and assigns a local var', () => {
    const flow = keyFlow(null);
    const code = compileFlowToScript(flow);
    expect(code).toContain('app.keys.get(__keyName)');
    expect(code).toContain('"api_token"');
    expect(code).toContain('__vars["token"] = __keyValue;');
    expect(code).toContain('missing global key');
    // The read must guard both the surface and the value rather than defaulting.
    expect(code).toContain("app.keys.get unavailable");
  });

  it('compiled output writes a flow key via app.keys.set (write-back diff flushes it)', () => {
    const flow = keyFlow(null);
    const code = compileFlowToScript(flow);
    expect(code).toContain('app.keys.set(__keyName, "new-value")');
    expect(code).toContain('"api_token"');
  });

  it('missing key read throws — never substituted with empty', () => {
    const flow = keyFlow(null);
    const code = compileFlowToScript(flow);
    // The guard throws instead of defaulting to ''.
    expect(code).toContain(`throw new Error('missing global key: ' + __keyName);`);
    // No empty-string fallback anywhere in the key read path.
    expect(code).not.toContain(`__keyValue = ''`);
  });

  it('validator accepts a key_read node alongside a same-named local variable (distinct bindings)', () => {
    const flow: FlowDocument = {
      version: 1,
      id: 'flow-distinct',
      name: 'Distinct',
      entryNodeId: 'n-read',
      variables: [{ name: 'api_key', type: 'string', defaultValue: 'local' }],
      nodes: [
        { id: 'n-read', type: 'key_read', key: 'api_key', variable: 'api_key' } as never,
        { id: 'n-write', type: 'key_write', key: 'api_key', value: 'x' } as never,
      ],
      edges: [{ id: 'e1', source: 'n-read', target: 'n-write', branch: 'default' }],
    };
    const res = validateFlow(flow);
    expect(res.valid).toBe(true);
  });

  it('validator rejects an invalid key name', () => {
    const flow: FlowDocument = {
      version: 1,
      id: 'flow-badkey',
      name: 'Bad Key',
      entryNodeId: 'n1',
      variables: [],
      nodes: [{ id: 'n1', type: 'key_read', key: 'a b', variable: 'out' } as never],
      edges: [],
    };
    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === 'INVALID_KEY_NAME')).toBe(true);
  });

  it('validator rejects a fill mapping whose persona field does not exist', () => {
    const flow: FlowDocument = {
      version: 1,
      id: 'flow-badmap',
      name: 'Bad Map',
      entryNodeId: 'n1',
      variables: [],
      nodes: [{ id: 'n1', type: 'fill_form', mapping: { '#x': 'ssn' } } as never],
      edges: [],
    };
    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === 'INVALID_FILL_MAPPING')).toBe(true);
  });
});
