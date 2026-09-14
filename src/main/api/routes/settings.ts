import { Router, Request, Response } from 'express';
import { moveDataRoot, getMoveStatus, cancelMove } from '../../dataRoot/mover';
import { getTelegramSettings, saveTelegramSettings } from '../../telegram/bot';
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

// GET /api/v1/settings/telegram
// Token masking rule: never echo the raw token back; return has_token: boolean
router.get('/api/v1/settings/telegram', (_req: Request, res: Response) => {
  try {
    const s = getTelegramSettings();
    res.json({
      code: 0,
      msg: 'success',
      data: {
        has_token: Boolean(s.token && s.token.trim().length > 0),
        chatIds: s.chatIds,
        enabled: s.enabled,
      },
    });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message });
  }
});

router.put('/api/v1/settings/telegram', (req: Request, res: Response) => {
  try {
    const current = getTelegramSettings();
    const body = req.body || {};

    // If token is explicitly passed (string), update it. If omitted or undefined, keep current token.
    const token = typeof body.token === 'string' ? body.token.trim() : current.token;
    const chatIds = Array.isArray(body.chatIds)
      ? body.chatIds.map(String)
      : Array.isArray(body.chat_ids)
      ? body.chat_ids.map(String)
      : current.chatIds;
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;

    saveTelegramSettings({ token, chatIds, enabled });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        has_token: Boolean(token && token.length > 0),
        chatIds,
        enabled,
      },
    });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message });
  }
});

export default router;
