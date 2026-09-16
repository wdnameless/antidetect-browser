// scripts/copy-prod-deps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(repoRoot, 'package.json');
const nodeModulesDir = path.join(repoRoot, 'node_modules');
const targetDir = path.join(repoRoot, 'dist', 'node_modules');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const prodDeps = Object.keys(pkg.dependencies || {});

fs.mkdirSync(targetDir, { recursive: true });

const visited = new Set();

function copyDep(name, sourceBase) {
  if (visited.has(name)) return;
  visited.add(name);

  let depDir = path.join(sourceBase, name);
  if (!fs.existsSync(depDir)) {
    depDir = path.join(nodeModulesDir, name);
  }
  if (!fs.existsSync(depDir)) {
    return;
  }

  const destDir = path.join(targetDir, name);
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(depDir, destDir, { recursive: true, dereference: true });

  // Read its package.json to resolve sub-dependencies
  const subPkgPath = path.join(depDir, 'package.json');
  if (fs.existsSync(subPkgPath)) {
    try {
      const subPkg = JSON.parse(fs.readFileSync(subPkgPath, 'utf8'));
      for (const subDep of Object.keys(subPkg.dependencies || {})) {
        copyDep(subDep, path.join(depDir, 'node_modules'));
      }
    } catch (_) {}
  }
}

for (const dep of prodDeps) {
  copyDep(dep, nodeModulesDir);
}

// Workspace packages are NOT in `node_modules` — npm links them, and a packaged build has no
// link. The MCP server needs `@antidetect/sdk` at runtime (`mcp/dist/mcp/src/tools.js` imports
// it), so without staging it here the MCP entry dies on start with
// `Cannot find module '@antidetect/sdk'` — which is exactly how this was found: the shipped
// portable returned `running:false` with no error surfaced to the UI.
//
// Only packages actually needed at runtime belong here. `@antidetect/sdk` is the one: it is
// built to `packages/sdk-node/dist` and declares `main: dist/index.js`.
function stageWorkspacePackage(dirName, packageName) {
  const src = path.join(repoRoot, 'packages', dirName);
  const pkgFile = path.join(src, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    throw new Error(`workspace package ${packageName} not found at ${src}`);
  }
  const sub = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const main = sub.main || 'index.js';
  if (!fs.existsSync(path.join(src, main))) {
    throw new Error(
      `${packageName} is not built (missing ${path.join(src, main)}). Run \`npm run build:sdk\` first.`,
    );
  }
  // Skip dev-only weight; the SDK ships compiled output plus its manifest.
  const dest = path.join(targetDir, ...packageName.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (p) => {
      const base = path.basename(p);
      return base !== 'node_modules' && base !== 'src' && base !== 'tests' && !base.endsWith('.ts');
    },
  });
  console.log(`[copy-prod-deps] Staged workspace package ${packageName}`);
}

stageWorkspacePackage('sdk-node', '@antidetect/sdk');

console.log(`[copy-prod-deps] Copied ${visited.size} production modules to ${targetDir}`);
