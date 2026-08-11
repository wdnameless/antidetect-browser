// Ensures the fingerprint-chromium kernel exists on disk before packaging.
// If missing, downloads the pinned Windows build from GitHub releases.
// Usage: node scripts/ensure-kernel.mjs  (also runs automatically via `predist`)
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL_VERSION = '148.0.7778.215';
const KERNEL_DIR = path.join(__dirname, '..', 'data', 'chromium', 'fingerprint-chromium');
const BUILD_DIR = path.join(KERNEL_DIR, `ungoogled-chromium_${KERNEL_VERSION}-1.1_windows_x64`);
const EXE = path.join(BUILD_DIR, 'chrome.exe');

const URL = `https://github.com/adryfish/fingerprint-chromium/releases/download/${KERNEL_VERSION}/ungoogled-chromium_${KERNEL_VERSION}-1.1_windows_x64.zip`;

async function main() {
  if (existsSync(EXE)) {
    console.log(`[ensure-kernel] fingerprint-chromium ${KERNEL_VERSION} already present: ${BUILD_DIR}`);
    return;
  }
  console.log(`[ensure-kernel] fingerprint-chromium ${KERNEL_VERSION} not found, downloading...`);
  console.log(`[ensure-kernel] GET ${URL}`);
  mkdirSync(KERNEL_DIR, { recursive: true });
  const tmpZip = path.join(KERNEL_DIR, `kernel-${KERNEL_VERSION}.zip`);
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(tmpZip));
  console.log('[ensure-kernel] extracting...');
  const zip = new AdmZip(tmpZip);
  zip.extractAllTo(KERNEL_DIR, true);
  try { await import('node:fs/promises').then((fs) => fs.unlink(tmpZip)); } catch { /* ignore */ }
  if (!existsSync(EXE)) throw new Error(`kernel extracted but chrome.exe not found at ${BUILD_DIR}`);
  console.log(`[ensure-kernel] OK: ${EXE}`);
}

main().catch((err) => {
  console.error('[ensure-kernel] FAILED:', err.message);
  process.exit(1);
});
