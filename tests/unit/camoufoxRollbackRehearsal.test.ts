import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDb, getDb, type Database } from '../../src/main/db';
import {
  PreservedBrowserDataService,
  PreservedBrowserDataRecord,
  RollbackRehearsalResult,
} from '../../src/main/services/preserved-browser-data-service';
import {
  UnsupportedEngineError,
  CAMOUFOX_ENGINE_REMOVED,
  assertEngineAllowed,
} from '../../src/main/services/browser-engine-denial';
import {
  generateEd25519KeyPair,
  signLegacyCorpus,
  verifyLegacyCorpusSignature,
  type SignedLegacyCorpusEnvelope,
} from '../../scripts/lib/crypto-ed25519';

describe('Wave 4.3: Camoufox Rollback Rehearsal Verification', () => {
  let tempDir: string;
  let db: Database;
  let dataService: PreservedBrowserDataService;

  beforeAll(async () => {
    await initDb();
    db = getDb();
  });
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camoufox-rollback-rehearsal-'));

    // Clean preserved_browser_data table before each test
    db.exec(`DELETE FROM preserved_browser_data;`);

    dataService = new PreservedBrowserDataService(db, [tempDir]);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Preserved Browser Data Registry & Quarantine Transitions', () => {
    it('records preserved camoufox artifacts and transitions through preserved -> quarantined -> restored states', () => {
      const mockArchive = path.join(tempDir, 'profile1-cookies.tar.gz');
      fs.writeFileSync(mockArchive, 'preserved cookie data');

      // 1. Preserve artifact
      const record = dataService.preserveArtifact({
        profileId: 'p-100',
        sourceEngine: 'camoufox',
        dataType: 'cookies',
        archivePath: mockArchive,
      });

      expect(record.status).toBe('preserved');
      expect(record.sha256Digest).toBeDefined();
      expect(record.byteSize).toBe(fs.statSync(mockArchive).size);

      // Verify DB row
      const saved = dataService.getPreservedRecord(record.id);
      expect(saved).not.toBeNull();
      expect(saved?.sha256Digest).toBe(record.sha256Digest);

      // 2. Quarantine artifact
      const quarantined = dataService.quarantineArtifact(record.id, 'Routine security quarantine during engine removal');
      expect(quarantined.status).toBe('quarantined');
      expect(quarantined.quarantinedAt).toBeDefined();

      // Verify integrity check passes in quarantine
      const verifyQuarantine = dataService.verifyArtifactIntegrity(record.id);
      expect(verifyQuarantine.valid).toBe(true);
      expect(verifyQuarantine.digestMatches).toBe(true);

      // 3. Restore / rehearse rollback
      const restored = dataService.restoreArtifact(record.id);
      expect(restored.status).toBe('restored');
      expect(restored.restoredAt).toBeDefined();

      // Integrity remains intact
      const verifyRestored = dataService.verifyArtifactIntegrity(record.id);
      expect(verifyRestored.valid).toBe(true);
      expect(verifyRestored.digestMatches).toBe(true);
    });

    it('detects tampering or corruption in preserved archives', () => {
      const mockArchive = path.join(tempDir, 'tamper-test.tar.gz');
      fs.writeFileSync(mockArchive, 'original content');

      const record = dataService.preserveArtifact({
        profileId: 'p-tamper',
        sourceEngine: 'camoufox',
        dataType: 'storage',
        archivePath: mockArchive,
      });

      // Tamper with archive
      fs.writeFileSync(mockArchive, 'corrupted / tampered content');

      const check = dataService.verifyArtifactIntegrity(record.id);
      expect(check.valid).toBe(false);
      expect(check.digestMatches).toBe(false);
    });
  });

  describe('Rollback Simulation & State Machine Rehearsal', () => {
    it('simulates rollback from active denial state to preserved data snapshot', () => {
      // Insert legacy profile
      db.prepare(`
        INSERT INTO profiles (id, name, browser_type, created_at, updated_at) VALUES ('prof-legacy-1', 'Legacy Profile', 'chromium', ${Date.now()}, ${Date.now()})
      `).run();

      const mockArchive = path.join(tempDir, 'prof-legacy-1-data.tar.gz');
      fs.writeFileSync(mockArchive, 'mock profile data payload');

      const record = dataService.preserveArtifact({
        profileId: 'prof-legacy-1',
        sourceEngine: 'camoufox',
        dataType: 'full_profile',
        archivePath: mockArchive,
      });

      // Rehearse rollback
      const rehearsal: RollbackRehearsalResult = dataService.rehearseRollback({
        profileId: 'prof-legacy-1',
        fromState: 'denied',
        targetState: 'preserved',
        verifyDigests: true,
      });

      expect(rehearsal.success).toBe(true);
      expect(rehearsal.preservedRecordsCount).toBe(1);
      expect(rehearsal.digestsVerified).toBe(true);
      expect(rehearsal.errors).toHaveLength(0);
    });

    it('simulates roll forward / restoration from quarantine state while maintaining engine denial barriers', () => {
      const mockArchive = path.join(tempDir, 'quarantine-roll.tar.gz');
      fs.writeFileSync(mockArchive, 'quarantined profile data');

      const record = dataService.preserveArtifact({
        profileId: 'prof-quarantine-1',
        sourceEngine: 'camoufox',
        dataType: 'history',
        archivePath: mockArchive,
      });

      dataService.quarantineArtifact(record.id, 'Testing quarantine rollback');

      const rehearsal: RollbackRehearsalResult = dataService.rehearseRollback({
        profileId: 'prof-quarantine-1',
        fromState: 'quarantined',
        targetState: 'restored',
        verifyDigests: true,
      });

      expect(rehearsal.success).toBe(true);
      expect(rehearsal.digestsVerified).toBe(true);

      // Re-verifying engine denial remains enforced
      expect(() => assertEngineAllowed('camoufox')).toThrow(UnsupportedEngineError);
    });
  });

  describe('Legacy API Corpus Replay & Cryptographic Barrier Verification', () => {
    it('verifies signed legacy corpus replay envelope remains valid during rollback rehearsals', () => {
      const keyPair = generateEd25519KeyPair();

      const corpusEnvelope: Omit<SignedLegacyCorpusEnvelope, 'signature'> = {
        schemaVersion: '1',
        envelope: 'LEGACY_CORPUS_SIGNED',
        timestamp: new Date().toISOString(),
        publicKey: keyPair.publicKeyPem,
        fixtures: [
          {
            path: '/api/v1/profile/start',
            method: 'POST',
            body: { profileId: 'test-1', browserType: 'camoufox' },
            expectedStatus: 422,
            expectedErrorCode: CAMOUFOX_ENGINE_REMOVED,
          },
          {
            path: '/api/v1/profile/create',
            method: 'POST',
            body: { name: 'New Profile', browserType: 'chromium' },
            expectedStatus: 200,
          },
        ],
      };

      const signature = signLegacyCorpus(corpusEnvelope as unknown as Record<string, unknown>, keyPair.privateKeyPem);
      const signedPayload: SignedLegacyCorpusEnvelope = {
        ...corpusEnvelope,
        signature,
      };

      const verifyResult = verifyLegacyCorpusSignature(signedPayload);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.error).toBeUndefined();

      // Simulate replaying fixtures against engine denial assertions
      for (const fixture of signedPayload.fixtures) {
        if (fixture.expectedStatus === 422) {
          expect(() => assertEngineAllowed((fixture.body as any)?.browserType)).toThrow(UnsupportedEngineError);
        } else {
          expect(() => assertEngineAllowed((fixture.body as any)?.browserType)).not.toThrow();
        }
      }
    });

    it('rejects tampered corpus replay fixtures', () => {
      const keyPair = generateEd25519KeyPair();

      const corpusEnvelope: Omit<SignedLegacyCorpusEnvelope, 'signature'> = {
        schemaVersion: '1',
        envelope: 'LEGACY_CORPUS_SIGNED',
        timestamp: new Date().toISOString(),
        publicKey: keyPair.publicKeyPem,
        fixtures: [
          {
            path: '/api/v1/profile/start',
            method: 'POST',
            body: { profileId: 'test-1', browserType: 'camoufox' },
            expectedStatus: 422,
          },
        ],
      };

      const signature = signLegacyCorpus(corpusEnvelope as unknown as Record<string, unknown>, keyPair.privateKeyPem);
      const signedPayload: SignedLegacyCorpusEnvelope = {
        ...corpusEnvelope,
        signature,
      };

      // Tamper fixture
      const tampered = {
        ...signedPayload,
        fixtures: [
          {
            ...signedPayload.fixtures[0],
            expectedStatus: 200, // tampered expectation
          },
        ],
      };

      const verifyResult = verifyLegacyCorpusSignature(tampered);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toContain('Signature mismatch');
    });
  });
});
