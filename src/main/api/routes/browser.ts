import { Router, Response } from 'express';
import { z } from 'zod';
import * as pm from '../../profiles/profileManager';
import * as launcher from '../../launcher/chromium';
import * as firefox from '../../launcher/firefox';

const router = Router();

async function handleStart(id: string, res: Response): Promise<void> {
  if (!id) {
    res.json({ code: -1, msg: 'user_id is required', data: {} });
    return;
  }
  const profile = pm.getProfile(id);
  if (!profile) {
    res.json({ code: -1, msg: 'profile not found', data: {} });
    return;
  }
  try {
    const cfg = pm.resolveLaunchConfig(id);
    if (cfg.browserType === 'firefox') {
      const result = await firefox.startFirefox({
        profileId: id,
        userDataDir: cfg.userDataDir,
        proxyServer: cfg.proxyServer,
        proxyAuth: cfg.proxyAuth,
        timezone: cfg.fingerprint?.timezone ?? cfg.proxyTimezone,
        lang: cfg.fingerprint?.lang,
      });
      if (!result.ok) {
        res.json({ code: -1, msg: result.error ?? 'firefox start failed', data: {} });
        return;
      }
      pm.setStatus(id, 'running');
      res.json({ code: 0, msg: 'success', data: { browser_type: 'firefox', url: result.url ?? '' } });
      return;
    }
    const result = await launcher.startProfile(cfg);
    pm.setStatus(id, 'running');
    res.json({ code: 0, msg: 'success', data: result });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
}

// AdsPower V1
router.get('/api/v1/browser/start', async (req, res) => {
  await handleStart(String(req.query.user_id || ''), res);
});

// AdsPower V2
const startV2Schema = z.object({ profile_id: z.string() });
router.post('/api/v2/browser-profile/start', async (req, res) => {
  const parsed = startV2Schema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body: profile_id required', data: {} });
    return;
  }
  await handleStart(parsed.data.profile_id, res);
});

router.get('/api/v1/browser/stop', async (req, res) => {
  const id = String(req.query.user_id || '');
  const profile = id ? pm.getProfile(id) : undefined;
  if (profile?.browser_type === 'firefox') {
    const result = await firefox.stopFirefox(id);
    if (!result.ok) {
      res.json({ code: -1, msg: result.error ?? 'stop failed', data: {} });
      return;
    }
  } else {
    launcher.stopProfile(id);
  }
  if (id) pm.setStatus(id, 'closed');
  res.json({ code: 0, msg: 'success', data: {} });
});

router.get('/api/v1/browser/list', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.page_size) || 100));
  const { list, total } = pm.listProfiles(page, pageSize);
  res.json({ code: 0, msg: 'success', data: { list, page, page_size: pageSize, total } });
});
// Alias compatible with AdsPower V2 list
router.post('/api/v2/browser-profile/list', (req, res) => {
  const page = Math.max(1, Number(req.body?.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.body?.page_size) || 100));
  const { list, total } = pm.listProfiles(page, pageSize);
  res.json({ code: 0, msg: 'success', data: { list, page, page_size: pageSize, total } });
});

const createSchema = z.object({
  name: z.string().optional(),
  group_id: z.string().optional(),
  user_agent: z.string().optional(),
  timezone: z.string().optional(),
  browser_type: z.enum(['chromium', 'firefox']).optional(),
  proxy: z
    .object({
      type: z.enum(['http', 'https', 'socks5', 'ssh']),
      host: z.string(),
      port: z.union([z.number(), z.string()]),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
});

router.post('/api/v1/browser-profile/create', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  const input: pm.CreateProfileInput = {
    name: parsed.data.name,
    group_id: parsed.data.group_id,
    user_agent: parsed.data.user_agent,
    timezone: parsed.data.timezone,
    browser_type: parsed.data.browser_type,
    proxy: parsed.data.proxy
      ? {
          type: parsed.data.proxy.type,
          host: parsed.data.proxy.host,
          port: Number(parsed.data.proxy.port),
          username: parsed.data.proxy.username,
          password: parsed.data.proxy.password,
        }
      : undefined,
  };
  try {
    const id = pm.createProfile(input);
    res.json({ code: 0, msg: 'success', data: { user_id: id } });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// --- Firefox managed-control endpoints (Juggler, no ws endpoint) ---

const navigateSchema = z.object({ user_id: z.string(), url: z.string() });
router.post('/api/v1/browser/firefox/navigate', async (req, res) => {
  const parsed = navigateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const result = await firefox.navigate(parsed.data.user_id, parsed.data.url);
  res.json(result.ok ? { code: 0, msg: 'success', data: { url: result.url, title: result.title } } : { code: -1, msg: result.error ?? 'navigate failed', data: {} });
});

const evaluateSchema = z.object({ user_id: z.string(), expression: z.string() });
router.post('/api/v1/browser/firefox/evaluate', async (req, res) => {
  const parsed = evaluateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const result = await firefox.evaluate(parsed.data.user_id, parsed.data.expression);
  res.json(result.ok ? { code: 0, msg: 'success', data: { result: result.result } } : { code: -1, msg: result.error ?? 'evaluate failed', data: {} });
});

router.get('/api/v1/browser/firefox/title', async (req, res) => {
  const id = String(req.query.user_id || '');
  const result = await firefox.getTitle(id);
  res.json(result.ok ? { code: 0, msg: 'success', data: { title: result.title } } : { code: -1, msg: result.error ?? 'title failed', data: {} });
});

export default router;
