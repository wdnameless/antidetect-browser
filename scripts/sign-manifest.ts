import * as fs from 'fs';
import * as path from 'path';
import {
  buildDirectoryMd5Manifest,
  createSignedManifest,
  KeyRingStore,
} from '../src/main/security';

function main() {
  const args = process.argv.slice(2);
  let targetDir = '';
  let keyRingPath = path.join(process.cwd(), 'release-keyring.json');
  let keyId = '';
  let privateKeyPath = '';
  let version = '1.0.0';
  let outFile = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) targetDir = args[++i];
    else if (args[i] === '--keyring' && args[i + 1]) keyRingPath = args[++i];
    else if (args[i] === '--key-id' && args[i + 1]) keyId = args[++i];
    else if (args[i] === '--private-key' && args[i + 1]) privateKeyPath = args[++i];
    else if (args[i] === '--version' && args[i + 1]) version = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outFile = args[++i];
  }

  if (!targetDir || !privateKeyPath) {
    console.error('Usage: ts-node scripts/sign-manifest.ts --dir <dir> --private-key <key.pem> [--key-id <id>] [--version <ver>] [--out <manifest.json>]');
    process.exit(1);
  }

  const resolvedDir = path.resolve(targetDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`Target directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  const privateKeyPem = fs.readFileSync(path.resolve(privateKeyPath), 'utf8');
  const filesManifest = buildDirectoryMd5Manifest(resolvedDir);

  const envelope = createSignedManifest({
    version,
    files: filesManifest,
    keyId: keyId || 'default-release-key',
    privateKeyPem,
  });

  const targetOut = outFile ? path.resolve(outFile) : path.join(resolvedDir, 'release.manifest.json');
  fs.writeFileSync(targetOut, JSON.stringify(envelope, null, 2), 'utf8');
  console.log(`Successfully signed release manifest: ${targetOut}`);
}

if (require.main === module) {
  main();
}
