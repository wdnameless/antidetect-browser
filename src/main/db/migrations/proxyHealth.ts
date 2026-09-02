import type { Database } from '../index';

export function migrateProxyHealth(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_usage (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      proxy_id TEXT NOT NULL,
      used_at INTEGER NOT NULL,
      resolved_country TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_proxy_usage_profile ON proxy_usage(profile_id);
    CREATE INDEX IF NOT EXISTS idx_proxy_usage_proxy ON proxy_usage(proxy_id);
    CREATE INDEX IF NOT EXISTS idx_proxy_usage_used_at ON proxy_usage(used_at);
  `);
}
