import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { initDb, getDb, closeDb, Database } from '../../src/main/db';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrate } from '../../src/main/db/schema';
import {
  PreservedBrowserDataService,
  PreservedBrowserDataRow,
} from '../../src/main/services/preserved-browser-data-service';
import {
  scanCamoufoxInventory,
  runInventoryGeneration,
  CamoufoxClassificationCategory,
} from '../../scripts/camoufox-inventory';

describe('Camoufox Inventory & Preservation Suite', () => {
  let db: Database;
  let tempDir: string;
  let service: PreservedBrowserDataService;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camoufox-test-'));
    db = getDb();
    service = new PreservedBrowserDataService(db, [tempDir]);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Camoufox Inventory Classification', () => {
    it('scans and classifies all touchpoints across required categories with zero unclassified paths', () => {
      const manifest = scanCamoufoxInventory();
      expect(manifest.schemaVersion).toBe('1.0.0');
      expect(manifest.summary.unclassifiedPaths).toBe(0);
      expect(manifest.summary.totalTouchpoints).toBeGreaterThan(0);

      const requiredCategories: CamoufoxClassificationCategory[] = [
        'configuration',
        'database',
        'bundle',
        'route',
        'lifecycle',
        'syncer',
        'ui',
        'docs',
        'probe',
        'package',
        'dependency',
        'data',
      ];

      for (const cat of requiredCategories) {
        expect(manifest.summary.categories[cat]).toBeDefined();
        expect(manifest.summary.categories[cat]).toBeGreaterThan(0);
      }

      for (const tp of manifest.touchpoints) {
        expect(tp.path).toBeTruthy();
        expect(tp.owner).toBeTruthy();
        expect(tp.evidenceCommand).toBeTruthy();
        expect(['preserve', 'refuse', 'remove', 'quarantine', 'isolate', 'stub']).toContain(tp.disposition);
        expect(['registry_durable', 'code_frozen', 'audit_retained', 'not_applicable', 'none']).toContain(tp.preservationClass);
        expect(tp.rollbackAction).toBeTruthy();
      }
    });

    it('generates evidence/camoufox-inventory.json file accurately', () => {
      const manifest = runInventoryGeneration(tempDir);
      const outputPath = path.join(tempDir, 'evidence', 'camoufox-inventory.json');
      expect(fs.existsSync(outputPath)).toBe(true);

      const fileContent = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(fileContent.summary.totalTouchpoints).toBe(manifest.summary.totalTouchpoints);
      expect(fileContent.summary.unclassifiedPaths).toBe(0);
      expect(fileContent.summary.categories).toEqual(manifest.summary.categories);
    });
  });

  describe('Preserved Browser Data Registry CRUD & Isolation', () => {
    it('creates preserved_browser_data table in schema with expected columns and indices', () => {
      const tableInfo = db.prepare(`PRAGMA table_info(preserved_browser_data)`).all() as Array<{ name: string; type: string }>;
      const columnNames = tableInfo.map((c) => c.name);

      const requiredColumns = [
        'id',
        'profile_id',
        'owner_id',
        'tenant_id',
        'engine',
        'canonical_root',
        'data_digest',
        'inventory_json',
        'revision',
        'created_at',
        'updated_at',
        'purged_at',
        'status',
        'journal_json',
      ];

      for (const col of requiredColumns) {
        expect(columnNames).toContain(col);
      }
    });

    it('registers preserved profile data, calculates digest, and maintains journal', () => {
      const profileDataDir = path.join(tempDir, 'profile_123');
      fs.mkdirSync(profileDataDir, { recursive: true });
      fs.writeFileSync(path.join(profileDataDir, 'prefs.js'), 'user_pref("foo", "bar");');
      fs.writeFileSync(path.join(profileDataDir, 'places.sqlite'), 'sqlite-dummy-content');

      const record = service.preserveProfileData({
        profileId: 'p-123',
        ownerId: 'user_1',
        tenantId: 'tenant_main',
        canonicalRoot: profileDataDir,
        inventory: { files: ['prefs.js', 'places.sqlite'] },
        journalNote: 'Initial capture for Camoufox profile p-123',
      });

      expect(record).toBeDefined();
      expect(record.profile_id).toBe('p-123');
      expect(record.owner_id).toBe('user_1');
      expect(record.tenant_id).toBe('tenant_main');
      expect(record.engine).toBe('camoufox');
      expect(record.status).toBe('preserved');
      expect(record.revision).toBe(1);
      expect(record.data_digest).toBeTruthy();

      const journal = JSON.parse(record.journal_json);
      expect(journal).toHaveLength(1);
      expect(journal[0].action).toBe('preserve');
      expect(journal[0].actor.ownerId).toBe('user_1');
    });

    it('increments revision and updates journal on update', () => {
      const profileDataDir = path.join(tempDir, 'profile_upd');
      fs.mkdirSync(profileDataDir, { recursive: true });
      fs.writeFileSync(path.join(profileDataDir, 'cookies.sqlite'), 'cookies');

      const initial = service.preserveProfileData({
        profileId: 'p-upd',
        ownerId: 'user_1',
        tenantId: 'tenant_main',
        canonicalRoot: profileDataDir,
      });

      expect(initial.revision).toBe(1);

      fs.writeFileSync(path.join(profileDataDir, 'cookies.sqlite'), 'cookies_modified');

      const updated = service.preserveProfileData({
        profileId: 'p-upd',
        ownerId: 'user_1',
        tenantId: 'tenant_main',
        canonicalRoot: profileDataDir,
        journalNote: 'Sync updated files',
      });

      expect(updated.revision).toBe(2);
      expect(updated.data_digest).not.toBe(initial.data_digest);
      const journal = JSON.parse(updated.journal_json);
      expect(journal).toHaveLength(2);
      expect(journal[1].action).toBe('update_preservation');
    });

    it('enforces tenant boundary checks and prevents unauthorized cross-tenant operations', () => {
      const profileDataDir = path.join(tempDir, 'profile_tenant_a');
      fs.mkdirSync(profileDataDir, { recursive: true });
      fs.writeFileSync(path.join(profileDataDir, 'data.txt'), 'data');

      const record = service.preserveProfileData({
        profileId: 'p-tenant-a',
        ownerId: 'user_a',
        tenantId: 'tenant_a',
        canonicalRoot: profileDataDir,
      });

      // Tenant B attempting to update Tenant A's record
      expect(() => {
        service.preserveProfileData({
          profileId: 'p-tenant-a',
          ownerId: 'user_b',
          tenantId: 'tenant_b',
          canonicalRoot: profileDataDir,
        });
      }).toThrow(/Tenant mismatch/);

      // User B in Tenant A attempting to access without admin role
      expect(() => {
        service.assertTenantIsolation(record, {
          ownerId: 'user_other',
          tenantId: 'tenant_a',
        });
      }).toThrow(/Owner mismatch/);

      // Admin in Tenant A can access
      expect(() => {
        service.assertTenantIsolation(record, {
          ownerId: 'admin_user',
          tenantId: 'tenant_a',
          roles: ['admin'],
        });
      }).not.toThrow();
    });

    it('prevents directory traversal and symlinks in canonicalRoot', () => {
      expect(() => {
        service.preserveProfileData({
          profileId: 'p-trav',
          ownerId: 'user_1',
          tenantId: 'tenant_main',
          canonicalRoot: path.join(tempDir, '../traversal_test'),
        });
      }).toThrow(/traversal|outside of allowed/i);
    });

    it('ensures preserved data survives metadata purge (soft delete and profile table deletion)', () => {
      const profileDataDir = path.join(tempDir, 'profile_to_purge');
      fs.mkdirSync(profileDataDir, { recursive: true });
      fs.writeFileSync(path.join(profileDataDir, 'prefs.js'), 'user_pref("preserved", true);');

      // Create a profile in profiles table
      const profileId = 'prof_meta_purge_1';
      db.prepare(`
        INSERT INTO profiles (id, name, created_at, updated_at, browser_type)
        VALUES (?, 'Test Firefox Profile', ?, ?, 'camoufox')
      `).run(profileId, Date.now(), Date.now());

      const preserved = service.preserveProfileData({
        profileId,
        ownerId: 'user_owner',
        tenantId: 'tenant_1',
        canonicalRoot: profileDataDir,
      });

      // Simulate soft-delete (trash)
      db.prepare(`UPDATE profiles SET deleted_at = ? WHERE id = ?`).run(Date.now(), profileId);

      // Verify preserved record is still completely intact
      let preservedCheck = service.getById(preserved.id);
      expect(preservedCheck).not.toBeNull();
      expect(preservedCheck?.status).toBe('preserved');

      // Simulate hard purge of profiles table metadata
      db.prepare(`DELETE FROM profiles WHERE id = ?`).run(profileId);

      // Preserved data in preserved_browser_data registry must survive!
      preservedCheck = service.getById(preserved.id);
      expect(preservedCheck).not.toBeNull();
      expect(preservedCheck?.profile_id).toBe(profileId);
      expect(preservedCheck?.status).toBe('preserved');
      expect(fs.existsSync(profileDataDir)).toBe(true);
    });

    it('performs typed-confirmation cleanup bound to registry ID and current digest', () => {
      const profileDataDir = path.join(tempDir, 'profile_cleanup');
      fs.mkdirSync(profileDataDir, { recursive: true });
      fs.writeFileSync(path.join(profileDataDir, 'session.json'), '{"history":[]}');

      const record = service.preserveProfileData({
        profileId: 'p-clean',
        ownerId: 'user_1',
        tenantId: 'tenant_main',
        canonicalRoot: profileDataDir,
      });

      // Attempt cleanup with invalid confirmation text
      expect(() => {
        service.cleanupPreservedData({
          registryId: record.id,
          expectedDigest: record.data_digest,
          typedConfirmation: 'DELETE',
          securityContext: { ownerId: 'user_1', tenantId: 'tenant_main' },
        });
      }).toThrow(/Confirmation mismatch/);

      // Attempt cleanup with stale/invalid digest
      expect(() => {
        service.cleanupPreservedData({
          registryId: record.id,
          expectedDigest: 'stale_digest_12345',
          typedConfirmation: `PERMANENTLY DELETE ${record.id}`,
          securityContext: { ownerId: 'user_1', tenantId: 'tenant_main' },
        });
      }).toThrow(/Digest mismatch/);

      // Valid cleanup
      const cleaned = service.cleanupPreservedData({
        registryId: record.id,
        expectedDigest: record.data_digest,
        typedConfirmation: `PERMANENTLY DELETE ${record.id}`,
        securityContext: { ownerId: 'user_1', tenantId: 'tenant_main' },
      });

      expect(cleaned.status).toBe('purged');
      expect(cleaned.purged_at).toBeGreaterThan(0);
      expect(fs.existsSync(profileDataDir)).toBe(false);

      const journal = JSON.parse(cleaned.journal_json);
      expect(journal[journal.length - 1].action).toBe('cleanup_purged');
    });

    it('rolls back database operations on transaction failure', () => {
      const profileDataDir = path.join(tempDir, 'profile_tx');
      fs.mkdirSync(profileDataDir, { recursive: true });
      fs.writeFileSync(path.join(profileDataDir, 'data.db'), 'data');

      const runFailingTransaction = () => {
        db.exec('BEGIN TRANSACTION');
        try {
          service.preserveProfileData({
            profileId: 'p-tx-fail',
            ownerId: 'user_1',
            tenantId: 'tenant_main',
            canonicalRoot: profileDataDir,
          });
          // Intentionally throw inside transaction
          throw new Error('Simulated crash during transaction');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      };

      expect(() => runFailingTransaction()).toThrow(/Simulated crash/);

      // Assert nothing was committed to database
      const row = service.getByProfileId('p-tx-fail');
      expect(row).toBeNull();
    });
  });
});
