// Syncer API (Sprint 3): sync sessions, tiling, hot join/leave.
// Chromium-only: Firefox/Camoufox profiles get code:"UNSUPPORTED".
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as syncer from '../../syncer/actionSyncer';
import { tileSession, type TileLayout } from '../../syncer/windowTiler';

const router = Router();

function fail(res: Response, r: { ok: false; code: string; msg: string }): void {
  const status = r.code === 'NOT_FOUND' ? 404 : 400;
  res.status(status).json({ code: r.code, msg: r.msg, data: {} });
}

router.get('/api/v1/sync/sessions', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { list: syncer.listActiveSessions() } });
});

router.post('/api/v1/sync/sessions', async (req: Request, res: Response) => {
  const parsed = z
    .object({ profile_ids: z.array(z.string()).min(2).max(16) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'profile_ids (2..16) required', data: {} });
    return;
  }
  try {
    const r = await syncer.createSession(parsed.data.profile_ids);
    if (!r.ok) return fail(res, r);
    res.json({ code: 0, msg: 'success', data: r.data });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

router.post('/api/v1/sync/sessions/:id/stop', async (req: Request, res: Response) => {
  const r = await syncer.stopSession(String(req.params.id));
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/sync/sessions/:id/join', async (req: Request, res: Response) => {
  const parsed = z.object({ profile_id: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'profile_id required', data: {} });
    return;
  }
  const r = await syncer.joinSession(String(req.params.id), parsed.data.profile_id);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/sync/sessions/:id/leave', async (req: Request, res: Response) => {
  const parsed = z.object({ profile_id: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'profile_id required', data: {} });
    return;
  }
  const r = await syncer.leaveSession(String(req.params.id), parsed.data.profile_id);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/sync/tile', async (req: Request, res: Response) => {
  const parsed = z
    .object({
      session_id: z.string().min(1),
      layout: z.enum(['2x2', '3x3', 'auto']).default('auto'),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'session_id and layout (2x2|3x3|auto) required', data: {} });
    return;
  }
  const info = syncer.getSession(parsed.data.session_id);
  if (!info || info.status !== 'active') {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'active session not found', data: {} });
    return;
  }
  try {
    const r = await tileSession(info.members, parsed.data.layout as TileLayout);
    res.json({ code: 0, msg: 'success', data: r });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

export default router;