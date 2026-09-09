import { Router, Request, Response } from 'express';
import { moveDataRoot, getMoveStatus, cancelMove } from '../../dataRoot/mover';
import { getSetting, setSetting } from '../../config';

const router = Router();

// POST /api/v1/settings/data-root/move
router.post('/api/v1/settings/data-root/move', async (req: Request, res: Response) => {
  const { targetDir } = req.body || {};
  if (!targetDir || typeof targetDir !== 'string') {
    res.status(400).json({ code: 400, msg: 'targetDir is required', data: {} });
    return;
  }

  const currentStatus = getMoveStatus();
  if (currentStatus.inProgress) {
    res.status(409).json({ code: 409, msg: 'A move is already in progress', data: currentStatus });
    return;
  }

  // Start move asynchronously or await?
  // Let's run move in background and return 200/202 accepted with status
  moveDataRoot(targetDir).catch((err) => {
    console.error('[dataRoot] background move error:', err);
  });

  res.json({ code: 0, msg: 'Move started', data: getMoveStatus() });
});

// GET /api/v1/settings/security (capture protection + auto-lock)
router.get('/api/v1/settings/security', (_req: Request, res: Response) => {
  res.json({
    code: 0,
    msg: 'success',
    data: {
      captureProtection: getSetting('captureProtection') === true,
      autoLockMinutes: typeof getSetting('autoLockMinutes') === 'number' ? getSetting('autoLockMinutes') : 15,
    },
  });
});

// PUT /api/v1/settings/security — persists and applies immediately
router.put('/api/v1/settings/security', (req: Request, res: Response) => {
  const { captureProtection, autoLockMinutes } = req.body || {};
  if (typeof captureProtection === 'boolean') setSetting('captureProtection', captureProtection);
  if (autoLockMinutes === null || (typeof autoLockMinutes === 'number' && autoLockMinutes >= 0)) {
    setSetting('autoLockMinutes', autoLockMinutes ?? 15);
  }
  // Apply live (service mode): re-init protection from the persisted settings.
  try {
    const sp = require('../../security/screenProtection') as {
      initScreenProtection(options: { idleTimeoutMinutes?: number }): void;
      setCaptureProtection(enabled: boolean): void;
    };
    sp.initScreenProtection({
      idleTimeoutMinutes: typeof getSetting('autoLockMinutes') === 'number' ? (getSetting('autoLockMinutes') as number) : 15,
    });
    sp.setCaptureProtection(getSetting('captureProtection') === true);
  } catch {
    // Electron absent (standalone service): settings apply on next window session.
  }
  res.json({
    code: 0,
    msg: 'success',
    data: {
      captureProtection: getSetting('captureProtection') === true,
      autoLockMinutes: getSetting('autoLockMinutes'),
    },
  });
});

// GET /api/v1/settings/data-root/move/status
router.get('/api/v1/settings/data-root/move/status', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: getMoveStatus() });
});

// POST /api/v1/settings/data-root/move/cancel
router.post('/api/v1/settings/data-root/move/cancel', (_req: Request, res: Response) => {
  const cancelled = cancelMove();
  res.json({ code: 0, msg: cancelled ? 'Cancel requested' : 'No move in progress', data: { cancelled } });
});

export default router;
