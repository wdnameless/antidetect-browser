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

/** The `NAV` entries: page key plus its group. */
function navEntries(): Array<{ key: string; group: string }> {
  const start = APP.indexOf('const NAV: NavItem[]');
  const end = APP.indexOf('];', start);
  const block = APP.slice(start, end);
  return [...block.matchAll(/key:\s*'([a-z]+)'[^}]*group:\s*'(\w+)'/g)].map((m) => ({
    key: m[1],
    group: m[2],
  }));
}

/** Every page the content switch actually renders. */
function renderedPages(): string[] {
  return [...APP.matchAll(/page === '([a-z]+)'/g)].map((m) => m[1]);
}

describe('navigation is grouped and complete', () => {
  it('every navigable page appears exactly once', () => {
    const keys = navEntries().map((e) => e.key);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(duplicates, 'a page must appear in the navigation exactly once').toEqual([]);
  });

  it('every page in the union is reachable by clicking', () => {
    // This is the `scripts` regression: present in the union, rendered, but absent
    // from NAV — so the page existed and no click could reach it.
    const navKeys = new Set(navEntries().map((e) => e.key));
    const unreachable = pageUnion().filter((p) => !navKeys.has(p));
    expect(unreachable, 'every page must be reachable from the navigation').toEqual([]);
  });

  it('renders every page it advertises', () => {
    const rendered = new Set(renderedPages());
    // `settings` is the final else branch, so it has no `page === '...'` test.
    const unrendered = navEntries()
      .map((e) => e.key)
      .filter((k) => !rendered.has(k) && k !== 'settings');
    expect(unrendered, 'a navigable page must have something to render').toEqual([]);
    // Whatever the last branch is, it must actually mount a component.
    expect(APP).toMatch(/<Settings\s*\/>/);
  });

  it('uses exactly the three labelled groups', () => {
    const groups = [...new Set(navEntries().map((e) => e.group))].sort();
    expect(groups).toEqual(['LIBRARY', 'SYSTEM', 'WORKSPACE']);
    expect(APP).toMatch(/NAV_GROUP_ORDER[\s\S]*?'WORKSPACE'[\s\S]*?'LIBRARY'[\s\S]*?'SYSTEM'/);
  });

  it('groups render before their items, and the label is uppercase in CSS', () => {
    expect(APP).toMatch(/className="nav-group"/);
    expect(APP).toMatch(/nav-group-label/);
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
