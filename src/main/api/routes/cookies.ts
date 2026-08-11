import { Router } from 'express';
import { z } from 'zod';
import puppeteer from 'puppeteer-core';
import { getDb } from '../../db';
import * as launcher from '../../launcher/chromium';

const router = Router();

const importSchema = z.object({
  user_id: z.string(),
  cookies: z.array(z.record(z.unknown())),
});

router.post('/api/v1/browser-profile/cookies/import', (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  const db = getDb();
  const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(parsed.data.user_id);
  if (!profile) {
    res.json({ code: -1, msg: 'profile not found', data: {} });
    return;
  }
  db.prepare('UPDATE profiles SET cookies_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(parsed.data.cookies),
    Date.now(),
    parsed.data.user_id
  );
  res.json({ code: 0, msg: 'success', data: { count: parsed.data.cookies.length } });
});

router.get('/api/v1/browser-profile/cookies/export', async (req, res) => {
  const userId = String(req.query.user_id || '');
  const db = getDb();
  const profile = db
    .prepare('SELECT id, cookies_json FROM profiles WHERE id = ?')
    .get(userId) as { id: string; cookies_json: string | null } | undefined;
  if (!profile) {
    res.json({ code: -1, msg: 'profile not found', data: {} });
    return;
  }

  // If the profile is running, read live cookies via CDP.
  if (launcher.isRunning(userId)) {
    const ws = launcher.getRunningWs(userId);
    if (ws) {
      try {
        const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
        try {
          const targets = await browser.targets();
          const pageTarget = targets.find((t) => t.type() === 'page');
          if (pageTarget) {
            const session = await pageTarget.createCDPSession();
            const result = (await session.send('Network.getAllCookies')) as { cookies: unknown[] };
            await session.detach().catch(() => undefined);
            res.json({ code: 0, msg: 'success', data: { cookies: result.cookies, source: 'live' } });
            return;
          }
        } finally {
          browser.disconnect();
        }
      } catch {
        // fall through to stored cookies
      }
    }
  }

  let cookies: unknown[] = [];
  if (profile.cookies_json) {
    try {
      const parsed = JSON.parse(profile.cookies_json);
      if (Array.isArray(parsed)) cookies = parsed;
    } catch {
      // ignore invalid JSON
    }
  }
  res.json({ code: 0, msg: 'success', data: { cookies, source: 'stored' } });
});

export default router;
