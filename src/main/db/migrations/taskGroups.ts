import type { Database } from '../index';

function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  const cols = db.prepare('PRAGMA table_info(' + table + ')').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + ddl);
  }
}

export function migrateTaskGroups(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      script_id TEXT NOT NULL,
      profile_ids TEXT NOT NULL,
      active_session_cap INTEGER NOT NULL DEFAULT 1,
      per_task_timeout_ms INTEGER NOT NULL DEFAULT 300000,
      repeat_count INTEGER NOT NULL DEFAULT 0,
      randomize_profile_order INTEGER NOT NULL DEFAULT 0,
      time_window_cron TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      uuid TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      attempts INTEGER NOT NULL DEFAULT 0,
      repeat_count INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER NOT NULL DEFAULT 60000,
      next_run_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      FOREIGN KEY (group_id) REFERENCES task_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      task_uuid TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'working',
      log_tail TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      FOREIGN KEY (task_uuid) REFERENCES tasks(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_uuid TEXT NOT NULL,
      run_id TEXT,
      line TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_group_id ON tasks(group_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_task_runs_task_uuid ON task_runs(task_uuid);
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_uuid ON task_logs(task_uuid);
  `);

  ensureColumn(db, 'task_groups', 'active_session_cap', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'task_groups', 'per_task_timeout_ms', 'INTEGER NOT NULL DEFAULT 300000');
  ensureColumn(db, 'task_groups', 'repeat_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'task_groups', 'randomize_profile_order', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'task_groups', 'time_window_cron', 'TEXT');
  ensureColumn(db, 'tasks', 'script_id', 'TEXT');
  ensureColumn(db, 'tasks', 'repeat_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'tasks', 'timeout_ms', 'INTEGER NOT NULL DEFAULT 60000');
  ensureColumn(db, 'tasks', 'next_run_at', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'tasks', 'finished_at', 'INTEGER');
  ensureColumn(db, 'tasks', 'error', 'TEXT');
}
