import { Router } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as pm from '../../profiles/profileManager';
import { getDb } from '../../db';
import { PROFILES_DIR } from '../../config';

const router = Router();

const batchCreateSchema = z.object({
  count: z.number().int().min(1).max(1000),
  name_prefix: z.string().optional(),
  proxy_ids: z.array(z.string()).optional(),
  device_id: z.string().optional(),
});
router.post('/api/v1/browser-profile/batch-create', (req, res) => {
  const parsed = batchCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  try {
    const ids = pm.batchCreateProfiles({
      count: parsed.data.count,
      namePrefix: parsed.data.name_prefix,
      proxyIds: parsed.data.proxy_ids,
      deviceId: parsed.data.device_id,
    });
    res.json({ code: 0, msg: 'success', data: { user_ids: ids, count: ids.length } });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

const batchDeleteSchema = z.object({ user_ids: z.array(z.string()) });
router.post('/api/v1/browser-profile/batch-delete', (req, res) => {
  const parsed = batchDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const db = getDb();
  let deleted = 0;
  for (const id of parsed.data.user_ids) {
    const r = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    if (r.changes > 0) {
      db.prepare('DELETE FROM profile_extensions WHERE profile_id = ?').run(id);
      try {
        fs.rmSync(path.join(PROFILES_DIR, id), { recursive: true, force: true });
      } catch {
        // ignore
      }
      deleted++;
    }
  }
  res.json({ code: 0, msg: 'success', data: { deleted } });
});

const batchBindSchema = z.object({ user_ids: z.array(z.string()), proxy_ids: z.array(z.string()) });
router.post('/api/v1/browser-profile/batch-bind-proxy', (req, res) => {
  const parsed = batchBindSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const { user_ids, proxy_ids } = parsed.data;
  if (!proxy_ids.length) {
    res.json({ code: -1, msg: 'proxy_ids is empty', data: {} });
    return;
  }
  const db = getDb();
  let updated = 0;
  for (let i = 0; i < user_ids.length; i++) {
    const proxyId = proxy_ids[i % proxy_ids.length];
    const r = db
      .prepare('UPDATE profiles SET proxy_id = ?, updated_at = ? WHERE id = ?')
      .run(proxyId, Date.now(), user_ids[i]);
    if (r.changes > 0) updated++;
  }
  res.json({ code: 0, msg: 'success', data: { updated } });
});

/** Minimal CSV parser with quoted-field support. */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

const importSchema = z.object({
  profiles: z.array(z.record(z.unknown())).optional(),
  csv: z.string().optional(),
});
router.post('/api/v1/browser-profile/import', (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  let rows: Array<Record<string, unknown>> = [];
  if (parsed.data.profiles) {
    rows = parsed.data.profiles;
  } else if (parsed.data.csv) {
    rows = parseCsv(parsed.data.csv);
  } else {
    res.json({ code: -1, msg: 'provide profiles[] or csv', data: {} });
    return;
  }
  try {
    const ids: string[] = [];
    for (const row of rows) {
      const name = typeof row.name === 'string' && row.name ? row.name : undefined;
      const timezone = typeof row.timezone === 'string' && row.timezone ? row.timezone : undefined;
      let proxy: pm.ProxyInput | undefined;
      if (row.proxy_host && row.proxy_type) {
        proxy = {
          type: String(row.proxy_type) as pm.ProxyType,
          host: String(row.proxy_host),
          port: Number(row.proxy_port ?? 0),
          username: row.proxy_user ? String(row.proxy_user) : undefined,
          password: row.proxy_pass ? String(row.proxy_pass) : undefined,
        };
      }
      const id = pm.createProfile({ name, timezone, proxy });
      ids.push(id);
    }
    res.json({ code: 0, msg: 'success', data: { user_ids: ids, count: ids.length } });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

export default router;
