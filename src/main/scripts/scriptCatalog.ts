// Script Catalog (Sprint 4.4): curated scripts from a GitHub raw manifest.
//
// Manifest format: {scripts: [{id, name, description, tags[], version, url,
// checksum_sha256}]}. Install flow: fetch code -> verify sha256 -> (user
// reviews the code in the UI) -> explicit install writes into `scripts`.
// Checksum mismatch NEVER stores anything (code:"CHECKSUM_MISMATCH").
import { createHash } from 'crypto';
import fetch from 'node-fetch';
import { getDb } from '../db';
import { getCatalogUrl, setSetting } from '../config';
import { createScript } from './scriptEngine';

export interface CatalogScript {
  id: string;
  name: string;
  description: string;
  tags: string[];
  version: string;
  url: string;
  checksum_sha256: string;
}

export interface CatalogManifest {
  scripts: CatalogScript[];
}

export type CatalogResult<T> = { ok: true; data: T } | { ok: false; code: string; msg: string };

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, { timeout: timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchCatalog(): Promise<CatalogResult<CatalogManifest>> {
  const url = getCatalogUrl();
  if (!url) {
    return { ok: false, code: 'CATALOG_NOT_CONFIGURED', msg: 'catalog URL is not configured (Settings -> Script Catalog)' };
  }
  try {
    const text = await fetchText(url);
    const parsed = JSON.parse(text) as CatalogManifest;
    if (!parsed || !Array.isArray(parsed.scripts)) {
      return { ok: false, code: 'INVALID_MANIFEST', msg: 'manifest must be {scripts: [...]}' };
    }
    return { ok: true, data: { scripts: parsed.scripts.filter((s) => s && s.id && s.url) } };
  } catch (err) {
    return { ok: false, code: 'CATALOG_FETCH_FAILED', msg: (err as Error).message };
  }
}

/** Fetch one catalog entry's code (for the View-code modal). */
export async function fetchCatalogCode(entryUrl: string): Promise<CatalogResult<{ code: string; checksum: string }>> {
  try {
    const code = await fetchText(entryUrl);
    return { ok: true, data: { code, checksum: sha256(code) } };
  } catch (err) {
    return { ok: false, code: 'CATALOG_FETCH_FAILED', msg: (err as Error).message };
  }
}

export async function installFromCatalog(
  catalogId: string
): Promise<{ ok: true; data: { id: string } } | { ok: false; code: string; msg: string }> {
  const cat = await fetchCatalog();
  if (!cat.ok) return cat;
  const entry = cat.data.scripts.find((s) => s.id === catalogId);
  if (!entry) return { ok: false, code: 'NOT_FOUND', msg: 'catalog entry not found' };

  let code: string;
  try {
    code = await fetchText(entry.url);
  } catch (err) {
    return { ok: false, code: 'CATALOG_FETCH_FAILED', msg: (err as Error).message };
  }

  const actual = sha256(code);
  if (actual.toLowerCase() !== String(entry.checksum_sha256 || '').toLowerCase()) {
    return { ok: false, code: 'CHECKSUM_MISMATCH', msg: `expected ${entry.checksum_sha256}, got ${actual}` };
  }

  const created = createScript(entry.name || entry.id, code);
  return { ok: true, data: created };
}

/** Settings persistence for the catalog URL. */
export function setCatalogUrl(url: string): void {
  setSetting('catalogUrl', url.trim());
}

export function getCatalogUrlSetting(): string {
  return getCatalogUrl();
}

void getDb;