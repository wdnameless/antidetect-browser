// Licensing API router: activate/deactivate/query the license. No Pro gate —
// these endpoints ARE the gate for everything else.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as lic from '../../licensing/licenseManager';

const router = Router();

router.get('/api/v1/license/state', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: lic.getLicenseState() });
});

router.post('/api/v1/license/activate', (req: Request, res: Response) => {
  const parsed = z.object({ key: z.string().min(16).max(2000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_LICENSE', msg: 'license key required', data: {} });
    return;
  }
  const r = lic.activateLicense(parsed.data.key);
  if (!r.ok) {
    res.json({
      code: r.error ?? 'INVALID_LICENSE',
      msg: r.error === 'LICENSE_EXPIRED' ? 'license expired' : 'invalid license key',
      data: {},
    });
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.state });
});

router.post('/api/v1/license/deactivate', (_req: Request, res: Response) => {
  lic.deactivateLicense();
  res.json({ code: 0, msg: 'success', data: lic.getLicenseState() });
});

export default router;