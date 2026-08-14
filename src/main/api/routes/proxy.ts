import { Router } from 'express';
import { z } from 'zod';
import * as xm from '../../proxy/proxyManager';
import * as pm from '../../profiles/profileManager';

const router = Router();

const proxySchema = z.object({
  type: z.enum(['http', 'https', 'socks5', 'ssh']),
  host: z.string(),
  port: z.union([z.number(), z.string()]),
  username: z.string().optional(),
  password: z.string().optional(),
  privateKey: z.string().optional(),
});

function toInput(data: z.infer<typeof proxySchema>): xm.ProxyInput {
  return {
    type: data.type,
    host: data.host,
    port: Number(data.port),
    username: data.username,
    password: data.password,
    privateKey: data.privateKey,
  };
}

router.post('/api/v1/proxy/create', (req, res) => {
  const parsed = proxySchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  try {
    const id = xm.createProxy(toInput(parsed.data));
    res.json({ code: 0, msg: 'success', data: { proxy_id: id } });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

router.get('/api/v1/proxy/list', (_req, res) => {
  const list = xm.listProxies().map((p) => ({
    proxy_id: p.id,
    type: p.type,
    host: p.host,
    port: p.port,
    username: p.username,
    country: p.country,
    timezone: p.timezone,
    status: p.status,
  }));
  res.json({ code: 0, msg: 'success', data: { list, total: list.length } });
});

const updateSchema = proxySchema.partial().extend({ proxy_id: z.string() });
router.post('/api/v1/proxy/update', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  const { proxy_id, ...rest } = parsed.data;
  const ok = xm.updateProxy(proxy_id, toInput(rest as z.infer<typeof proxySchema>));
  res.json(ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'proxy not found', data: {} });
});

const deleteSchema = z.object({ proxy_id: z.string() });
router.post('/api/v1/proxy/delete', (req, res) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  try {
    const ok = xm.deleteProxy(parsed.data.proxy_id);
    res.json(ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'proxy not found', data: {} });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

const checkSchema = z.object({ proxy_id: z.string() });
router.post('/api/v1/proxy/check', async (req, res) => {
  const parsed = checkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const proxy = xm.getProxy(parsed.data.proxy_id);
  if (!proxy) {
    res.json({ code: -1, msg: 'proxy not found', data: {} });
    return;
  }
  try {
    const result = await xm.checkProxy(proxy);
    xm.setProxyResult(proxy.id, result);
    res.json({ code: 0, msg: 'success', data: result });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// NOTE: profile binding (proxy/device/geolocation) is handled by the single
// /api/v1/browser-profile/update route in routes/browser.ts.

const fingerprintSchema = z.object({
  user_id: z.string(),
  config: z.record(z.unknown()),
});
router.post('/api/v1/browser-profile/fingerprint', (req, res) => {
  const parsed = fingerprintSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: {} });
    return;
  }
  const ok = pm.updateProfileFingerprint(parsed.data.user_id, parsed.data.config);
  res.json(ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'profile not found', data: {} });
});

export default router;
