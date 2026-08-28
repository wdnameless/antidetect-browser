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

    CREATE TABLE IF NOT EXISTS teams (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      owner_device_id TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id     TEXT NOT NULL,
      member_id   TEXT NOT NULL,
      email       TEXT,
      role        TEXT NOT NULL CHECK (role IN ('owner','member')),
      permissions TEXT, -- JSON: {can_run_profiles,can_add_profiles,can_remove_profiles,can_invite}
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
      invite_code_hash TEXT,
      key_blob    TEXT,
      joined_at   INTEGER,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (team_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS team_bundles_meta (
      team_id    TEXT NOT NULL,
      bundle_id  TEXT NOT NULL,
      device_id  TEXT,
      version    INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, bundle_id)
    );

    CREATE TABLE IF NOT EXISTS team_profiles (
      team_id   TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      added_by  TEXT,
      added_at  INTEGER NOT NULL,
      PRIMARY KEY (team_id, user_id)
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
