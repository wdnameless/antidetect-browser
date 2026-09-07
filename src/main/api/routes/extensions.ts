import { Router } from 'express';
import { z } from 'zod';
import * as em from '../../extensions/extensionManager';
import { installFromWebStore, WebStoreError } from '../../extensions/webstore';
import { getDb } from '../../db';

const router = Router();

const importSchema = z.object({ name: z.string(), path: z.string() });
router.post('/api/v1/extension/import', (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  try {
    const id = em.importExtension(parsed.data.name, parsed.data.path);
    res.json({ code: 0, msg: 'success', data: { extension_id: id } });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

const installSchema = z.object({
  url: z.string().optional(),
  id: z.string().optional(),
  path: z.string().optional(),
}).refine((data) => !!(data.url || data.id || data.path), {
  message: 'Must provide url, id, or path',
});

router.post('/api/v1/extension/install', async (req, res) => {
  const parsed = installSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: -1, msg: 'INVALID_INPUT', error: 'INVALID_INPUT', details: parsed.error.flatten() });
    return;
  }
  const target = parsed.data.url || parsed.data.id || parsed.data.path || '';
  try {
    const result = await installFromWebStore(target);
    res.json({
      code: 0,
      msg: 'success',
      data: {
        extension_id: result.id,
        name: result.name,
        version: result.version,
        reused: result.reused,
      },
    });
  } catch (err) {
    if (err instanceof WebStoreError) {
      let statusCode = 400;
      if (err.code === 'NOT_FOUND') statusCode = 404;
      else if (err.code === 'FETCH_ERROR') statusCode = 502;
      res.status(statusCode).json({ code: -1, msg: err.message, error: err.code });
      return;
    }
    res.status(500).json({ code: -1, msg: (err as Error).message, error: 'INTERNAL_ERROR' });
  }
});

router.get('/api/v1/extension/list', (_req, res) => {
  const list = em.listExtensions().map((e) => ({
    extension_id: e.id,
    name: e.name,
    path: e.path,
    version: e.version,
    enabled: !!e.enabled,
  }));
  res.json({ code: 0, msg: 'success', data: { list, total: list.length } });
});

const deleteSchema = z.object({ extension_id: z.string() });
router.post('/api/v1/extension/delete', (req, res) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const ok = em.deleteExtension(parsed.data.extension_id);
  res.json(ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'extension not found', data: {} });
});

const bindSchema = z.object({ user_id: z.string(), extension_ids: z.array(z.string()) });
router.post('/api/v1/browser-profile/extensions/bind', (req, res) => {
  const parsed = bindSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const db = getDb();
  const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(parsed.data.user_id);
  if (!profile) {
    res.json({ code: -1, msg: 'profile not found', data: {} });
    return;
  }
  em.bindExtensions(parsed.data.user_id, parsed.data.extension_ids);
  res.json({ code: 0, msg: 'success', data: { count: parsed.data.extension_ids.length } });
});

router.get('/api/v1/browser-profile/extensions', (req, res) => {
  const userId = String(req.query.user_id || '');
  const ids = em.getProfileExtensionIds(userId);
  res.json({ code: 0, msg: 'success', data: { extension_ids: ids } });
});

export default router;
