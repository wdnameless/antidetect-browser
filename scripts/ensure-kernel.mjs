// Ensures the fingerprint-chromium kernel exists on disk before packaging or dev run.
// Aligned with src/main/util/kernelAcquire.ts — verifies SHA256 digest before extraction.
// Usage: node scripts/ensure-kernel.mjs (also runs automatically via `predist` / dev)
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// NOTE: These digests are external and pinned for upstream release 148.0.7778.215.
// They MUST be re-pinned when the upstream fingerprint-chromium version changes.
const KERNEL_VERSION = '148.0.7778.215';
const EXPECTED_SHA256 = '9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579';
const ASSET_NAME = `ungoogled-chromium_${KERNEL_VERSION}-1.1_windows_x64.zip`;
const KERNEL_DIR = path.join(__dirname, '..', 'data', 'chromium', 'fingerprint-chromium');
const BUILD_DIR = path.join(KERNEL_DIR, `ungoogled-chromium_${KERNEL_VERSION}-1.1_windows_x64`);
const EXE = path.join(BUILD_DIR, 'chrome.exe');

const URL = `https://github.com/adryfish/fingerprint-chromium/releases/download/${KERNEL_VERSION}/${ASSET_NAME}`;

async function main() {
  if (existsSync(EXE)) {
    console.log(`[ensure-kernel] fingerprint-chromium ${KERNEL_VERSION} already present: ${BUILD_DIR}`);
    return;
  }
  console.log(`[ensure-kernel] fingerprint-chromium ${KERNEL_VERSION} not found, downloading...`);
  console.log(`[ensure-kernel] GET ${URL}`);
  mkdirSync(KERNEL_DIR, { recursive: true });
  const tmpZip = path.join(KERNEL_DIR, `kernel-${KERNEL_VERSION}-${Date.now()}.zip.tmp`);

  try {
    const res = await fetch(URL, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);

    const hash = crypto.createHash('sha256');
    const writeStream = createWriteStream(tmpZip);

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
      try { unlinkSync(tmpZip); } catch { /* ignore */ }
      throw new Error(`digest mismatch for ${ASSET_NAME}: expected ${EXPECTED_SHA256}, got ${actualSha256}`);
    }

    console.log('[ensure-kernel] SHA256 verified successfully. Extracting...');
    const zip = new AdmZip(tmpZip);
    zip.extractAllTo(KERNEL_DIR, true);

    try { unlinkSync(tmpZip); } catch { /* ignore */ }

    if (!existsSync(EXE)) throw new Error(`kernel extracted but chrome.exe not found at ${BUILD_DIR}`);
    console.log(`[ensure-kernel] OK: ${EXE}`);
  } catch (err) {
    try {
      if (existsSync(tmpZip)) unlinkSync(tmpZip);
    } catch { /* ignore */ }
    throw err;
  }
}

main().catch((err) => {
  console.error('[ensure-kernel] FAILED:', err.message);
  process.exit(1);
});
