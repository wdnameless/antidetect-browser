// Form filling through the Motion input path (parity program: form-filling-helper).
//
// Filling NEVER assigns `element.value` and never synthesises DOM events: values
// reach the page as real `Input.dispatchKeyEvent` CDP frames produced by the
// Motion typing plan (`deriveMotorSeed` -> `planTyping` with per-key delays),
// the same path `POST /api/v1/motion/:profileId/enterText` uses. A field is
// either filled through Motion or reported as unfilled — never silently skipped.
//
// Field-to-persona mapping is caller-driven: an explicit mapping object of
// `selector -> persona field` (dotted names like 'givenName' or 'card.number').
// There is no label-text guessing. A requested selector whose persona field the
// persona cannot supply lands in `unfilled` with a reason.
import { connectProfileCdp, CdpHandle } from './cdpClient';
import { deriveMotorSeed } from './seeds';
import { planTyping } from './typing';
import { Persona, personaFieldValue } from './persona';

export interface FillFieldResult {
  selector: string;
  field?: string;
  filled: boolean;
  error?: string;
}

export interface FillFormResult {
  filled: FillFieldResult[];
  /** Selectors the caller requested that were NOT filled, with the reason. */
  unfilled: FillFieldResult[];
  allFilled: boolean;
}

export interface FillFormOptions {
  /** Motion pace scale; defaults to 1. */
  paceScale?: number;
}

/** Dispatch one typing plan to the focused element as real key events. */
async function typePlan(cdp: CdpHandle, seed: number, value: string, paceScale: number): Promise<void> {
  const plan = planTyping(value, deriveMotorSeed(seed), paceScale, false);
  for (const keyAction of plan.keys) {
    const isBackspace = keyAction.key === 'Backspace';
    const type = keyAction.type === 'down' ? 'keyDown' : 'keyUp';
    const frame: Record<string, unknown> = {
      type,
      key: keyAction.key,
      code: isBackspace ? 'Backspace' : `Key${keyAction.key.toUpperCase()}`,
      windowsVirtualKeyCode: isBackspace ? 8 : keyAction.key.toUpperCase().charCodeAt(0),
    };
    if (!isBackspace && keyAction.type === 'down') {
      frame.text = keyAction.key;
    }
    await cdp.send('Input.dispatchKeyEvent', frame);
  }
}

/** Focus a selector in the page (real DOM focus — keystrokes land where they should). */
async function focusSelector(cdp: CdpHandle, selector: string): Promise<void> {
  await cdp.send(
    'Runtime.evaluate',
    {
      expression:
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); ` +
        `if (!el) throw new Error('selector not found: ' + ${JSON.stringify(selector)}); ` +
        `if (typeof el.focus !== 'function') throw new Error('not focusable: ' + ${JSON.stringify(selector)}); ` +
        `el.focus(); return true; })()`,
      returnByValue: true,
      awaitPromise: true,
    },
    true
  );
}

/**
 * Fill a whole form through the Motion input path. For each
 * `selector -> persona field` mapping entry the element is focused and the
 * persona value typed as real keystrokes. Every requested selector is answered
 * in the result — nothing is silently skipped.
 */
export async function fillForm(
  cdp: CdpHandle,
  persona: Persona,
  mapping: Record<string, string>,
  profileSeed: number,
  opts: FillFormOptions = {}
): Promise<FillFormResult> {
  const paceScale = opts.paceScale ?? 1;
  const results: FillFieldResult[] = [];
  for (const [selector, field] of Object.entries(mapping)) {
    const value = personaFieldValue(persona, field);
    if (value === undefined) {
      results.push({
        selector,
        field,
        filled: false,
        error: `unmapped: persona has no field '${field}'`,
      });
      continue;
    }
    try {
      await focusSelector(cdp, selector);
      await typePlan(cdp, profileSeed, value, paceScale);
      results.push({ selector, field, filled: true });
    } catch (err) {
      results.push({
        selector,
        field,
        filled: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const unfilled = results.filter((r) => !r.filled);
  return { filled: results.filter((r) => r.filled), unfilled, allFilled: unfilled.length === 0 };
}

/**
 * Convenience executor: connects to the running profile's CDP endpoint, fills
 * the form via `fillForm`, then closes the connection.
 */
export async function fillFormOnProfile(
  profileId: string,
  persona: Persona,
  mapping: Record<string, string>,
  profileSeed: number,
  opts: FillFormOptions = {}
): Promise<FillFormResult> {
  const cdp = await connectProfileCdp(profileId);
  try {
    return await fillForm(cdp, persona, mapping, profileSeed, opts);
  } finally {
    cdp.close();
  }
}
