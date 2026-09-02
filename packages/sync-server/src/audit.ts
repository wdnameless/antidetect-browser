import { Database } from 'sql.js';

export interface AuditEntry {
  workspaceId: string;
  actor: string;
  action: string;
  bundleId?: string | null;
  outcome: 'success' | 'failure' | 'denied';
  details?: Record<string, unknown> | string | null;
  timestamp?: number;
}

export function logAudit(db: Database, entry: AuditEntry): void {
  const ts = entry.timestamp ?? Date.now();
  const detailsStr = entry.details
    ? typeof entry.details === 'string'
      ? entry.details
      : JSON.stringify(entry.details)
    : null;

  const stmt = db.prepare(`
    INSERT INTO audit_logs (workspace_id, actor, action, bundle_id, outcome, details, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    entry.workspaceId,
    entry.actor,
    entry.action,
    entry.bundleId ?? null,
    entry.outcome,
    detailsStr,
    ts,
  ]);
  stmt.free();
}

export function queryAudit(
  db: Database,
  workspaceId: string,
  options?: {
    limit?: number;
    since?: number;
    actor?: string;
    action?: string;
  }
): Array<{
  id: number;
  workspace_id: string;
  actor: string;
  action: string;
  bundle_id: string | null;
  outcome: string;
  details: string | null;
  timestamp: number;
}> {
  let sql = 'SELECT * FROM audit_logs WHERE workspace_id = ?';
  const params: (string | number)[] = [workspaceId];

  if (options?.since) {
    sql += ' AND timestamp > ?';
    params.push(options.since);
  }
  if (options?.actor) {
    sql += ' AND actor = ?';
    params.push(options.actor);
  }
  if (options?.action) {
    sql += ' AND action = ?';
    params.push(options.action);
  }

  sql += ' ORDER BY timestamp DESC';

  const limit = options?.limit ?? 100;
  sql += ' LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: Array<{
    id: number;
    workspace_id: string;
    actor: string;
    action: string;
    bundle_id: string | null;
    outcome: string;
    details: string | null;
    timestamp: number;
  }> = [];

  while (stmt.step()) {
    rows.push(stmt.getAsObject() as any);
  }
  stmt.free();

  return rows;
}
