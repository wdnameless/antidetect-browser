import type { Database } from 'better-sqlite3';

export function migratePreservedBrowserData(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS preserved_browser_data (
      id              TEXT PRIMARY KEY,
      profile_id      TEXT NOT NULL,
      owner_id        TEXT NOT NULL,
      tenant_id       TEXT NOT NULL,
      engine          TEXT NOT NULL,
      canonical_root  TEXT NOT NULL,
      data_digest     TEXT NOT NULL,
      inventory_json  TEXT NOT NULL DEFAULT '{}',
      revision        INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      purged_at       INTEGER,
      status          TEXT NOT NULL DEFAULT 'preserved',
      journal_json    TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_preserved_data_profile ON preserved_browser_data(profile_id);
    CREATE INDEX IF NOT EXISTS idx_preserved_data_tenant ON preserved_browser_data(tenant_id, owner_id);
    CREATE INDEX IF NOT EXISTS idx_preserved_data_status ON preserved_browser_data(status);
  `);
}
