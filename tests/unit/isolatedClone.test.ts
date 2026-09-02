import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertClonePath, createIsolatedClone } from '../../scripts/lib/isolated-clone';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function fixture(): { source: string; out: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-clone-test-'));
  roots.push(base);
  const source = path.join(base, 'production');
  const out = path.join(base, 'clone');
  for (const dir of ['dist', 'data/profiles/p1', 'data/chromium/camoufox/extracted']) fs.mkdirSync(path.join(source, dir), { recursive: true });
  fs.writeFileSync(path.join(source, 'dist', 'main.js'), 'build');
  fs.writeFileSync(path.join(source, 'data', 'antidetect.db'), 'db');
  fs.writeFileSync(path.join(source, 'data', 'profiles', 'p1', 'state'), 'profile');
  fs.writeFileSync(path.join(source, 'data', 'chromium', 'camoufox', 'extracted', 'camoufox.exe'), 'exe');
  return { source, out };
}

describe('pre-denial isolated clone', () => {
  it('copies build, DB, profiles, and executable while proving production unchanged', () => {
    const { source, out } = fixture();
    const manifest = createIsolatedClone(source, out);
    expect(manifest.productionUnchanged).toBe(true);
    expect(manifest.fixtureCanaryCloneOnly).toBe(true);
    expect(manifest.sourceBeforeSha256).toBe(manifest.sourceAfterSha256);
    expect(fs.readFileSync(path.join(out, 'data/antidetect.db'), 'utf8')).toBe('db');
    expect(fs.existsSync(path.join(source, 'data/.fixture-write-canary'))).toBe(false);
  });

  it('fails closed for in-tree destinations and fixture path escapes', () => {
    const { source } = fixture();
    expect(() => createIsolatedClone(source, path.join(source, 'clone'))).toThrow(/outside/);
    expect(() => assertClonePath(source, path.join(source, '..', 'production-adjacent'))).toThrow(/escapes/);
  });

  it('removes partial clones when required inputs are absent', () => {
    const { source, out } = fixture();
    fs.rmSync(path.join(source, 'data/antidetect.db'));
    expect(() => createIsolatedClone(source, out)).toThrow(/missing/);
    expect(fs.existsSync(out)).toBe(false);
  });
});
