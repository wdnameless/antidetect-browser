import { getDb } from '../db';
import { FlowDocument, FlowDocumentSchema } from './types';
import { validateFlow } from './validator';
import { compileFlowToScript } from './compiler';
import { createTaskGroup, getTaskGroup } from '../scripts/taskGroups';
import { getTaskQueueCoordinator } from '../scripts/taskQueue';

export interface FlowDbRow {
  id: string;
  name: string;
  description: string | null;
  document_json: string;
  compiled_code: string | null;
  created_at: number;
  updated_at: number;
}

export function ensureFlowsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS flows (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      document_json TEXT NOT NULL,
      compiled_code TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
}

export function listFlows(): Array<{ id: string; name: string; description: string | null; created_at: number; updated_at: number }> {
  ensureFlowsTable();
  const db = getDb();
  const rows = db.prepare('SELECT id, name, description, created_at, updated_at FROM flows ORDER BY updated_at DESC').all() as Array<{
    id: string;
    name: string;
    description: string | null;
    created_at: number;
    updated_at: number;
  }>;
  return rows;
}

export function getFlow(id: string): FlowDocument | null {
  ensureFlowsTable();
  const db = getDb();
  const row = db.prepare('SELECT document_json FROM flows WHERE id = ?').get(id) as { document_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.document_json) as FlowDocument;
  } catch {
    return null;
  }
}

export function saveFlow(doc: FlowDocument): { flow: FlowDocument; compiled: string } {
  ensureFlowsTable();
  const validation = validateFlow(doc);
  if (!validation.valid) {
    throw Object.assign(new Error(`Flow validation failed: ${validation.errors.map((e) => e.message).join('; ')}`), {
      validationErrors: validation.errors,
    });
  }
  const now = Date.now();
  const docToSave: FlowDocument = {
    ...doc,
    created_at: doc.created_at ?? now,
    updated_at: now,
  };
  const compiled = compileFlowToScript(docToSave);
  const db = getDb();
  const docJson = JSON.stringify(docToSave);
  db.prepare(`
    INSERT INTO flows (id, name, description, document_json, compiled_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      document_json = excluded.document_json,
      compiled_code = excluded.compiled_code,
      updated_at = excluded.updated_at
  `).run(
    docToSave.id,
    docToSave.name,
    docToSave.description ?? null,
    docJson,
    compiled,
    docToSave.created_at,
    docToSave.updated_at
  );

  // Sync / register as a script entry in the scripts table so task groups can execute it seamlessly by ID
  db.prepare(`
    INSERT INTO scripts (id, name, code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      code = excluded.code,
      updated_at = excluded.updated_at
  `).run(`flow:${docToSave.id}`, `[Flow] ${docToSave.name}`, compiled, docToSave.created_at, docToSave.updated_at);

  return { flow: docToSave, compiled };
}

export function deleteFlow(id: string): boolean {
  ensureFlowsTable();
  const db = getDb();
  const res = db.prepare('DELETE FROM flows WHERE id = ?').run(id);
  db.prepare('DELETE FROM scripts WHERE id = ?').run(`flow:${id}`);
  return res.changes > 0;
}

export function exportFlowJson(id: string): string {
  const flow = getFlow(id);
  if (!flow) throw new Error(`Flow not found: ${id}`);
  return JSON.stringify(flow, null, 2);
}

export function importFlowJson(rawJson: string | object): FlowDocument {
  const parsedObj = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const doc = FlowDocumentSchema.parse(parsedObj);
  const { flow } = saveFlow(doc);
  return flow;
}
export interface RunFlowOptions {
  flowId: string;
  profileIds: string[];
  concurrency?: number;
  trigger?: 'manual' | 'cron';
  cronSchedule?: string;
}

export function runFlowViaTaskGroup(opts: RunFlowOptions) {
  const flow = getFlow(opts.flowId);
  if (!flow) {
    throw new Error(`Flow not found: ${opts.flowId}`);
  }

  // Ensure flow is compiled & saved to scripts table
  saveFlow(flow);

  const scriptId = `flow:${flow.id}`;
  const group = createTaskGroup({
    name: `FlowRun: ${flow.name} (${Date.now()})`,
    script_id: scriptId,
    profile_ids: opts.profileIds,
    active_session_cap: opts.concurrency ?? 1,
    time_window_cron: opts.cronSchedule,
  });

  if (opts.trigger !== 'cron') {
    const coordinator = getTaskQueueCoordinator();
    coordinator.startGroup(group.id).catch(() => {});
  }

  return {
    flowId: flow.id,
    taskGroupId: group.id,
    group,
  };
}
