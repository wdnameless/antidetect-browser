import { Request, Response, Router } from 'express';
import { runPreflight, blockOnFailLaunchGuard } from '../../preflight/preflightService';
import { getLastVerdict } from '../../preflight/store';
import * as pm from '../../profiles/profileManager';

const router = Router();

/**
 * POST /api/profiles/:id/preflight
 * Runs preflight checks for the profile and returns full PreflightVerdict.
 */
router.post('/api/profiles/:id/preflight', async (req: Request, res: Response) => {
  const profileId = String(req.params.id || '');
  if (!profileId) {
    return res.status(400).json({ code: -1, msg: 'profile ID is required', data: {} });
  }
  const profile = pm.getProfile(profileId);
  if (!profile) {
    return res.status(404).json({ code: -1, msg: 'profile not found', data: {} });
  }

  try {
    const verdict = await runPreflight(profileId);
    return res.json({
      code: 0,
      msg: 'success',
      data: verdict,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ code: -1, msg, data: {} });
  }
});

/**
 * GET /api/profiles/:id/preflight/last
 * Returns the cached last verdict for the profile, or 404 if none exists.
 */
router.get('/api/profiles/:id/preflight/last', (req: Request, res: Response) => {
  const profileId = String(req.params.id || '');
  if (!profileId) {
    return res.status(400).json({ code: -1, msg: 'profile ID is required', data: {} });
  }
  const verdict = getLastVerdict(profileId);
  if (!verdict) {
    return res.status(404).json({ code: -1, msg: 'no preflight verdict recorded for profile', data: {} });
  }
  return res.json({
    code: 0,
    msg: 'success',
    data: verdict,
  });
});

/**
 * POST /api/profiles/:id/start-with-preflight
 * Start profile with optional blockOnFail guard
 */
router.post('/api/profiles/:id/start-with-preflight', async (req: Request, res: Response) => {
  const profileId = String(req.params.id || '');
  const blockOnFail = Boolean(req.body?.blockOnFail || req.query.blockOnFail === 'true');

  if (blockOnFail) {
    const guard = await blockOnFailLaunchGuard(profileId, true);
    if (!guard.allowed) {
      return res.status(412).json({
        code: -1,
        msg: 'Launch blocked by preflight failure',
        data: guard.verdict,
      });
    }
  }

  return res.json({
    code: 0,
    msg: 'Preflight launch guard passed',
    data: { profileId, allowed: true },
  });
});

export default router;
