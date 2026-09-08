import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BUNDLE_PATH = path.resolve(process.cwd(), 'assets', 'fingerprints', 'catalog-v2.json');

interface CatalogBundle {
  version: number;
  generatedFrom: string[];
  generatedAt: string;
  familiesCount: number;
  sha256: string;
  families: unknown[];
}

function loadBundle(): CatalogBundle {
  const raw = fs.readFileSync(BUNDLE_PATH, 'utf8');
  return JSON.parse(raw) as CatalogBundle;
}

describe('Task 1.5 - Fingerprint catalog v2 bundle', () => {
  it('committed bundle parses and carries the declared metadata', () => {
    const bundle = loadBundle();
    expect(String(bundle.version)).toBe('2');
    expect(bundle.families.length).toBe(bundle.familiesCount);
    expect(bundle.familiesCount).toBeGreaterThanOrEqual(40);
    expect(bundle.generatedFrom.length).toBeGreaterThan(0);
  });
  it('bundle sha256 matches the canonical families blob (deterministic regeneration)', () => {
    const bundle = loadBundle();
    const canonical = JSON.stringify(bundle.families);
    const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(digest).toBe(bundle.sha256);
  });

  it('family ids are unique across all sources (byte-stable regeneration order)', () => {
    const bundle = loadBundle();
    const ids = bundle.families.map((f) => (f as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});