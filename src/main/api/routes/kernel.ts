import { Router } from 'express';
import { checkKernelUpdate, getInstalledKernelVersion } from '../../util/kernelUpdate';

const router = Router();

// GET /api/v1/kernel/info — installed kernel version (no network).
router.get('/api/v1/kernel/info', (_req, res) => {
  res.json({ code: 0, msg: 'success', data: { installed: getInstalledKernelVersion() } });
});

// GET /api/v1/kernel/check-update — compare with the upstream GitHub release.
router.get('/api/v1/kernel/check-update', async (_req, res) => {
  const info = await checkKernelUpdate();
  res.json({ code: 0, msg: 'success', data: info });
});

export default router;
