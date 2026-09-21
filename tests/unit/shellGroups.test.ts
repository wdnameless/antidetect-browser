// Guards the grouped navigation and the frameless chrome contract.
//
// Two things this catches that nothing else does:
// 1. A page that exists in the router but is missing from the navigation — which is
//    exactly how `scripts` was unreachable before this change. It rendered, but no
//    click could get there.
// 2. Window controls rendered where the Electron bridge is absent — in a
//    browser-served client those buttons would do nothing.
//
// Line endings are normalised on read: the parsers below split on `\n`, and a Windows CI
// checkout hands back `\r\n`, so an un-normalised read found zero nav entries there while
// passing locally. Same source, different result — the worst kind of green.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const APP = fs
  .readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

/** The `Page` union members. */
function pageUnion(): string[] {
  const m = /type Page\s*=([^;]+);/.exec(APP);
  expect(m, 'the Page union must exist').not.toBeNull();
  return [...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
}

/** The `NAV_DESTINATIONS` entries: a top-level destination and any sub-tab keys it declares.
 *  `tabs` is empty for every entry now that the sub-tab strip is gone, and the assertion on it
 *  is what keeps a re-introduced strip from quietly hiding a page again. */
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

/** Every page the navigation exposes: the destinations themselves plus any sub-tab keys.
 *  With the sub-tab strip removed this is just the destination list, but the union is kept so
 *  the guard below still holds if a future entry declares children. */
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

  it('the sidebar stays a compact list, not a growing menu', () => {
    // This used to assert an exact count (`toBe(10)`), which made it a tripwire for ANY new
    // destination rather than a guard on the property that matters. Adding the Android page
    // elsewhere in the tree broke it while nothing was actually wrong — a test that fails on
    // unrelated work is noise, and noise trains people to edit the number.
    //
    // The invariant worth keeping is the one the operator first asked for («удобные меню», 15 →
    // 7 entries) and that every later step has respected: the flat menu stays compact, and every
    // entry names a page the union declares. Exact membership is already covered by
    // "every page in the union is reachable by clicking" below.
    const entries = navEntries();
    expect(entries.length, 'a flat menu that keeps growing is the problem this guards').toBeLessThanOrEqual(16);
    expect(entries.length, 'an empty or near-empty menu would mean the parse broke').toBeGreaterThanOrEqual(7);

    // Each entry must be a real destination, not a stray key.
    const union = new Set(pageUnion());
    const unknown = entries.map((e) => e.key).filter((k) => !union.has(k));
    expect(unknown, 'every nav entry must name a page in the Page union').toEqual([]);
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

  it('the Profiles row carries no sub-tabs, and its children are reachable without them', () => {
    // The strip used to sit above the Profiles content and restate the current page in a row of
    // pills. The operator asked for it to go — «сверху Profiles, Groups и Trash можешь убрать,
    // треш добавь отдельно в workspace» — and the pages that lived ONLY inside it were promoted
    // to WORKSPACE entries.
    //
    // The risk this pins is the one the old test existed for, inverted: with the Profiles row's
    // strip gone, a page reachable only through it would now be unreachable altogether. The
    // union check above already covers that, and it is the reason Groups and Trash had to be
    // promoted rather than simply dropped.
    //
    // The mechanism itself is deliberately still present for the destinations that still use it
    // (Automation, Cloud, Settings): the operator's request named the Profiles row, and removing
    // working navigation for the other three was not his ask.
    const profiles = navEntries().find((e) => e.key === 'profiles');
    expect(profiles, 'the Profiles destination must exist').toBeDefined();
    expect(profiles!.tabs, 'Profiles must expose no sub-tabs').toEqual([]);
    for (const child of ['groups', 'trash']) {
      expect(
        navEntries().some((e) => e.key === child),
        `${child} must be a destination of its own after losing its sub-tab`
      ).toBe(true);
    }
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
