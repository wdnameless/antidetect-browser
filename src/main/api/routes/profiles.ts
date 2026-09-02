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

/**
 * Additive OS/chip selection in profile create API.
 * Documented market distribution defaults: Windows 72%, macOS 28% (M-series 85%, Intel 15%).
 */
function handleCreateProfileWithOsChip(req: Request, res: Response) {
  try {
    const body = req.body || {};
    const {
      name,
      group_id,
      proxy_type,
      proxy_host,
      proxy_port,
      proxy_user,
      proxy_pass,
      user_agent,
      notes,
      tags: profileTags,
      options = {},
      fingerprint = {},
      os = null,
      chip = null,
    } = body;

    // Pass through os and chip selection if specified
    const mergedOptions = {
      ...options,
      ...(os ? { os } : {}),
      ...(chip ? { chip } : {}),
    };

    const mergedFingerprint = {
      ...fingerprint,
      ...(os ? { os, platform: os === 'macos' ? 'macos' : 'windows' } : {}),
      ...(chip ? { chip } : {}),
    };

    const proxy = (proxy_host && proxy_port) ? {
      type: proxy_type || 'http',
      host: proxy_host,
      port: Number(proxy_port),
      username: proxy_user,
      password: proxy_pass,
    } : undefined;

    const id = pm.createProfile({
      name,
      group_id,
      proxy,
      user_agent,
    });
    return res.json({
      code: 0,
      msg: 'success',
      data: {
        id,
        name,
        os: os || 'windows',
        chip: chip || (os === 'macos' ? 'M2' : null),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create profile';
    return res.status(500).json({ code: -1, msg });
  }
}

router.post('/api/v1/profiles', handleCreateProfileWithOsChip);
router.post('/profiles', handleCreateProfileWithOsChip);

export default router;