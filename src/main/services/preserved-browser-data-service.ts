import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Database } from '../db';

export interface PreservedBrowserDataRow {
  id: string;
  profile_id: string;
  owner_id: string;
  tenant_id: string;
  engine: string;
  canonical_root: string;
  data_digest: string;
  inventory_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
  purged_at: number | null;
  status: 'preserved' | 'quarantined' | 'purged' | 'restored';
  journal_json: string;
}

export interface PreserveProfileDataOptions {
  id?: string;
  profileId: string;
  ownerId: string;
  tenantId: string;
  engine?: string;
  canonicalRoot: string;
  inventory?: Record<string, unknown>;
  journalNote?: string;
}

export interface SecurityContext {
  ownerId: string;
  tenantId: string;
  roles?: string[];
  recentAuthTime?: number; // timestamp ms
}

export interface CleanupOptions {
  registryId: string;
  expectedDigest: string;
  typedConfirmation: string; // e.g. "PERMANENTLY DELETE <registryId>"
  securityContext: SecurityContext;
}

export interface JournalEntry {
  timestamp: number;
  action: string;
  actor: { ownerId: string; tenantId: string };
  details?: Record<string, unknown>;
}

export class PreservedBrowserDataService {
  private db: Database;
  private allowedRoots: string[];

  constructor(db: Database, allowedRoots: string[] = []) {
    this.db = db;
    this.allowedRoots = allowedRoots.map((r) => path.resolve(r));
  }

