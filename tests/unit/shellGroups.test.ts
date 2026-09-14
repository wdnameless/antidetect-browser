// Guards the grouped navigation and the frameless chrome contract.
//
// Two things this catches that nothing else does:
// 1. A page that exists in the router but is missing from the navigation — which is
//    exactly how `scripts` was unreachable before this change. It rendered, but no
//    click could get there.
// 2. Window controls rendered where the Electron bridge is absent — in a
//    browser-served client those buttons would do nothing.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const APP = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'App.tsx'),
  'utf8'
);

/** The `Page` union members. */
function pageUnion(): string[] {
  const m = /type Page\s*=([^;]+);/.exec(APP);
  expect(m, 'the Page union must exist').not.toBeNull();
  return [...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
}

/** The `NAV_DESTINATIONS` entries: a top-level destination and every page it exposes.
 *  Sub-tabs are the destinations' children, so a page reachable through a sub-tab must
 *  count as reachable — that is the whole point of this guard. */
function navEntries(): Array<{ key: string; tabs: string[] }> {
  const start = APP.indexOf('const NAV_DESTINATIONS');
  const end = APP.indexOf('\n];', start);
  // Keep the terminator inside the slice: a lookahead for the end of the array cannot
  // match text that was cut off, which silently dropped the LAST destination.
  const block = APP.slice(start, end + 3);
  // A top-level entry is a `key:` indented by exactly four spaces; sub-tab keys sit
  // deeper, so this splits destinations apart without guessing at brace nesting.
  const split = block.split(/\n  \{\n    key:/);
  const out: Array<{ key: string; tabs: string[] }> = [];
  for (const chunk of split.slice(1)) {
    const key = /^\s*'([a-z]+)'/.exec(chunk);
    if (!key) continue;
    const tabs = [...chunk.matchAll(/key:\s*'([a-z]+)'\s*,\s*label:/g)].map((x) => x[1]);
    out.push({ key: key[1], tabs });
  }
  return out;
}

/** Every page a destination exposes: itself plus its sub-tabs. */
function reachablePages(): string[] {
  const out = new Set<string>();
  for (const e of navEntries()) {
    out.add(e.key);
    for (const t of e.tabs) out.add(t);
  }
  return [...out];
}

/** Every page the content switch actually renders. */
function renderedPages(): string[] {
  return [...APP.matchAll(/page === '([a-z]+)'/g)].map((m) => m[1]);
}

describe('navigation is compact and complete', () => {
  it('every top-level destination appears exactly once', () => {
    const keys = navEntries().map((e) => e.key);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(duplicates, 'a destination must appear exactly once').toEqual([]);
  });

  it('there are exactly seven top-level destinations', () => {
    // The user asked for a short menu («удобные меню»); seven is the agreed shape.
    expect(navEntries().length).toBe(7);
  });

  it('every page in the union is reachable by clicking', () => {
    // This is the `scripts` regression: present in the union, rendered, but absent
    // from the navigation — so the page existed and no click could reach it. After the
    // regroup a page is reachable either as a destination OR as one of its sub-tabs,
    // so the guard checks the union of both.
    const reachable = new Set(reachablePages());
    const unreachable = pageUnion().filter((p) => !reachable.has(p));
    expect(unreachable, 'every page must be reachable from the navigation').toEqual([]);
  });

  it('renders every page it advertises', () => {
    const rendered = new Set(renderedPages());
    // `settings` is the final else branch, so it has no `page === '...'` test.
    const unrendered = reachablePages().filter((k) => !rendered.has(k) && k !== 'settings');
    expect(unrendered, 'a reachable page must have something to render').toEqual([]);
    // Whatever the last branch is, it must actually mount a component.
    expect(APP).toMatch(/<Settings\s*\/>/);
  });

  it('renders sub-tabs for destinations that have them', () => {
    // Without this the regroup would silently drop pages: seven sidebar entries could
    // exist while their children became unreachable.
    expect(APP).toMatch(/className="subtabs"/);
    const withTabs = navEntries().filter((e) => e.tabs.length > 0);
    expect(withTabs.length, 'at least one destination must expose sub-tabs').toBeGreaterThan(0);
  });
});

describe('window chrome belongs to the app', () => {
  it('the renderer detects the Electron bridge instead of assuming it', () => {
    // In a browser-served client the bridge is absent; controls that render anyway
    // would be dead buttons.
    expect(APP).toMatch(/window\?\.\s*antidetect\?\.\s*window|window\.antidetect\?\.window/);
  });

  it('no page-level duplicate title is rendered by the shell', () => {
    // The shell used to render <h1 class="page-title"> while some pages rendered
    // their own <h2>, so those pages showed two titles.
    const pageTitleH1 = /<h1[^>]*className="page-title"/.test(APP);
    expect(pageTitleH1, 'the shell must not render its own page title').toBe(false);
  });
});

describe('branding and framing survive', () => {
  it('the product name comes from the brand module, not a literal', () => {
    expect(APP).toMatch(/from '\.\/brand'/);
    expect(APP).not.toMatch(/['"`]Antidetect['"`]/);
  });
});
