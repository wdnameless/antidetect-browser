// Build the Windows single-file portable artefact for the Tauri shell.
//
// Why this exists rather than a plain `tauri build`: Tauri's Windows bundler only emits
// *installers* (`nsis`/`msi`). The operator-facing requirement is a single file that
// installs nothing and can be moved between machines, so the shell is wrapped in a
// self-extracting NSIS launcher built from our own template (`src-tauri/windows/portable.nsi`).
//
// Three things this script deliberately does NOT do, because each one was a defect in an
// earlier attempt at it:
//   1. It does not pack the whole `dist/` recursively. `dist/node_modules` alone is ~86 MB
//      and ~4200 files; a recursive `File /r` over it produced a 218 MB artefact and made
//      solid compression hang for many minutes. Files are enumerated and emitted per
//      directory instead.
//   2. It does not read the version from the root `package.json`. The desktop artefact's
//      version is the Tauri one (`src-tauri/tauri.conf.json`); taking it from the wrong file
//      produced an artefact named 0.4.0 while the app reported 0.1.0.
//   3. It does not rely on `process.cwd()` anywhere. The app must be buildable from any
//      working directory, so every path is derived from this file's own location.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const tauriConf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const version = tauriConf.version;
if (!version) throw new Error('src-tauri/tauri.conf.json has no version');

/** NSIS string literals need backslashes doubled. */
const nsisPath = (p) => p.replace(/\\/g, '\\\\');

function findMakensis() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(local, 'tauri', 'NSIS', 'makensis.exe'),
    path.join(local, 'electron-builder', 'Cache', 'nsis-3.0.4.1', 'nsis-3.0.4.1-1mx3n', 'Bin', 'makensis.exe'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (found) return found;
  // Last resort: PATH. Probed rather than assumed, because a missing compiler must fail loudly.
  const probe = spawnSync('makensis', ['/VERSION'], { stdio: 'ignore' });
  if (probe.status === 0) return 'makensis';
  throw new Error(`makensis not found. Looked in:\n  ${candidates.join('\n  ')}\n  and on PATH.`);
}

// --- Inputs -----------------------------------------------------------------
const shellExe = path.join(ROOT, 'src-tauri', 'target', 'release', 'nulltrace-tauri-shell.exe');
// The vendored runtime uses the target-triple name Tauri's externalBin convention requires.
const nodeExe = path.join(ROOT, 'src-tauri', 'binaries', 'node-x86_64-pc-windows-msvc.exe');
const distDir = path.join(ROOT, 'dist');
const mcpDistDir = path.join(ROOT, 'mcp', 'dist');
const keyringPath = path.join(ROOT, 'resources', 'release-keyring.json');
// The launcher's own icon. Tauri's bundler applies `bundle.icon` to the shell and the
// installers it generates, but this portable launcher is compiled by our own NSIS template —
// nothing else was putting the mark on it, so it shipped with the NSIS default.
const iconPath = path.join(ROOT, 'src-tauri', 'icons', 'icon.ico');

for (const [label, p] of [
  ['shell executable', shellExe],
  ['vendored node runtime', nodeExe],
  ['dist/ (backend + renderer)', distDir],
  ['mcp/dist (MCP server)', mcpDistDir],
  ['release keyring', keyringPath],
  ['launcher icon', iconPath],
]) {
  if (!fs.existsSync(p)) {
    throw new Error(
      `${label} is missing at ${p}. Run \`npm run build\` and \`npm run build:mcp\`, then ` +
        '`npm run copy:prod-deps && npm run vendor:node` before packaging.',
    );
  }
}

const bundleDir = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
fs.mkdirSync(bundleDir, { recursive: true });
const outFile = path.join(bundleDir, `NullTrace-${version}-portable-win-x64.exe`);

// --- Payload ------------------------------------------------------------------
// Each list is { abs, rel } where `rel` is relative to that list's destination root.

