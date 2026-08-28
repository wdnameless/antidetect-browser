// Network diagnostics API (Sprint 2.2). Only for a RUNNING profile.
import { Router, Request, Response } from 'express';
import { collectDiagnostics } from '../../diagnostics/networkDiagnostics';

const router = Router();

router.get('/api/v1/diagnostics/:profileId', async (req: Request, res: Response) => {
  try {
    const report = await collectDiagnostics(String(req.params.profileId));
    if (!report) {
      res.status(409).json({ code: 'NOT_RUNNING', msg: 'profile is not running', data: {} });
      return;
    }
    res.json({ code: 0, msg: 'success', data: report });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

export default router;