import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Table adaptive layout contract (R01)', () => {
  const stylesPath = path.resolve(__dirname, '../../../src/renderer/src/styles.css');
  const css = fs.readFileSync(stylesPath, 'utf-8');

  it('defines --table-actions-w token', () => {
    expect(css).toMatch(/--table-actions-w:\s*132px/);
  });

  it('configures .table-container with overflow-x: auto and without overflow: hidden', () => {
    const containerMatch = css.match(/\.table-container\s*\{([^}]+)\}/);
    expect(containerMatch).toBeTruthy();
    const containerRules = containerMatch![1];
    expect(containerRules).toMatch(/overflow-x:\s*auto/);
    expect(containerRules).not.toMatch(/overflow:\s*hidden/);
  });

  it('defines .table--wide with a min-width in px', () => {
    const wideMatch = css.match(/\.table--wide\s*\{([^}]+)\}/);
    expect(wideMatch).toBeTruthy();
    const wideRules = wideMatch![1];
    expect(wideRules).toMatch(/min-width:\s*1080px/);
  });

  it('configures .col-actions with sticky positioning', () => {
    const stickyMatch = css.match(/\.table\s+th\.col-actions,\s*\.table\s+td\.col-actions\s*\{([^}]+)\}/);
    expect(stickyMatch).toBeTruthy();
    const stickyRules = stickyMatch![1];
    expect(stickyRules).toMatch(/position:\s*sticky/);
    expect(stickyRules).toMatch(/right:\s*0/);
    expect(stickyRules).toMatch(/background:\s*var\(--bg-app\)/);
  });
});
