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
/**
 * MCP privilege level in effect.
 *
 * `standard` grants the 35 read/write tools and refuses the 12 destructive ones; `admin`
 * additionally grants delete/restore/import/export. The env override wins so an operator can
 * pin the level for a deployment, but the stored setting is what the UI edits.
 */
export function getMcpScope(): 'standard' | 'admin' {
  const fromEnv = process.env.ANTIDETECT_MCP_SCOPE;
  if (fromEnv === 'standard' || fromEnv === 'admin') return fromEnv;
  const stored = getSetting('mcpScope');
  return stored === 'admin' ? 'admin' : 'standard';
}

router.get('/api/v1/settings/security', (_req, res: Response) => {
  res.json({
    code: 0,
    msg: 'success',
    data: {
      captureProtection: getSetting('captureProtection') === true,
      autoLockMinutes: typeof getSetting('autoLockMinutes') === 'number' ? getSetting('autoLockMinutes') : 15,
      // MCP privilege level. Read from settings, falling back to the env override so a
      // deployment can pin it. `standard` is the safe default: the 12 destructive tools
      // (delete/restore/import/export) stay refused until the operator opts in.
      mcpScope: getMcpScope(),
    },
  });
});

// PUT /api/v1/settings/security — persists and applies immediately
router.put('/api/v1/settings/security', (req: Request, res: Response) => {
  const { captureProtection, autoLockMinutes, mcpScope } = req.body || {};
  if (typeof captureProtection === 'boolean') setSetting('captureProtection', captureProtection);
  if (autoLockMinutes === null || (typeof autoLockMinutes === 'number' && autoLockMinutes >= 0)) {
    setSetting('autoLockMinutes', autoLockMinutes ?? 15);
  }
  if (typeof mcpScope === 'string') {
    // Only the two scopes the MCP server actually implements are accepted; anything else
    // would be stored and then silently behave as `standard`.
    if (mcpScope === 'standard' || mcpScope === 'admin') setSetting('mcpScope', mcpScope);
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
      mcpScope: getMcpScope(),
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
        events: s.events,
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

    // Merge partial events into existing settings so unspecified keys are preserved
    const incomingEvents = body.events && typeof body.events === 'object' ? body.events : {};
    const events: Record<string, boolean> = {
      ...current.events,
    };
    for (const [k, v] of Object.entries(incomingEvents)) {
      if (typeof v === 'boolean') {
        events[k] = v;
      }
    }

    saveTelegramSettings({ token, chatIds, enabled, events });
    res.json({
      code: 0,
      msg: 'success',
      data: {
        has_token: Boolean(token && token.length > 0),
        chatIds,
        enabled,
        events,
      },
    });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message });
  }
});

export default router;