/** Recursively list files, skipping TypeScript build maps (they double the size for nothing). */
function collectFiles(dir, relDir = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.map')) continue;
    const abs = path.join(dir, entry.name);
    const rel = relDir ? `${relDir}\\${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...collectFiles(abs, rel));
    else if (entry.isFile()) out.push({ abs, rel });
  }
  return out;
}

// `dist/electron` is the build of the runtime this artefact exists to replace — it must not
// travel. `node_modules` is handled separately below so it lands under `dist/node_modules`.
const EXCLUDED_DIST_ENTRIES = new Set(['node_modules', 'electron']);
const distFiles = [];
function collectDist(dir, relDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!relDir && EXCLUDED_DIST_ENTRIES.has(entry.name)) continue;
    if (entry.name.endsWith('.map')) continue;
    const abs = path.join(dir, entry.name);
    const rel = relDir ? `${relDir}\\${entry.name}` : entry.name;
    if (entry.isDirectory()) collectDist(abs, rel);
    else if (entry.isFile()) distFiles.push({ abs, rel });
  }
}
collectDist(distDir, '');

const distNodeModules = path.join(distDir, 'node_modules');
const depFiles = fs.existsSync(distNodeModules) ? collectFiles(distNodeModules) : [];

// The MCP server is a separate entry point the app spawns on demand. Without it in the
// payload, "Enable MCP" fails in every packaged build with "entry not found" — the exact
// defect this inclusion fixes. Its layout nests as `mcp/dist/mcp/src/index.js`.
const mcpFiles = collectFiles(mcpDistDir);

// --- Template rendering --------------------------------------------------------
const template = fs.readFileSync(path.join(ROOT, 'src-tauri', 'windows', 'portable.nsi'), 'utf8');

// Each render collapses ONE `{{#each}}` block in the string handed in, so the calls must be
// chained against the running value — rebuilding from `template` each time would discard the
// earlier substitutions.
const renderEach = (source, blockName, items, render) => {
  const block = new RegExp(`\\{\\{#each ${blockName}\\}\\}([\\s\\S]*?)\\{\\{/each\\}\\}`);
  if (!block.test(source)) throw new Error(`template has no {{#each ${blockName}}} block`);
  return source.replace(block, items.map(render).join('\n'));
};

// NSIS cannot be handed a path in `/oname`: it strips the separators (producing
// `distmcpsrctoolManifest.js` at the extraction root), and backslashes there are parsed as
// escapes (`\s`, `\a`). The canonical idiom is to point `SetOutPath` at each destination
// directory and then write plain file names, which is what this does.
const renderFileTree = (files, destPrefix) => {
  const byDir = new Map();
  for (const f of files) {
    const slash = f.rel.lastIndexOf('\\');
    const dir = slash === -1 ? '' : f.rel.slice(0, slash);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push({ abs: f.abs, name: slash === -1 ? f.rel : f.rel.slice(slash + 1) });
  }
  const out = [];
  for (const dir of [...byDir.keys()].sort()) {
    const target = dir ? `${destPrefix}\\${dir}` : destPrefix;
    out.push(`  CreateDirectory "$LOCALAPPDATA\\NullTrace\\portable\\\${VERSION}\\${target}"`);
    out.push(`  SetOutPath "$LOCALAPPDATA\\NullTrace\\portable\\\${VERSION}\\${target}"`);
    for (const f of byDir.get(dir).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`  File "/oname=${f.name}" "${nsisPath(f.abs)}"`);
    }
  }
  return out.join('\n');
};

let nsi = template
  .replace(/\{\{version\}\}/g, version)
  .replace(/\{\{main_binary_name\}\}/g, 'nulltrace-tauri-shell')
  .replace(/\{\{main_binary_path\}\}/g, nsisPath(shellExe))
  .replace(/\{\{node_binary_path\}\}/g, nsisPath(nodeExe))
  .replace(/\{\{keyring_path\}\}/g, nsisPath(keyringPath))
  .replace(/\{\{icon_path\}\}/g, nsisPath(iconPath))
  .replace(/\{\{out_file\}\}/g, nsisPath(outFile));

nsi = renderEach(nsi, 'dist_files', [1], () => renderFileTree(distFiles, 'dist'));
nsi = renderEach(nsi, 'mcp_files', [1], () => renderFileTree(mcpFiles, 'mcp\\dist'));
nsi = renderEach(nsi, 'dist_node_modules', [1], () => renderFileTree(depFiles, 'dist\\node_modules'));

// A leftover placeholder means the template and this script have drifted apart. NSIS would
// happily compile a literal `{{foo}}` into the script, so fail here instead.
if (/\{\{[^}]+\}\}/.test(nsi)) {
  const leftover = nsi.match(/\{\{[^}]+\}\}/g);
  throw new Error(`unsubstituted template placeholders: ${[...new Set(leftover)].join(', ')}`);
}

const generatedNsi = path.join(ROOT, 'src-tauri', 'target', 'release', 'portable-generated.nsi');
fs.writeFileSync(generatedNsi, nsi, 'utf8');

const makensis = findMakensis();
console.log(`[build-portable] version ${version} (from src-tauri/tauri.conf.json)`);
console.log(
  `[build-portable] payload: ${distFiles.length} app files, ${mcpFiles.length} MCP files, ${depFiles.length} dependency files`,
);
console.log(`[build-portable] compiling with ${makensis}`);

// A generous but finite bound: an earlier attempt hung because a solid-compression pass over
// the whole tree never finished, and nothing here should ever take this long.
const compile = spawnSync(makensis, ['/V2', generatedNsi], {
  stdio: 'inherit',
  timeout: 15 * 60 * 1000,
});

if (compile.error) throw new Error(`makensis failed to run: ${compile.error.message}`);
if (compile.status !== 0) throw new Error(`makensis exited with status ${compile.status}`);

const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(1);
console.log(`[build-portable] built ${path.basename(outFile)} (${sizeMb} MB)`);