  /**
   * Computes deterministic SHA-256 digest over a directory or file recursively.
   */
  public computeDirectoryDigest(targetPath: string): string {
    const resolvedPath = path.resolve(targetPath);
    if (!fs.existsSync(resolvedPath)) {
      return createHash('sha256').update('').digest('hex');
    }

    const stat = fs.lstatSync(resolvedPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlinks or reparse points are forbidden: ${targetPath}`);
    }

    const hash = createHash('sha256');

    if (!stat.isDirectory()) {
      const content = fs.readFileSync(resolvedPath);
      hash.update(`file:${path.basename(resolvedPath)}:${content.length}:`);
      hash.update(content);
      return hash.digest('hex');
    }

    const entries: { relPath: string; isDir: boolean; size: number; contentHash?: string }[] = [];

    const walk = (currentDir: string, baseDir: string) => {
      const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });
      // Sort entries for deterministic walk
      dirEntries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of dirEntries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        const lstat = fs.lstatSync(fullPath);

        if (lstat.isSymbolicLink()) {
          throw new Error(`Symlink or reparse point detected at ${fullPath}`);
        }

        if (lstat.isDirectory()) {
          entries.push({ relPath, isDir: true, size: 0 });
          walk(fullPath, baseDir);
        } else if (lstat.isFile()) {
          const fileContent = fs.readFileSync(fullPath);
          const fileHash = createHash('sha256').update(fileContent).digest('hex');
          entries.push({ relPath, isDir: false, size: lstat.size, contentHash: fileHash });
        }
      }
    };

    walk(resolvedPath, resolvedPath);

    // Sort entries by relative path
    entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

    for (const item of entries) {
      if (item.isDir) {
        hash.update(`dir:${item.relPath}\n`);
      } else {
        hash.update(`file:${item.relPath}:${item.size}:${item.contentHash}\n`);
      }
    }

    return hash.digest('hex');
  }

  /**
   * Validate that the path stays within allowed canonical roots and doesn't traverse or cross symlinks.
   */
  public assertCanonicalRootSafe(targetPath: string): string {
    const resolved = path.resolve(targetPath);

    // If allowed roots configured, enforce membership
    if (this.allowedRoots.length > 0) {
      const isAllowed = this.allowedRoots.some((allowed) => {
        const rel = path.relative(allowed, resolved);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      });
      if (!isAllowed) {
        throw new Error(`Path ${resolved} is outside of allowed canonical roots`);
      }
    }

    // Check for traversal or non-normalized paths
    if (targetPath.includes('..')) {
      throw new Error(`Directory traversal in path rejected: ${targetPath}`);
    }

    // If path exists on disk, check for symlinks in path ancestors
    if (fs.existsSync(resolved)) {
      const stat = fs.lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        throw new Error(`Reparse point or symlink detected at target: ${resolved}`);
      }
    }

    return resolved;
  }

  /**
   * Register or update preserved browser data for a profile.
   */
  public preserveProfileData(options: PreserveProfileDataOptions): PreservedBrowserDataRow {
    const {
      id = `pbd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      profileId,
      ownerId,
      tenantId,
      engine = 'camoufox',
      canonicalRoot,
      inventory = {},
      journalNote = 'Initial preservation registration',
    } = options;

    if (!profileId || !ownerId || !tenantId || !canonicalRoot) {
      throw new Error('profileId, ownerId, tenantId, and canonicalRoot are required');
    }

    const safeCanonicalRoot = this.assertCanonicalRootSafe(canonicalRoot);
    const dataDigest = this.computeDirectoryDigest(safeCanonicalRoot);
    const now = Date.now();

    const existing = this.getByProfileId(profileId);

    const initialJournal: JournalEntry[] = [
      {
        timestamp: now,
        action: 'preserve',
        actor: { ownerId, tenantId },
        details: { note: journalNote, dataDigest },
      },
    ];

    if (existing) {
      // Isolation check
      this.assertTenantIsolation(existing, { ownerId, tenantId });

      const currentJournal: JournalEntry[] = JSON.parse(existing.journal_json || '[]');
      currentJournal.push({
        timestamp: now,
        action: 'update_preservation',
        actor: { ownerId, tenantId },
        details: { note: journalNote, previousDigest: existing.data_digest, newDigest: dataDigest },
      });

      const nextRevision = existing.revision + 1;
      const stmt = this.db.prepare(`
        UPDATE preserved_browser_data
        SET canonical_root = ?,
            data_digest = ?,
            inventory_json = ?,
            revision = ?,
            updated_at = ?,
            status = 'preserved',
            journal_json = ?
        WHERE id = ?
      `);

      stmt.run(
        safeCanonicalRoot,
        dataDigest,
        JSON.stringify(inventory),
        nextRevision,
        now,
        JSON.stringify(currentJournal),
        existing.id,
      );

      return this.getById(existing.id)!;
    }

    const stmt = this.db.prepare(`
      INSERT INTO preserved_browser_data (
        id, profile_id, owner_id, tenant_id, engine,
        canonical_root, data_digest, inventory_json, revision,
        created_at, updated_at, status, journal_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      profileId,
      ownerId,
      tenantId,
      engine,
      safeCanonicalRoot,
      dataDigest,
      JSON.stringify(inventory),
      1,
      now,
      now,
      'preserved',
      JSON.stringify(initialJournal),
    );

    return this.getById(id)!;
  }

  public getById(id: string): PreservedBrowserDataRow | null {
    const row = this.db.prepare(`SELECT * FROM preserved_browser_data WHERE id = ?`).get(id) as PreservedBrowserDataRow | undefined;
    return row || null;
  }

  public getByProfileId(profileId: string): PreservedBrowserDataRow | null {
    const row = this.db.prepare(`SELECT * FROM preserved_browser_data WHERE profile_id = ?`).get(profileId) as PreservedBrowserDataRow | undefined;
    return row || null;
  }

  public listByTenant(tenantId: string, ownerId?: string): PreservedBrowserDataRow[] {
    if (ownerId) {
      return this.db.prepare(`
        SELECT * FROM preserved_browser_data
        WHERE tenant_id = ? AND owner_id = ?
        ORDER BY created_at DESC
      `).all(tenantId, ownerId) as PreservedBrowserDataRow[];
    }
    return this.db.prepare(`
      SELECT * FROM preserved_browser_data
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(tenantId) as PreservedBrowserDataRow[];
  }

  /**
   * Verify tenant and owner boundaries.
   */
  public assertTenantIsolation(record: PreservedBrowserDataRow, context: SecurityContext): void {
    if (record.tenant_id !== context.tenantId) {
      throw new Error(`Tenant mismatch: Access denied to preserved browser data.`);
    }
    if (context.roles?.includes('admin') || context.roles?.includes('release-maintainer')) {
      return;
    }
    if (record.owner_id !== context.ownerId) {
      throw new Error(`Owner mismatch: Access denied to preserved browser data.`);
    }
  }

  /**
   * Explicit typed-confirmation cleanup of preserved browser data.
   */
  public cleanupPreservedData(options: CleanupOptions): PreservedBrowserDataRow {
    const { registryId, expectedDigest, typedConfirmation, securityContext } = options;

    if (!registryId) {
      throw new Error('registryId is required');
    }

    const record = this.getById(registryId);
    if (!record) {
      throw new Error(`Preserved browser data not found for id: ${registryId}`);
    }

    this.assertTenantIsolation(record, securityContext);

    const requiredConfirmation = `PERMANENTLY DELETE ${registryId}`;
    if (typedConfirmation !== requiredConfirmation) {
      throw new Error(`Confirmation mismatch. Expected "${requiredConfirmation}", got "${typedConfirmation}"`);
    }

    if (record.data_digest !== expectedDigest) {
      throw new Error(`Digest mismatch. Expected "${expectedDigest}", actual "${record.data_digest}"`);
    }

    const now = Date.now();
    const journal: JournalEntry[] = JSON.parse(record.journal_json || '[]');
    journal.push({
      timestamp: now,
      action: 'cleanup_purged',
      actor: { ownerId: securityContext.ownerId, tenantId: securityContext.tenantId },
      details: { purgedRoot: record.canonical_root, digest: record.data_digest },
    });

    const updateStmt = this.db.prepare(`
      UPDATE preserved_browser_data
      SET status = 'purged',
          purged_at = ?,
          updated_at = ?,
          revision = revision + 1,
          journal_json = ?
      WHERE id = ?
    `);

    updateStmt.run(now, now, JSON.stringify(journal), registryId);

    // If directory exists on disk, safely remove
    if (fs.existsSync(record.canonical_root)) {
      this.assertCanonicalRootSafe(record.canonical_root);
      fs.rmSync(record.canonical_root, { recursive: true, force: true });
    }

    return this.getById(registryId)!;
  }
}
