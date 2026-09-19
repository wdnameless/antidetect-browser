import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkgPath = resolve(root, '../../package.json');
const pkgRaw = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(pkgRaw);
if (!pkg.version || typeof pkg.version !== 'string') {
  throw new Error(`package.json at ${pkgPath} missing a valid version string`);
}
const appVersion = pkg.version;

export default defineConfig({
  root,
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
});
