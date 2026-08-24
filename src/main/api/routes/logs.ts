import { Router } from 'express';
import { listLogFiles, readLog, LOG_DIR } from '../../util/logger';

const router = Router();

// GET /api/v1/logs/list — available log files (newest first)
router.get('/api/v1/logs/list', (_req, res) => {
  res.json({ code: 0, msg: 'success', data: { dir: LOG_DIR, list: listLogFiles() } });
});

// GET /api/v1/logs/get?name=app-2026-08-24.log&tail=500
router.get('/api/v1/logs/get', (req, res) => {
  const name = String(req.query.name || '');
  const tail = Math.min(5000, Math.max(1, Number(req.query.tail) || 500));
  const result = readLog(name, tail);
  if (!result.ok) {
    res.json({ code: -1, msg: result.error ?? 'log read failed', data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: { name, content: result.content } });
});

export default router;
