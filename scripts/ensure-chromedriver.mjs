// Ensures chromedriver (matching kernel Chromium 148) exists for Selenium via debuggerAddress.
// Downloads the latest Chrome-for-Testing chromedriver for major version 148.
// Usage: node scripts/ensure-chromedriver.mjs  (also runs automatically via `predist`)
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAJOR = '148';
const OUT_DIR = path.join(__dirname, '..', 'data', 'chromedriver');
const EXE = path.join(OUT_DIR, 'chromedriver.exe');

async function main() {
  if (existsSync(EXE)) {
    console.log(`[ensure-chromedriver] already present: ${EXE}`);
    return;
  }
  const latestRes = await fetch(`https://googlechromelabs.github.io/chrome-for-testing/LATEST_RELEASE_${MAJOR}`, {
    redirect: 'follow',
  });
  if (!latestRes.ok) throw new Error(`LATEST_RELEASE_${MAJOR} fetch failed: HTTP ${latestRes.status}`);
  const version = (await latestRes.text()).trim();
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/win64/chromedriver-win64.zip`;
  console.log(`[ensure-chromedriver] chromedriver ${version} not found, downloading...`);
  console.log(`[ensure-chromedriver] GET ${url}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const tmpZip = path.join(OUT_DIR, `chromedriver-${version}.zip`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(tmpZip));
  console.log('[ensure-chromedriver] extracting...');
  const zip = new AdmZip(tmpZip);
  zip.extractAllTo(OUT_DIR, true);
  // zip extracts to chromedriver-win64/chromedriver.exe; copy to top level for a stable path.
  const extracted = path.join(OUT_DIR, 'chromedriver-win64', 'chromedriver.exe');
  if (existsSync(extracted) && !existsSync(EXE)) {
    const { copyFileSync } = await import('node:fs');
    copyFileSync(extracted, EXE);
  }
  try { await import('node:fs/promises').then((fs) => fs.unlink(tmpZip)); } catch { /* ignore */ }
  if (!existsSync(EXE)) throw new Error(`chromedriver extracted but not found at ${EXE}`);
  console.log(`[ensure-chromedriver] OK: ${EXE}`);
}

main().catch((err) => {
  console.error('[ensure-chromedriver] FAILED:', err.message);
  process.exit(1);
});
