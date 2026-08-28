// Account Vault API (Sprint 2.1). List responses mask secrets; plaintext is
// exposed only via the dedicated reveal endpoint. Zod validates every body.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as vault from '../../vault/accountVault';

const router = Router({ mergeParams: true });

const entrySchema = z.object({
  label: z.string().max(200).optional(),
  login: z.string().max(320).optional(),
  password: z.string().max(2000).optional(),
  totp_secret: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
});

function fail(res: Response, r: { ok: false; code: string; msg: string }): void {
  const status = r.code === 'NOT_FOUND' ? 404 : r.code === 'INVALID_FIELD' ? 400 : 400;
  res.status(status).json({ code: r.code, msg: r.msg, data: {} });
}

// NOTE: mounted at /api/v1/accounts/:profileId (see server.ts wiring).
router.get('/api/v1/accounts/:profileId', (req: Request, res: Response) => {
  const r = vault.listEntries(String(req.params.profileId));
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: { list: r.data } });
});

router.post('/api/v1/accounts/:profileId', (req: Request, res: Response) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  const r = vault.createEntry(String(req.params.profileId), parsed.data);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/accounts/:profileId/:entryId/update', (req: Request, res: Response) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  const r = vault.updateEntry(String(req.params.profileId), String(req.params.entryId), parsed.data);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/accounts/:profileId/:entryId/delete', (req: Request, res: Response) => {
  const r = vault.deleteEntry(String(req.params.profileId), String(req.params.entryId));
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.get('/api/v1/accounts/:profileId/:entryId/reveal', (req: Request, res: Response) => {
  const field = String(req.query.field || '');
  const r = vault.revealEntry(String(req.params.profileId), String(req.params.entryId), field);
  if (!r.ok) return fail(res, r);
  res.json({ code: 0, msg: 'success', data: r.data });
});

export default router;