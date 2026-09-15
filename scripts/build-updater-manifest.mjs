// Emit the two files `tauri-plugin-updater` needs from a GitHub release:
//
//   latest.json   — the metadata document the endpoint points at
//   <artefact>.sig — the minisign signature of the artefact it describes
//
// Why a script rather than inlining this in CI: the format is exact (a wrong platform key
// or a missing `signature` makes the updater reject every release), and getting it wrong is
// invisible — the app would report "no update available" forever while looking configured.
//
// Signing uses the Tauri CLI's own minisign implementation so the signature matches the
// public key embedded in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The private
// key is supplied by CI as TAURI_SIGNING_PRIVATE_KEY and MUST never be committed.
//
// Usage:
//   node scripts/build-updater-manifest.mjs \
//     --version 0.6.0 \
//     --notes "release notes" \
//     --url "https://github.com/<o>/<r>/releases/download/v0.6.0/NullTrace-Setup-0.6.0.exe" \
//     --artefact src-tauri/target/release/bundle/nsis/NullTrace_0.6.0_x64-setup.exe \
//     --out dist-release
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const version = arg('version');
const notes = arg('notes') ?? '';
const url = arg('url');
const artefact = arg('artefact');
const outDir = arg('out') ?? 'dist-release';

if (!version || !url || !artefact) {
  console.error(
    'Usage: node scripts/build-updater-manifest.mjs --version <v> --url <release asset url> ' +
      '--artefact <path to the built installer> [--notes <text>] [--out <dir>]',
  );
  process.exit(2);
}
if (!fs.existsSync(artefact)) {
  console.error(`[updater-manifest] artefact not found: ${artefact}`);
  process.exit(1);
}

const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
if (!privateKey || privateKey.trim().length === 0) {
  // Failing loudly is the point: publishing a latest.json with an empty `signature` would
  // make the updater refuse every update while the UI reported the check as successful.
  console.error(
    '[updater-manifest] TAURI_SIGNING_PRIVATE_KEY is not set.\n' +
      '  Generate a keypair with `npx tauri signer generate` once, store the private key as a\n' +
      '  CI secret, and put the PUBLIC key in src-tauri/tauri.conf.json (plugins.updater.pubkey).\n' +
      '  Refusing to emit an unsigned manifest.',
  );
  process.exit(1);
}

fs.mkdirSync(path.resolve(ROOT, outDir), { recursive: true });
const sigPath = path.resolve(ROOT, outDir, `${path.basename(artefact)}.sig`);
const jsonPath = path.resolve(ROOT, outDir, 'latest.json');

// `tauri signer sign` reads the key from the environment and writes <file>.sig.
const sign = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tauri', 'signer', 'sign', path.resolve(ROOT, artefact)],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
    },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  },
);
if (sign.status !== 0) {
  console.error('[updater-manifest] signing failed:\n' + (sign.stderr || sign.stdout));
  process.exit(1);
}

// The CLI writes the signature beside the artefact; move it into the release dir.
const cliSig = path.resolve(ROOT, `${artefact}.sig`);
if (fs.existsSync(cliSig)) fs.renameSync(cliSig, sigPath);
if (!fs.existsSync(sigPath)) {
  console.error('[updater-manifest] no .sig produced — refusing to write latest.json');
  process.exit(1);
}
const signature = fs.readFileSync(sigPath, 'utf8').trim();
if (signature.length === 0) {
  console.error('[updater-manifest] signature file is empty — refusing to write latest.json');
  process.exit(1);
}

// Only the Windows entry is produced. macOS and Linux are configured but not built on this
// runner, and inventing entries for artefacts that do not exist would make those platforms
// fail on a URL that 404s rather than reporting an honest "no update".
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature, url },
  },
};

fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`[updater-manifest] wrote ${path.relative(ROOT, jsonPath)}`);
console.log(`[updater-manifest] wrote ${path.relative(ROOT, sigPath)}`);
