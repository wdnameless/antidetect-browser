// Fetches a PINNED Node.js Windows x64 runtime binary and places it at
// src-tauri/binaries/node-x86_64-pc-windows-msvc.exe per the Tauri externalBin target-triple convention.
// Verifies hardcoded SHA-256 before accepting the download; fails loudly on mismatch.
// Usage: node scripts/vendor-node.mjs

import { existsSync, mkdirSync, createWriteStream, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pinned Node.js version and official SHA256 digest from https://nodejs.org/dist/v22.23.2/SHASUMS256.txt
// Asset: win-x64/node.exe
const NODE_VERSION = '22.23.2';
const EXPECTED_SHA256 = '0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4';

const URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;
const TARGET_DIR = path.join(__dirname, '..', 'src-tauri', 'binaries');
const TARGET_EXE = path.join(TARGET_DIR, 'node-x86_64-pc-windows-msvc.exe');

async function main() {
  if (existsSync(TARGET_EXE)) {
    // Check if existing file has expected sha256 to allow idempotency
    const existingBuffer = await import('node:fs/promises').then(fs => fs.readFile(TARGET_EXE));
    const existingHash = crypto.createHash('sha256').update(existingBuffer).digest('hex').toLowerCase();
    if (existingHash === EXPECTED_SHA256.toLowerCase()) {
      console.log(`[vendor-node] Node.js ${NODE_VERSION} already present and verified: ${TARGET_EXE}`);
      return;
    }
    console.warn(`[vendor-node] Existing binary hash mismatch (${existingHash}), re-downloading...`);
  }

  console.log(`[vendor-node] Fetching Node.js ${NODE_VERSION} runtime...`);
  console.log(`[vendor-node] GET ${URL}`);
  mkdirSync(TARGET_DIR, { recursive: true });
  const tmpExe = path.join(TARGET_DIR, `node-vendor-${NODE_VERSION}-${Date.now()}.tmp`);

  try {
    const res = await fetch(URL, { redirect: 'follow' });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed with HTTP ${res.status}: ${res.statusText}`);
    }

    const hash = crypto.createHash('sha256');
    const writeStream = createWriteStream(tmpExe);

    const reader = res.body.getReader ? res.body.getReader() : null;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        writeStream.write(value);
      }
      writeStream.end();
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } else {
      await new Promise((resolve, reject) => {
        res.body.on('data', (chunk) => {
          hash.update(chunk);
          writeStream.write(chunk);
        });
        res.body.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        res.body.on('end', () => writeStream.end());
      });
    }

    const actualSha256 = hash.digest('hex').toLowerCase();
    if (actualSha256 !== EXPECTED_SHA256.toLowerCase()) {
      try { unlinkSync(tmpExe); } catch { /* ignore */ }
      throw new Error(`Digest mismatch for Node.js v${NODE_VERSION}: expected ${EXPECTED_SHA256}, got ${actualSha256}`);
    }

    console.log('[vendor-node] SHA-256 verified successfully.');
    renameSync(tmpExe, TARGET_EXE);
    console.log(`[vendor-node] Installed vendored runtime to: ${TARGET_EXE}`);
  } catch (err) {
    try {
      if (existsSync(tmpExe)) unlinkSync(tmpExe);
    } catch { /* ignore */ }
    throw err;
  }
}

main().catch((err) => {
  console.error('[vendor-node] FAILED:', err.message);
  process.exit(1);
});
