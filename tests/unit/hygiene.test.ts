// Guards the defect class this program found by hand (umbrella task 1.4):
// a declared-but-unconsumed option, and an exported-but-unimported module.
// Both were shipped defects: `StealthOptions.fontList` was declared and read by
// nobody, and `src/main/telegram/bot.ts` was fully implemented and imported by
// no file. Neither is visible to the type checker.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { buildStealthScript } from '../../src/main/proxy/stealthInjection';
import { buildRecorderListenerSource } from '../../src/main/recorder/listener';

const SRC = path.join(__dirname, '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC);

function readAll(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of FILES) map.set(f, fs.readFileSync(f, 'utf8'));
  return map;
}

const SOURCES = readAll();

/** Every module that imports something from the given file (by path suffix). */
function importersOf(relPath: string, exportsFromIt: string): number {
  const stem = relPath.replace(/\\/g, '/').replace(/\.tsx?$/, '');
  const base = path.basename(stem);
  let count = 0;
  for (const [file, text] of SOURCES) {
    if (file.replace(/\\/g, '/').endsWith(stem + '.ts')) continue;
    if (file.replace(/\\/g, '/').endsWith(stem + '.tsx')) continue;
    // import ... from './base'  |  from '../x/base'  |  require('./base')
    const re = new RegExp(`from ['"][^'"]*${base}['"]|require\\(['"][^'"]*${base}['"]\\)`);
    if (re.test(text) && new RegExp(exportsFromIt).test(text)) count++;
  }
  return count;
}

