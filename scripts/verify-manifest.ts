import * as fs from 'fs';
import * as path from 'path';
import {
  verifySignedManifest,
  KeyRingStore,
  SignedManifestEnvelope,
} from '../src/main/security';

function main() {
  const args = process.argv.slice(2);
  let manifestPath = '';
  let keyRingPath = path.join(process.cwd(), 'release-keyring.json');
  let targetDir = '';
  let installedVersion = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest' && args[i + 1]) manifestPath = args[++i];
    else if (args[i] === '--keyring' && args[i + 1]) keyRingPath = args[++i];
    else if (args[i] === '--dir' && args[i + 1]) targetDir = args[++i];
    else if (args[i] === '--installed-version' && args[i + 1]) installedVersion = args[++i];
  }

  if (!manifestPath) {
    console.error('Usage: ts-node scripts/verify-manifest.ts --manifest <manifest.json> [--keyring <keyring.json>] [--dir <targetDir>] [--installed-version <ver>]');
    process.exit(1);
  }

  const rawManifest = fs.readFileSync(path.resolve(manifestPath), 'utf8');
  const envelope = JSON.parse(rawManifest) as SignedManifestEnvelope;
  const keyRing = KeyRingStore.fromFile(path.resolve(keyRingPath));

  const result = verifySignedManifest(envelope, keyRing, {
    targetDir: targetDir ? path.resolve(targetDir) : undefined,
    currentInstalledVersion: installedVersion || undefined,
  });

  if (!result.valid) {
    console.error(`Verification FAILED: ${result.reason} - ${result.error}`);
    process.exit(1);
  }

  console.log(`Verification SUCCEEDED for version ${envelope.payload.version}`);
}

if (require.main === module) {
  main();
}
