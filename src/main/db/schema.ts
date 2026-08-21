import type { Database } from './index';

/** Add a column to an existing table if it is missing (CREATE TABLE IF NOT EXISTS does not migrate). */
function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK (type IN ('http','https','socks5','ssh')),
      host        TEXT NOT NULL,
      port        INTEGER NOT NULL,
      username    TEXT,
      password    TEXT,
      private_key TEXT,
      country     TEXT,
      timezone    TEXT,
      status      TEXT DEFAULT 'unknown',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fingerprints (
      id          TEXT PRIMARY KEY,
      label       TEXT,
      seed        INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      platform    TEXT NOT NULL,
      config_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id             TEXT PRIMARY KEY,
      name           TEXT,
      group_id       TEXT REFERENCES groups(id),
      proxy_id       TEXT REFERENCES proxies(id),
      fingerprint_id TEXT REFERENCES fingerprints(id),
      device_id      TEXT REFERENCES devices(id),
      browser_type   TEXT DEFAULT 'chromium',
      user_agent     TEXT,
      timezone       TEXT,
      geolocation    TEXT,
      cookies_json   TEXT,
      start_urls     TEXT,
      status         TEXT DEFAULT 'closed',
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);

    CREATE TABLE IF NOT EXISTS extensions (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      path        TEXT NOT NULL,
      version     TEXT,
      enabled     INTEGER DEFAULT 1,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_extensions (
      profile_id   TEXT NOT NULL,
      extension_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, extension_id)
    );
  `);

  // Migrations for databases created before these columns existed.
  ensureColumn(db, 'proxies', 'private_key', 'TEXT');
  ensureColumn(db, 'proxies', 'timezone', 'TEXT');
  ensureColumn(db, 'proxies', 'latitude', 'REAL');
  ensureColumn(db, 'proxies', 'longitude', 'REAL');
  ensureColumn(db, 'profiles', 'browser_type', 'TEXT DEFAULT \'chromium\'');
  ensureColumn(db, 'profiles', 'mobile_model_id', 'TEXT');
}
