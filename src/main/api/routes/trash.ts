// Trash API (Sprint 2.4): list / restore / delete-forever.
import { Router, Request, Response } from 'express';
import * as pm from '../../profiles/profileManager';

const router = Router();

router.get('/api/v1/trash', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { list: pm.listTrash() } });
});

router.post('/api/v1/trash/:id/restore', (req: Request, res: Response) => {
  const ok = pm.restoreProfile(String(req.params.id));
  res.json(
    ok
      ? { code: 0, msg: 'success', data: { restored: true } }
      : { code: -1, msg: 'profile not found in trash', data: {} }
  );
});

router.post('/api/v1/trash/:id/delete', (req: Request, res: Response) => {
  const ok = pm.purgeProfile(String(req.params.id));
  res.json(
    ok
      ? { code: 0, msg: 'success', data: { deleted: true } }
      : { code: -1, msg: 'profile not found', data: {} }
  );
});

// REST-style alias (DELETE method) for programmatic clients.
router.delete('/api/v1/trash/:id', (req: Request, res: Response) => {
  const ok = pm.purgeProfile(String(req.params.id));
  res.json(
    ok
      ? { code: 0, msg: 'success', data: { deleted: true } }
      : { code: -1, msg: 'profile not found', data: {} }
  );
});

export default router;