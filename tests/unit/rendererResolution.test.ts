// Guards the renderer lookup that a packaged build uses to serve the UI.
//
// THE BUG THIS PREVENTS
// The service compiles to <root>/dist/src/main/api/server.js, so `__dirname` sits one
// level deeper than the old hand-written candidate list assumed:
//
//   path.resolve(__dirname, '../../../dist/renderer') -> <root>/dist/dist/renderer
//   path.resolve(__dirname, '../../dist/renderer')    -> <root>/dist/src/dist/renderer
//   path.resolve(__dirname, '../renderer')            -> <root>/dist/src/main/renderer
//
// None of those exist. In a packaged app index.html therefore was never found, the SPA
// fallback did not run, and every non-API route answered 401 instead of serving the UI.
//
// The test builds the real directory layout on disk and asserts the resolver finds it,
// so a future edit to the traversal depth fails here instead of in a shipped .exe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveRendererDir } from '../../src/main/api/server';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-renderer-'));
  // Mirrors the packaged layout: dist/renderer plus the compiled service nesting.
  fs.mkdirSync(path.join(root, 'dist', 'renderer', 'assets'), { recursive: true });
  // Must look like real Vite output: the resolver requires a ./assets/ reference so the
  // dev template (which points at /src/main.tsx) cannot be mistaken for a built bundle.
  fs.writeFileSync(
    path.join(root, 'dist', 'renderer', 'index.html'),
    '<script type="module" src="./assets/index-abc.js"></script>',
  );
  fs.mkdirSync(path.join(root, 'dist', 'src', 'main', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'src', 'main', 'api', 'server.js'), '// stub');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveRendererDir finds the UI in a packaged layout', () => {
  it('locates index.html from the compiled service directory', () => {
    const fromDir = path.join(root, 'dist', 'src', 'main', 'api');
    const found = resolveRendererDir(fromDir);
    expect(fs.existsSync(path.join(found, 'index.html'))).toBe(true);
    expect(found).toBe(path.join(root, 'dist', 'renderer'));
  });

  it('ignores directories that exist but contain no index.html', () => {
    // A directory merely named "renderer" is not the renderer; only index.html proves
    // it. The old code checked existence only, which is how it settled on a wrong path.
    const decoy = path.join(root, 'dist', 'src', 'main', 'api', 'renderer');
    fs.mkdirSync(decoy, { recursive: true });
    const fromDir = path.join(root, 'dist', 'src', 'main', 'api');
    expect(resolveRendererDir(fromDir)).toBe(path.join(root, 'dist', 'renderer'));
  });
});

describe('the Vite dev template is not mistaken for built output', () => {
  it('ignores an index.html that points at /src/main.tsx', () => {
    // src/renderer/index.html is the Vite dev template. It contains an index.html and so
    // passed an existence-only check, but it references /src/main.tsx — a module the
    // packaged service cannot serve, which yielded a BLANK PAGE instead of the app.
    const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-dev-'));
    const devDir = path.join(devRoot, 'src', 'renderer');
    fs.mkdirSync(devDir, { recursive: true });
    fs.writeFileSync(path.join(devDir, 'index.html'), '<script type="module" src="/src/main.tsx"></script>');

    const builtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-built-'));
    const builtDir = path.join(builtRoot, 'dist', 'renderer');
    fs.mkdirSync(path.join(builtDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(builtDir, 'index.html'),
      '<script type="module" crossorigin src="./assets/index-abc.js"></script>',
    );
    const fromDir = path.join(builtRoot, 'dist', 'src', 'main', 'api');
    fs.mkdirSync(fromDir, { recursive: true });

    expect(resolveRendererDir(fromDir)).toBe(builtDir);

    fs.rmSync(devRoot, { recursive: true, force: true });
    fs.rmSync(builtRoot, { recursive: true, force: true });
  });
});
