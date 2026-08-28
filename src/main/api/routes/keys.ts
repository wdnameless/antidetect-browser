// Global keys API (Sprint 4.2): list masks values; plaintext via reveal only.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as keys from '../../scripts/keyStore';

const router = Router();

router.get('/api/v1/keys', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { list: keys.listKeys() } });
});

router.post('/api/v1/keys', (req: Request, res: Response) => {
  const parsed = z
    .object({ key: z.string().min(1).max(128), value: z.string().min(1).max(65536) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'key and value are required', data: {} });
    return;
  }
  const r = keys.setKeyValue(parsed.data.key, parsed.data.value);
  if (!r.ok) {
    res.status(400).json({ code: r.code, msg: r.msg, data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/keys/:key/delete', (req: Request, res: Response) => {
  const r = keys.deleteKey(String(req.params.key));
  if (!r.ok) {
    res.status(404).json({ code: r.code, msg: r.msg, data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.get('/api/v1/keys/:key/reveal', (req: Request, res: Response) => {
  const r = keys.revealKeyValue(String(req.params.key));
  if (!r.ok) {
    res.status(404).json({ code: r.code, msg: r.msg, data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

export default router;