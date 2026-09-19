// An imported component must be rendered, or the control it provides simply disappears.
//
// This is not hypothetical. The commit that removed the sidebar collapse deleted
// `<AutomationPanel />` along with the `{!sidebarCollapsed && ...}` guard around it, and left
// the import behind. Nothing failed: TypeScript accepts an unused import, the bundle builds,
// and no test rendered the sidebar. The app lost the only control that starts the MCP server,
// which the operator experienced as «МСП не включается» — with no button left to press.
//
// The general rule worth enforcing: for every component `App.tsx` imports from `components/`,
// there must be a JSX usage of it. A component that is imported and never used is dead code at
// best and a missing feature at worst, and the two are indistinguishable from the outside.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const APP_TSX = path.resolve(__dirname, '../../src/renderer/src/App.tsx');

/** Component names App.tsx imports from `./components/...`. */
function importedComponents(source: string): string[] {
  const names: string[] = [];
  const importBlock = /import\s*\{([^}]+)\}\s*from\s*'\.\/components\/[^']+';/g;
  for (const match of source.matchAll(importBlock)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && /^[A-Z]/.test(name)) names.push(name);
    }
  }
  return names;
}

/** Whether a component is rendered somewhere in the file. */
function isRendered(source: string, name: string): boolean {
  return new RegExp(`<${name}[\\s/>]`).test(source);
}

describe('every component App.tsx imports is actually rendered', () => {
  const source = fs.readFileSync(APP_TSX, 'utf8');

  it('imports at least one component, so this guard is really inspecting something', () => {
    expect(importedComponents(source).length).toBeGreaterThan(0);
  });

  it('renders every imported component', () => {
    const unrendered = importedComponents(source).filter((name) => !isRendered(source, name));
    expect(
      unrendered,
      `imported but never rendered in App.tsx: ${unrendered.join(', ')}. ` +
        'A component in that state contributes nothing, and if it carried a control, the ' +
        'control is gone from the UI.'
    ).toEqual([]);
  });

  it('keeps the Automation API panel mounted', () => {
    // Named explicitly because its disappearance is the failure that shipped: the panel holds
    // the MCP badge and the start/stop control, so detaching it removes the feature.
    expect(source).toMatch(/<AutomationPanel\s*\/>/);
  });
});
