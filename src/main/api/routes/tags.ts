// Tags API (Sprint 2.3): CRUD, attach/detach, tag-aware profile list filter.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as tags from '../../tags/tagManager';

const router = Router();

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function fail(res: Response, r: { ok: false; code: string; msg: string }): void {
  const status = r.code === 'NOT_FOUND' ? 404 : 400;
  res.status(status).json({ code: r.code, msg: r.msg, data: {} });
}

router.get('/api/v1/tags', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { list: tags.listTags() } });
});

router.post('/api/v1/tags', (req: Request, res: Response) => {
  const parsed = z
    .object({ name: z.string().min(1).max(64), color: z.string().regex(COLOR_RE).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'name (1..64) and optional #rrggbb color required', data: {} });
    return;
  }
  const r = tags.createTag(parsed.data.name, parsed.data.color);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/tags/:id/update', (req: Request, res: Response) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(64).optional(),
      color: z.string().regex(COLOR_RE).nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid body', data: {} });
    return;
  }
  const r = tags.updateTag(String(req.params.id), { name: parsed.data.name, color: parsed.data.color });
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/tags/:id/delete', (req: Request, res: Response) => {
  const r = tags.deleteTag(String(req.params.id));
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/tags/:id/attach', (req: Request, res: Response) => {
  const parsed = z.object({ user_ids: z.array(z.string()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'user_ids required', data: {} });
    return;
  }
  const r = tags.attachTag(String(req.params.id), parsed.data.user_ids);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/tags/:id/detach', (req: Request, res: Response) => {
  const parsed = z.object({ user_ids: z.array(z.string()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'user_ids required', data: {} });
    return;
  }
  const r = tags.detachTag(String(req.params.id), parsed.data.user_ids);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.get('/api/v1/browser-profile/tags', (req: Request, res: Response) => {
  const id = String(req.query.user_id || '');
  if (!id) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'user_id is required', data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: { tags: tags.tagsForProfile(id) } });
});

export default router;