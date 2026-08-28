// Sync API router (Sprint 1). Pro-gated bridge between the renderer and the
// remote sync server. Zod validates inputs; LICENSE_REQUIRED for Free users.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as sync from '../../teams/syncClient';
import * as tm from '../../teams/teamManager';

const router = Router();

function licenseGate(res: Response): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { hasFeature } = require('../../licensing/licenseManager') as typeof import('../../licensing/licenseManager');
  if (hasFeature('sync')) return true;
  res.json({ code: 'LICENSE_REQUIRED', msg: 'Pro license required', data: {} });
  return false;
}

router.get('/api/v1/sync/endpoint', (_req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const cfg = sync.getEndpointConfig();
  res.json({
    code: 0,
    msg: 'success',
    data: { ...cfg, url: sync.getEndpointUrl(), default_url: sync.DEFAULT_CLOUD_URL },
  });
});

router.post('/api/v1/sync/endpoint', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z
    .object({ mode: z.enum(['cloud', 'custom']), url: z.string().max(500).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'mode must be cloud|custom', data: {} });
    return;
  }
  if (parsed.data.mode === 'custom' && !parsed.data.url) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'custom mode requires url', data: {} });
    return;
  }
  sync.setEndpointConfig(parsed.data.mode, parsed.data.url);
  res.json({
    code: 0,
    msg: 'success',
    data: { ...sync.getEndpointConfig(), url: sync.getEndpointUrl() },
  });
});

router.get('/api/v1/sync/status', async (_req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const probe = await sync.probeEndpoint();
  res.json({ code: 0, msg: 'success', data: { ...probe, token: Boolean(sync.getSyncToken()) } });
});

router.post('/api/v1/teams/:id/push', async (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ user_ids: z.array(z.string()).max(500).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid user_ids', data: {} });
    return;
  }
  if (!tm.checkPermission(String(req.params.id), 'can_add_profiles')) {
    res.status(403).json({ code: 'NO_PERMISSION', msg: 'can_add_profiles required to push', data: {} });
    return;
  }
  const results = await sync.pushTeamBundles(String(req.params.id), parsed.data.user_ids);
  res.json({
    code: 0,
    msg: 'success',
    data: {
      pushed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    },
  });
});

router.post('/api/v1/teams/:id/pull', async (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ user_ids: z.array(z.string()).max(500).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid user_ids', data: {} });
    return;
  }
  const r = await sync.pullTeamBundles(String(req.params.id), parsed.data.user_ids);
  res.json({ code: 0, msg: 'success', data: r });
});

export default router;