import { Database } from 'sql.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db: Database) => {
      // Schema version tracking
      db.run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
      `);

      // Workspaces (also supports legacy team alias)
      db.run(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);

      // Members & Tokens: role in ('owner', 'editor', 'viewer')
      db.run(`
        CREATE TABLE IF NOT EXISTS members (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
          token TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
      `);

      // Versioned bundles: ciphertext stored as base64
      // Wire-format v1 compatible: supports id/bundle_id, workspace_id/team_id, device_id, ciphertext, nonce/iv, auth_tag, version, updated_at
      db.run(`
        CREATE TABLE IF NOT EXISTS bundles (
          id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          device_id TEXT,
          ciphertext TEXT NOT NULL,
          iv TEXT,
          auth_tag TEXT,
          version INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, id)
        );
      `);

      // Audit logs
      db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          bundle_id TEXT,
          outcome TEXT NOT NULL,
          details TEXT,
          timestamp INTEGER NOT NULL
        );
      `);

      // Indices
      db.run(`CREATE INDEX IF NOT EXISTS idx_members_workspace ON members(workspace_id);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_members_token ON members(token);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_bundles_lookup ON bundles(workspace_id, id);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_bundles_updated ON bundles(workspace_id, updated_at);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_logs(workspace_id, timestamp);`);
    },
  },
];

export function runMigrations(db: Database): void {
  // Ensure schema_migrations table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db.exec(`SELECT version FROM schema_migrations;`);
  const applied = new Set<number>();
  if (appliedRows.length > 0 && appliedRows[0].values) {
    for (const val of appliedRows[0].values) {
      if (typeof val[0] === 'number') {
        applied.add(val[0]);
      }
    }
  }

  for (const m of migrations) {
    if (!applied.has(m.version)) {
      m.up(db);
      const stmt = db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);`);
      stmt.run([m.version, m.name, Date.now()]);
      stmt.free();
    }
  }
}
