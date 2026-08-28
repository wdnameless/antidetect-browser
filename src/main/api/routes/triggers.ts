// Triggers API (Sprint 4.3): CRUD + enable/disable toggle.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as triggers from '../../scripts/triggerScheduler';

const router = Router();

router.get('/api/v1/triggers', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { list: triggers.listTriggers() } });
});

router.post('/api/v1/triggers', (req: Request, res: Response) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(200),
      script_id: z.string().min(1),
      type: z.enum(['schedule', 'event']),
      schedule: z.string().max(64).optional(),
      event: z.enum(['profile_started', 'profile_stopped']).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid body', data: {} });
    return;
  }
  const r = triggers.createTrigger({
    name: parsed.data.name,
    script_id: parsed.data.script_id,
    type: parsed.data.type,
    schedule: parsed.data.schedule,
    event: parsed.data.event,
  });
  if (!r.ok) {
    res.status(r.code === 'NOT_FOUND' ? 404 : 400).json({ code: r.code, msg: r.msg, data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/triggers/:id/update', (req: Request, res: Response) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(200).optional(),
      schedule: z.string().max(64).optional(),
      event: z.enum(['profile_started', 'profile_stopped']).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid body', data: {} });
    return;
  }
  const ok = triggers.updateTrigger(String(req.params.id), {
    name: parsed.data.name,
    schedule: parsed.data.schedule,
    event: parsed.data.event,
  });
  res.json(ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'update failed', data: {} });
});

router.post('/api/v1/triggers/:id/toggle', (req: Request, res: Response) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'enabled boolean required', data: {} });
    return;
  }
  const ok = triggers.setTriggerEnabled(String(req.params.id), parsed.data.enabled);
  res.json(
    ok
      ? { code: 0, msg: 'success', data: { enabled: parsed.data.enabled } }
      : { code: -1, msg: 'trigger not found', data: {} }
  );
});

router.post('/api/v1/triggers/:id/delete', (req: Request, res: Response) => {
  const ok = triggers.deleteTrigger(String(req.params.id));
  res.json(
    ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'trigger not found', data: {} }
  );
});

export default router;