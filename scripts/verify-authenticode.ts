import * as fs from 'fs';
import * as path from 'path';
import { verifyAuthenticode, findSignTool, isWindowsPlatform } from '../src/main/security';

function main() {
  const args = process.argv.slice(2);
  let targetDir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) targetDir = args[++i];
  }

  console.log(`[Authenticode Check] Scanning PE/DLL files in: ${targetDir}`);
  const signtool = findSignTool();
  if (!isWindowsPlatform()) {
    console.warn(`[WARN] Non-Windows platform (${process.platform}). Authenticode check skipped with warning.`);
    process.exit(0);
  }

  if (!signtool) {
    console.warn(`[WARN] signtool.exe was not found in PATH or Windows Kits. Authenticode check skipped with explicit warning.`);
    process.exit(0);
  }

  const peFiles: string[] = [];
  function scan(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          scan(full);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.exe' || ext === '.dll' || ext === '.node') {
          peFiles.push(full);
        }
      }
    }
  }

  scan(path.resolve(targetDir));
  console.log(`Found ${peFiles.length} PE/DLL binaries.`);

  let failedCount = 0;
  for (const file of peFiles) {
    const res = verifyAuthenticode(file);
    if (!res.verified) {
      console.error(`[FAIL] ${file}: ${res.error}`);
      failedCount++;
    } else if (res.skipped) {
      console.warn(`[SKIP] ${file}: ${res.warning}`);
    } else {
      console.log(`[PASS] ${file} (Signer: ${res.signer || 'Valid'})`);
    }
  }

  if (failedCount > 0) {
    console.error(`[ERROR] ${failedCount} binaries failed Authenticode verification.`);
    process.exit(1);
  }

  console.log('[OK] All PE/DLL binaries passed Authenticode verification.');
}

if (require.main === module) {
  main();
}
