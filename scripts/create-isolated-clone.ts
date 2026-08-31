import * as path from 'path';
import { createIsolatedClone } from './lib/isolated-clone';

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

try {
  const source = value('--source') ?? process.cwd();
  const out = value('--out');
  if (!out) throw new Error('usage: --out <disposable-clone-path> [--source <repo-root>]');
  const manifest = createIsolatedClone(path.resolve(source), path.resolve(out));
  process.stdout.write(JSON.stringify({ status: 'pass', manifest }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'fail', error: (error as Error).message }) + '\n');
  process.exitCode = 2;
}
