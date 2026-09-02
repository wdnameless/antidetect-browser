import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  generateLegacyCorpus,
  generateLegacyFixtures,
} from '../../scripts/generate-legacy-corpus';
import type {
  SignedLegacyCorpusEnvelope,
} from '../../scripts/generate-legacy-corpus';
import {
  verifyLegacyCorpusFile,
} from '../../scripts/verify-legacy-corpus';
import {
  generateEd25519KeyPair,
  signLegacyCorpus,
  verifyLegacyCorpus,
  DOMAIN_SEPARATOR_LEGACY_CORPUS,
} from '../../scripts/lib/crypto-ed25519';
import { canonicalizeJson } from '../../scripts/lib/jcs';
import { computeSha256 } from '../../scripts/lib/evidence-wrapper';

describe('Legacy API Fixture Corpus & Ed25519 Barrier', () => {
  const tempTestDir = path.join(process.cwd(), 'temp', 'test-corpus');
  const tempCorpusPath = path.join(tempTestDir, 'LEGACY_CORPUS_SIGNED.test.json');

  beforeEach(() => {
    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempTestDir)) {
      try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('generates a comprehensive set of legacy API fixtures covering all required categories', () => {
    const fixtures = generateLegacyFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(10);

    const categories = new Set(fixtures.map((f) => f.category));
    expect(categories.has('create')).toBe(true);
    expect(categories.has('import')).toBe(true);
    expect(categories.has('duplicate')).toBe(true);
    expect(categories.has('start')).toBe(true);
    expect(categories.has('stop')).toBe(true);
    expect(categories.has('bulk')).toBe(true);
    expect(categories.has('script')).toBe(true);
    expect(categories.has('sync')).toBe(true);

    const apiVersions = new Set(fixtures.map((f) => f.apiVersion));
    expect(apiVersions.has('v1')).toBe(true);
    expect(apiVersions.has('v2')).toBe(true);

    // Verify presence of mixed-bulk partial failure semantics
    const bulkFixture = fixtures.find((f) => f.category === 'bulk' && f.mixedBulkSemantics);
    expect(bulkFixture).toBeDefined();
    expect(bulkFixture?.mixedBulkSemantics?.failed).toBeGreaterThan(0);
    expect(bulkFixture?.mixedBulkSemantics?.succeeded).toBeGreaterThan(0);

    // Verify presence of headers and status codes
    for (const fixture of fixtures) {
      expect(fixture.request.method).toBeDefined();
      expect(fixture.request.path).toBeDefined();
      expect(fixture.request.headers).toBeDefined();
      expect(fixture.response.status).toBeGreaterThanOrEqual(200);
      expect(fixture.response.headers).toBeDefined();
      expect(fixture.response.body).toBeDefined();
    }
  });

  it('generates, signs, and saves a valid LEGACY_CORPUS_SIGNED envelope', async () => {
    const envelope = await generateLegacyCorpus({ outPath: tempCorpusPath });
    expect(fs.existsSync(tempCorpusPath)).toBe(true);
    expect(envelope.schemaVersion).toBe('1');
    expect(envelope.signatureAlgorithm).toBe('Ed25519');
    expect(envelope.domain).toBe(DOMAIN_SEPARATOR_LEGACY_CORPUS);
    expect(envelope.signature).toBeDefined();
    expect(typeof envelope.signature).toBe('string');
    expect(envelope.signature.length).toBe(128); // 64 bytes in hex

    // Verify using verifier
    const { isValid, details } = verifyLegacyCorpusFile(tempCorpusPath);
    expect(isValid).toBe(true);
    expect(details.verified).toBe(true);
    expect(details.fixturesCount).toBe(envelope.fixtures.length);
    expect(details.keyId).toBe(envelope.keyId);
  });

  it('rejects tampered corpus payload data', async () => {
    const envelope = await generateLegacyCorpus({ outPath: tempCorpusPath });
    expect(fs.existsSync(tempCorpusPath)).toBe(true);

    // Tamper with payload (modify a fixture)
    const raw = JSON.parse(fs.readFileSync(tempCorpusPath, 'utf8'));
    raw.fixtures[0].name = 'TAMPERED NAME';
    fs.writeFileSync(tempCorpusPath, JSON.stringify(raw), 'utf8');

    const { isValid, details } = verifyLegacyCorpusFile(tempCorpusPath);
    expect(isValid).toBe(false);
    expect(details.verified).toBe(false);
    expect(details.reason).toContain('Signature verification failed');
  });

  it('rejects signature when domain separation prefix differs', async () => {
    const keyPair = generateEd25519KeyPair();
    const fixtures = generateLegacyFixtures();
    const payload: Record<string, unknown> = {
      schemaVersion: '1',
      corpusSha256: computeSha256(Buffer.from('test', 'utf8')),
      contentAddress: 'urn:sha256:test',
      createdAt: new Date().toISOString(),
      fixtures,
      keyId: keyPair.keyId,
      publicKeyPem: keyPair.publicKeyPem,
    };

    // Sign with wrong domain
    const wrongDomain = 'wrong:domain:v2\0';
    const canonicalBytes = Buffer.from(canonicalizeJson(payload), 'utf8');
    const domainBytes = Buffer.from(wrongDomain, 'utf8');
    const messageToSign = Buffer.concat([domainBytes, canonicalBytes]);
    const signature = crypto.sign(null, messageToSign, keyPair.privateKeyPem).toString('hex');

    // Verification with standard domain MUST fail
    const isCorpusValid = verifyLegacyCorpus(payload, signature, keyPair.publicKeyPem);
    expect(isCorpusValid).toBe(false);
  });

  it('validates canonical RFC 8785 JCS determinism across key reordering', () => {
    const objA = { z: 1, a: 2, m: { nestedB: 'hello', nestedA: 'world' } };
    const objB = { a: 2, m: { nestedA: 'world', nestedB: 'hello' }, z: 1 };

    const canonA = canonicalizeJson(objA);
    const canonB = canonicalizeJson(objB);

    expect(canonA).toBe(canonB);
    expect(canonA).toBe('{"a":2,"m":{"nestedA":"world","nestedB":"hello"},"z":1}');
  });

  it('validates replay of fixture IDs and status code consistency', () => {
    const fixtures = generateLegacyFixtures();
    const ids = new Set<string>();

    for (const fixture of fixtures) {
      expect(ids.has(fixture.id)).toBe(false);
      ids.add(fixture.id);

      expect(fixture.response.status).toBeGreaterThanOrEqual(200);
      expect(fixture.response.status).toBeLessThan(600);

      // Verify request and response headers content-type matching
      if (fixture.request.headers['content-type']) {
        expect(fixture.request.headers['content-type']).toContain('json');
      }
    }
  });

  it('verifies the actual generated production barrier file if present', () => {
    const barrierPath = path.join(process.cwd(), 'evidence', 'barriers', 'LEGACY_CORPUS_SIGNED.json');
    if (fs.existsSync(barrierPath)) {
      const { isValid, details } = verifyLegacyCorpusFile(barrierPath);
      expect(isValid).toBe(true);
      expect(details.verified).toBe(true);
    }
  });
});
