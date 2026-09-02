import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { initDb, getDb, type Database } from '../../src/main/db';
import {
  PreservedBrowserDataService,
  PreservedBrowserDataRow,
  SecurityContext,
} from '../../src/main/services/preserved-browser-data-service';

describe('Preserved Browser Data Service - Export, Restore, Cleanup and Denial', () => {
  let db: Database;
  let tempDir: string;
  let allowedRoot: string;
  let outsideRoot: string;
  let service: PreservedBrowserDataService;

  const tenantAContext: SecurityContext = {
    ownerId: 'user_alice',
    tenantId: 'tenant_alpha',
  };

  const tenantBContext: SecurityContext = {
    ownerId: 'user_bob',
    tenantId: 'tenant_beta',
  };

  const adminContext: SecurityContext = {
    ownerId: 'user_admin',
    tenantId: 'tenant_alpha',
    roles: ['admin'],
  };

  beforeAll(async () => {
    await initDb();
    db = getDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbd_export_cleanup_test_'));
    allowedRoot = path.join(tempDir, 'allowed_root');
    outsideRoot = path.join(tempDir, 'outside_root');
    fs.mkdirSync(allowedRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });

    service = new PreservedBrowserDataService(db, [allowedRoot]);
  });

  afterEach(() => {
    db.exec(`DELETE FROM preserved_browser_data;`);
  });

  describe('Export Preserved Data', () => {
    it('successfully exports preserved data into a zip archive with manifest and data files', () => {
      const profileDir = path.join(allowedRoot, 'profile_1');
      fs.mkdirSync(path.join(profileDir, 'storage'), { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'storage', 'cookies.sqlite'), 'mock cookies sqlite content');
      fs.writeFileSync(path.join(profileDir, 'prefs.json'), JSON.stringify({ 'network.proxy': 'socks5' }));

      const record = service.preserveProfileData({
        profileId: 'p-export-1',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      const zipPath = path.join(allowedRoot, 'exports', 'profile_1_export.zip');
      const exportResult = service.exportPreservedData(record.id, zipPath, tenantAContext);

      expect(exportResult.registryId).toBe(record.id);
      expect(exportResult.digest).toBe(record.data_digest);
      expect(fs.existsSync(zipPath)).toBe(true);

      // Verify zip contents
      const zip = new AdmZip(zipPath);
      const manifestEntry = zip.getEntry('manifest.json');
      expect(manifestEntry).not.toBeNull();
      const manifest = JSON.parse(manifestEntry!.getData().toString('utf-8'));
      expect(manifest.id).toBe(record.id);
      expect(manifest.data_digest).toBe(record.data_digest);

      const cookieEntry = zip.getEntry('data/storage/cookies.sqlite');
      expect(cookieEntry).not.toBeNull();
      expect(cookieEntry!.getData().toString('utf-8')).toBe('mock cookies sqlite content');
    });

    it('denies export attempt from another tenant (cross-tenant denial)', () => {
      const profileDir = path.join(allowedRoot, 'profile_cross_tenant');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'data.txt'), 'secret');

      const record = service.preserveProfileData({
        profileId: 'p-export-cross',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      const zipPath = path.join(allowedRoot, 'exports', 'cross_tenant.zip');

      expect(() => {
        service.exportPreservedData(record.id, zipPath, tenantBContext);
      }).toThrow(/Tenant mismatch/);
    });

    it('rejects target zip paths attempting path traversal outside allowed roots', () => {
      const profileDir = path.join(allowedRoot, 'profile_traversal');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'data.txt'), 'data');

      const record = service.preserveProfileData({
        profileId: 'p-export-trav',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      // Relative traversal
      expect(() => {
        service.exportPreservedData(record.id, `${allowedRoot}/../outside.zip`, tenantAContext);
      }).toThrow(/Directory traversal/);
      // Absolute path outside allowed root
      expect(() => {
        service.exportPreservedData(record.id, path.join(outsideRoot, 'outside.zip'), tenantAContext);
      }).toThrow(/outside of allowed roots/);
    });

    it('detects digest mismatch if data on disk was modified before export', () => {
      const profileDir = path.join(allowedRoot, 'profile_tampered');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'file.txt'), 'original content');

      const record = service.preserveProfileData({
        profileId: 'p-export-tamper',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      // Modify file behind the scenes
      fs.writeFileSync(path.join(profileDir, 'file.txt'), 'tampered content');

      const zipPath = path.join(allowedRoot, 'exports', 'tampered.zip');
      expect(() => {
        service.exportPreservedData(record.id, zipPath, tenantAContext);
      }).toThrow(/Preserved data digest mismatch/);
    });
  });

  describe('Restore Preserved Data', () => {
    it('restores preserved data to target directory and verifies checksum integrity', () => {
      const profileDir = path.join(allowedRoot, 'profile_source_restore');
      fs.mkdirSync(path.join(profileDir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'nested', 'state.bin'), 'state-payload-binary');

      const record = service.preserveProfileData({
        profileId: 'p-restore-1',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      const restoreTarget = path.join(allowedRoot, 'restored_profile_1');
      const restored = service.restorePreservedData(record.id, restoreTarget, tenantAContext);

      expect(restored.status).toBe('restored');
      expect(fs.existsSync(path.join(restoreTarget, 'nested', 'state.bin'))).toBe(true);
      expect(fs.readFileSync(path.join(restoreTarget, 'nested', 'state.bin'), 'utf-8')).toBe('state-payload-binary');

      const journal = JSON.parse(restored.journal_json);
      expect(journal[journal.length - 1].action).toBe('restore_data');
    });

    it('rejects restore to non-empty directory or outside allowed root', () => {
      const profileDir = path.join(allowedRoot, 'profile_src_blocked');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'file.txt'), 'file');

      const record = service.preserveProfileData({
        profileId: 'p-restore-blocked',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      const nonEmptyTarget = path.join(allowedRoot, 'non_empty_dir');
      fs.mkdirSync(nonEmptyTarget, { recursive: true });
      fs.writeFileSync(path.join(nonEmptyTarget, 'existing.txt'), 'exists');

      expect(() => {
        service.restorePreservedData(record.id, nonEmptyTarget, tenantAContext);
      }).toThrow(/not empty/);

      expect(() => {
        service.restorePreservedData(record.id, path.join(outsideRoot, 'outside_target'), tenantAContext);
      }).toThrow(/outside of allowed canonical roots/);
    });

    it('denies restore across tenants', () => {
      const profileDir = path.join(allowedRoot, 'profile_tenant_iso');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'file.txt'), 'file');

      const record = service.preserveProfileData({
        profileId: 'p-restore-iso',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      const target = path.join(allowedRoot, 'target_iso');
      expect(() => {
        service.restorePreservedData(record.id, target, tenantBContext);
      }).toThrow(/Tenant mismatch/);
    });
  });

  describe('Cleanup and Purge of Preserved Data', () => {
    it('requires exact typed confirmation phrase matching registry ID and digest', () => {
      const profileDir = path.join(allowedRoot, 'profile_clean_test');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'data.log'), 'data log');

      const record = service.preserveProfileData({
        profileId: 'p-clean-exact',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      // Wrong phrase
      expect(() => {
        service.cleanupPreservedData(
          record.id,
          record.data_digest,
          'DELETE',
          tenantAContext
        );
      }).toThrow(/Confirmation mismatch/);

      // Stale/wrong digest
      expect(() => {
        service.cleanupPreservedData(
          record.id,
          'stale_digest_1111',
          `PERMANENTLY DELETE ${record.id}`,
          tenantAContext
        );
      }).toThrow(/Digest mismatch/);

      // Correct cleanup using CONFIRM_PURGE_<id> format
      const purged = service.cleanupPreservedData(
        record.id,
        record.data_digest,
        `CONFIRM_PURGE_${record.id}`,
        tenantAContext
      );

      expect(purged.status).toBe('purged');
      expect(purged.purged_at).toBeGreaterThan(0);
      expect(fs.existsSync(profileDir)).toBe(false);

      // Cannot export or restore once purged
      expect(() => {
        service.exportPreservedData(record.id, path.join(allowedRoot, 'exports', 'dummy.zip'), tenantAContext);
      }).toThrow(/Cannot export purged/);

      expect(() => {
        service.restorePreservedData(record.id, path.join(allowedRoot, 'dummy_restore'), tenantAContext);
      }).toThrow(/Cannot restore purged/);
    });

    it('allows admin role to perform authorized cleanup with correct digest and confirmation', () => {
      const profileDir = path.join(allowedRoot, 'profile_admin_clean');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'file.json'), '{}');

      const record = service.preserveProfileData({
        profileId: 'p-clean-admin',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      const cleaned = service.cleanupPreservedData({
        registryId: record.id,
        expectedDigest: record.data_digest,
        typedConfirmation: `PERMANENTLY DELETE ${record.id}`,
        securityContext: adminContext,
      });

      expect(cleaned.status).toBe('purged');
    });

    it('guarantees indefinite preservation by default when no cleanup is called', () => {
      const profileDir = path.join(allowedRoot, 'profile_indefinite');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'valuable_data.txt'), 'never delete unless confirmed');

      const record = service.preserveProfileData({
        profileId: 'p-indefinite',
        ownerId: tenantAContext.ownerId,
        tenantId: tenantAContext.tenantId,
        canonicalRoot: profileDir,
      });

      // Query row after arbitrary operations
      const fetched = service.getById(record.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.status).toBe('preserved');
      expect(fetched?.purged_at).toBeNull();
      expect(fs.existsSync(profileDir)).toBe(true);
    });
  });
});
