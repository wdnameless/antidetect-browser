// Package the macOS app bundle into the portable layout the operator asked for.
//
// The form is a FOLDER, not a file, because macOS does not allow a single-file application: a
// `.app` is a directory, and it cannot be extracted from an archive at launch the way the Windows
// NSIS launcher does. So "portable" here means: an archive the operator unpacks anywhere, holding
// `NullTrace.app` and the empty `data/` that will belong to it.
//
// Why `data/` is created in the archive rather than left to the app: the shell derives the portable
// root from the bundle's own position (`portable_root_from_bundle`) and puts everything beside it.
// Shipping the folder makes the layout self-describing — the operator sees where their profiles
// will go before the first launch, instead of discovering a directory that appeared next to the app.
//
// Nothing is written INTO the .app: that would invalidate its signature and macOS would refuse to
// launch a modified bundle.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const bundleDir = arg('--app', path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'macos'));
const outDir = arg('--out', path.join(ROOT, 'dist-release'));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;

if (process.platform !== 'darwin') {
  throw new Error(`macOS packaging must run on macOS (this is ${process.platform}): the .app must be signed there`);
}
if (!fs.existsSync(bundleDir)) {
  throw new Error(`bundle directory not found: ${bundleDir}`);
}

const appName = fs.readdirSync(bundleDir).find((e) => e.endsWith('.app'));
if (!appName) throw new Error(`no .app inside ${bundleDir}`);
const appPath = path.join(bundleDir, appName);

// Stage the layout, then archive the stage — so the archive contains one top-level folder the
// operator can drag anywhere rather than scattering an .app into their Downloads directory.
//
// The folder is named after the PRODUCT, not after this script: `--keepParent` puts this exact
// name at the archive root, and the first build shipped `portable-stage-0.6.20` — an internal
// build-script identifier — to the operator. Measured on the produced artefact before fixing.
const stageName = `NullTrace-${version}-macos-arm64`;
const stage = path.join(ROOT, 'src-tauri', 'target', 'release', stageName);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr?.trim() || r.status}`);
  return r;
};

// `-R` preserves the bundle's symlinks and its signature-relevant metadata. `cp -a` would do the
// same; either way a plain recursive copy is wrong here.
run('cp', ['-R', appPath, path.join(stage, appName)]);

// The data folder travels empty and marked. `markDataRoot` writes the same marker at runtime, and
// having it present means the very first launch already recognises the folder as its own on a
// machine where the recorded path inside a copied settings.json would otherwise look foreign.
const dataDir = path.join(stage, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, '.nulltrace-data-root'), 'nulltrace\n', 'utf8');

// A note the operator will actually read: what to do about Gatekeeper, and where their data goes.
fs.writeFileSync(
  path.join(stage, 'README-FIRST.txt'),
  [
    'NullTrace — portable for macOS (Apple Silicon)',
    '',
    `Version ${version}`,
    '',
    'HOW TO OPEN',
    '  Run it from THIS folder — that is the portable layout, and your profiles stay inside it.',
    `  Dragging ${appName} to /Applications also works, but then it is an ordinary installation:`,
    '  macOS does not allow an app to keep its data in /Applications, so profiles would live in',
    '  ~/Library/Application Support instead and would not travel with this folder.',
    '  1. macOS will refuse the first launch because the app is ad-hoc signed, not notarized.',
    '     Clear the quarantine attribute once:',
    '',
    `       xattr -dr com.apple.quarantine "${appName}"`,
    '',
    'WHERE YOUR DATA LIVES',
    '  In the "data" folder NEXT TO the app — profiles, the browser kernel, extensions and the',
    '  database all stay inside this folder, so moving the folder moves everything. Nothing is',
    '  written into the application itself (that would break its signature).',
    '',
    'REQUIREMENTS',
    '  - Apple Silicon (M1 or newer). The x86_64 kernel image also exists upstream, but this',
    '    artefact is built and tested for arm64 only.',
    '  - The browser kernel (~134 MB) downloads on first use from the project\'s pinned upstream',
    '    release and is verified by SHA-256 before it can run.',
    '',
  ].join('\n'),
  'utf8'
);

fs.mkdirSync(outDir, { recursive: true });
const archive = path.join(outDir, `NullTrace-${version}-macos-arm64.zip`);
fs.rmSync(archive, { force: true });
// `ditto -c -k --sequesterRsrc --keepParent` is the archive tool that preserves a bundle's
// extended attributes and signature; the plain `zip` command is known to break signed bundles.
//
// The source is the stage's FULL path with `--keepParent`: ditto resolves it relative to the
// process's working directory, and passing only the basename made it fail with "Cannot get the
// real path for source" (measured on the first macOS run). `--keepParent` is what puts the folder
// name at the archive root, so the operator unpacks one folder rather than a loose `.app`.
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stage, archive]);

const sizeMb = (fs.statSync(archive).size / (1024 * 1024)).toFixed(1);
console.log(`[package-macos] ${path.basename(archive)} (${sizeMb} MB)`);
console.log(`[package-macos] layout: ${appName} + data/ + README-FIRST.txt`);
