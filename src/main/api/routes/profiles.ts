// Profiles export API (Sprint 2.5): CSV of the visible profile pool.
// Escaping parity with the import parser (api/routes/batch.ts parseCsv).
import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import * as pm from '../../profiles/profileManager';
import { createTemporaryProfile, getTemporaryProfile } from '../../profiles/temporaryRegistry';
import * as tags from '../../tags/tagManager';
import { toCsv } from '../../util/csv';

const router = Router();

router.get('/api/v1/profiles/export-csv', (_req: Request, res: Response) => {
  // All visible (non-deleted) profiles — no pagination on export.
  const { list } = pm.listProfiles(1, 100000, null, null, null, null);
  const tagMap = tags.tagsForProfiles(list.map((p) => p.user_id));
  const db = getDb();
  const rows = list.map((p) => {
    const created = (
      db.prepare('SELECT created_at FROM profiles WHERE id = ?').get(p.user_id) as
        | { created_at: number }
        | undefined
    )?.created_at;
    return [
      p.user_id,
      p.name ?? '',
      p.platform ?? 'windows',
      p.proxy_host ? `${p.proxy_type ?? 'http'}://${p.proxy_host}:${p.proxy_port ?? 0}` : '',
      p.group_id ?? '',
      (tagMap.get(p.user_id) ?? []).map((t) => t.name).join('|'),
      created ? new Date(created).toISOString() : '',
    ];
  });
  const csv = toCsv(
    ['id', 'name', 'platform', 'proxy', 'group', 'tags', 'created_at'],
    rows
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="antidetect-profiles-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
});

function handleCreateTemporaryProfile(req: Request, res: Response) {
  try {
    const body = req.body || {};
    const descriptor = createTemporaryProfile(body);
    return res.json({
      code: 0,
      msg: 'success',
      data: {
        profile_id: descriptor.id,
        name: descriptor.name,
        temporary: true,
        created_at: descriptor.createdAt,
        user_data_dir: descriptor.userDataDir,
        headless: !!descriptor.headless,
        start_urls: descriptor.startUrls,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create temporary profile';
    return res.status(500).json({
      code: -1,
      msg,
    });
  }
}

router.post('/api/v1/profiles/temporary', handleCreateTemporaryProfile);
router.post('/profiles/temporary', handleCreateTemporaryProfile);

export default router;