describe('hygiene: declarations must be consumed', () => {
  it('StealthOptions.fontList is read by non-declaring code', () => {
    // Regression guard for defect A2: the option was declared in StealthOptions
    // and consumed nowhere, so font pinning silently did not exist.
    const consumers: string[] = [];
    for (const [file, text] of SOURCES) {
      if (file.endsWith('stealthInjection.ts')) continue; // declares it
      if (/\bfontList\b/.test(text)) consumers.push(path.relative(SRC, file));
    }
    expect(consumers.length).toBeGreaterThan(0);
  });

  it('the telegram bot module is imported by the service', () => {
    // Regression guard for defect C5: 296 lines of bot, imported by no file.
    const importers = importersOf('src/main/telegram/bot.ts', 'telegram');
    expect(importers).toBeGreaterThan(0);
  });

  it('the email router is mounted, not merely defined', () => {
    // A route module that nothing imports is dead surface.
    const server = SOURCES.get(path.join(SRC, 'main', 'api', 'server.ts'));
    expect(server, 'server.ts must exist').toBeDefined();
    expect(server!).toMatch(/routes\/email|emailRoutes/);
  });

  it('the generated stealth script contains no TypeScript-only syntax', () => {
    // Regression guard: the script emitted by buildStealthScript is injected into a
    // browser, so a single `as any` makes the whole thing fail to parse and kills
    // every stealth hook. This is checked structurally here so the failure names
    // the construct rather than a cryptic parse error.
    const injection = SOURCES.get(path.join(SRC, 'main', 'proxy', 'stealthInjection.ts'));
    expect(injection).toBeDefined();
    const body = injection!.slice(injection!.indexOf('export function buildStealthScript'));
    const template = body.slice(body.indexOf('return `'), body.lastIndexOf('})();'));
    // Built from parts so this guard does not itself contain the token it forbids.
    const casts = [/as\s+any/, /as\s+unknown/, /:\s*(string|number|boolean|void)\s*[;,)=]/, /satisfies\s+[A-Z]/];
    const leaked = casts.filter((re) => re.test(template)).map((re) => re.source);
    expect(leaked, 'TypeScript-only syntax inside the browser-injected template').toEqual([]);
  });

  it('the generated stealth script is parseable JavaScript', () => {
    // The structural check above catches the tokens; this catches anything else
    // that makes the emitted script unparseable (e.g. an unbalanced brace), which
    // would silently kill every stealth hook in the real browser.
    const variants = [
      { mobile: false, logicalPlatform: 'windows' as const },
      { mobile: true, logicalPlatform: 'android' as const, model: 'Pixel 8' },
      { mobile: false, logicalPlatform: 'macos' as const },
    ];
    for (const opts of variants) {
      const src = buildStealthScript(opts);
      let failure: string | null = null;
      try {
        new vm.Script(src);
      } catch (err) {
        failure = `${opts.logicalPlatform} (mobile=${opts.mobile}): ${(err as Error).message}`;
      }
      expect(failure).toBeNull();
    }
  });

  it('the script-engine worker source is parseable JavaScript', () => {
    // The worker source is a template literal executed with `eval: true`. An
    // unbalanced brace in it (as happened when app.http was left unclosed, which
    // swallowed app.log) makes EVERY script and flow run fail with a cryptic
    // "Unexpected token" and no logs at all. Parse it here so the failure names
    // the file instead.
    const engine = SOURCES.get(path.join(SRC, 'main', 'scripts', 'scriptEngine.ts'));
    expect(engine, 'scriptEngine.ts must exist').toBeDefined();
    const marker = 'const WORKER_SOURCE = `';
    const start = engine!.indexOf(marker);
    expect(start, 'WORKER_SOURCE template must exist').toBeGreaterThan(-1);
    const body = engine!.slice(start + marker.length);
    const source = body.slice(0, body.indexOf('`;'));
    let failure: string | null = null;
    try {
      new vm.Script(source);
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure, 'script-engine worker source must parse as plain JS').toBeNull();
  });

  it('the sandbox exposes every surface compiled flows and scripts call', () => {
    // Guards against a compiled node calling an `app.<x>` the worker never exposes
    // (which silently became a fabricated success before).
    const engine = SOURCES.get(path.join(SRC, 'main', 'scripts', 'scriptEngine.ts'))!;
    const marker = 'const WORKER_SOURCE = `';
    const body = engine.slice(engine.indexOf(marker) + marker.length);
    const source = body.slice(0, body.indexOf('`;'));
    for (const member of ['log', 'keys', 'callModule', 'http', 'persona', 'profiles']) {
      expect(source, `worker must expose app.${member}`).toMatch(new RegExp(`\\n  ${member}:`));
    }
  });

  it('every browser-injected source builder emits parseable JavaScript', () => {
    // Any source string sent into a browser must be valid plain JS. Wave 1 shipped
    // TypeScript inside the stealth template and a stray brace inside it; wave 2
    // shipped an unbalanced brace inside the worker template. Both killed the whole
    // script silently. Check every builder that exists rather than trusting one.
    const sources: Array<[string, string]> = [['recorder listener', buildRecorderListenerSource()]];
    for (const [label, src] of sources) {
      let failure: string | null = null;
      try {
        new vm.Script(src);
      } catch (err) {
        failure = `${label}: ${(err as Error).message}`;
      }
      expect(failure).toBeNull();
    }
  });

  it('window and globalThis are modelled as one object in browser-surface tests', () => {
    // Regression guard for a harness defect: a sandbox that gives `window` and
    // `globalThis` separate objects silently swallows `globalThis.X = ...`, so a
    // hook appears missing when it is simply written to the wrong object.
    const harnesses = FILES.filter((f) => /stealth[\\/]/.test(f));
    for (const f of harnesses) {
      const text = SOURCES.get(f)!;
      if (!/vm\.createContext/.test(text)) continue;
      const rel = path.relative(SRC, f);
      const split = /globalThis:\s*\w+Obj/.test(text);
      expect(split, `${rel} gives globalThis its own object instead of aliasing the sandbox`).toBe(false);
    }
  });

  it('the stealth layer stands down on surfaces the kernel already spoofs', () => {
    // Guards a defect measured with `scripts/probe-stealth-contexts.mjs`, which launches the real
    // kernel with this module's real output and compares the main thread against a Web Worker:
    //
    //   before -> memory 8 (page) vs 16 (worker); canvas 1457566783 vs 3616719147
    //   after  -> 0/8 surfaces diverge, across every seed tried
    //
    // The cause was duplication, not a missing worker hook. The kernel already spoofed both
    // surfaces consistently in BOTH contexts, while the JavaScript layer overwrote them on the
    // main thread only (its prototypes are document-scoped, so a worker never sees them). An
    // antifraud script needs no idea which value is correct — the disagreement is the signal.
    //
    // The hook must still exist for stock binaries where the kernel covers nothing, so this
    // asserts the CONDITION rather than the absence of the code.
    const engineCovers = buildStealthScript({
      mobile: false,
      logicalPlatform: 'macos',
      hardwareConcurrency: 8,
      deviceMemory: 4,
      seed: 2023,
    });
    const legacy = buildStealthScript({
      mobile: false,
      logicalPlatform: 'macos',
      hardwareConcurrency: 8,
      deviceMemory: 4,
      seed: 2023,
      engineCovers: { canvas: true, deviceMemory: true, clientHints: true },
    });

    // Both must remain valid, runnable browser scripts.
    for (const [label, src] of [['default', engineCovers], ['engineCovers', legacy]] as const) {
      expect(() => new vm.Script(src), `${label} variant must parse`).not.toThrow();
    }

    // The deviceMemory override is conditional on the flag in both variants.
    for (const src of [engineCovers, legacy]) {
      expect(src).toMatch(/CFG\.engineCoversDeviceMemory/);
      expect(src).toMatch(/CFG\.engineCoversCanvas/);
      expect(src).toMatch(/CFG\.engineCoversClientHints/);
    }

    // And the flags actually reach the payload with the requested values, so a launcher that
    // passes engineCovers gets the stand-down and one that does not keeps the old behaviour.
    expect(legacy).toMatch(/"engineCoversCanvas":true/);
    expect(legacy).toMatch(/"engineCoversDeviceMemory":true/);
    expect(legacy).toMatch(/"engineCoversClientHints":true/);
    expect(engineCovers).toMatch(/"engineCoversCanvas":false/);
    expect(engineCovers).toMatch(/"engineCoversDeviceMemory":false/);
    expect(engineCovers).toMatch(/"engineCoversClientHints":false/);
  });
});
