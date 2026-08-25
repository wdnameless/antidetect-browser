import { Router } from 'express';
import { z } from 'zod';
import * as xm from '../../proxy/proxyManager';
import * as pm from '../../profiles/profileManager';
import { listBackups, restoreBackup } from '../../util/backupManager';

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

// ---------------------------------------------------------------------------
// Bulk import from a text list (v0.2.26): Webshare-style lines and friends.
// Supported per line:
//   protocol://user:pass@host:port     protocol from prefix
//   protocol://host:port
//   user:pass@host:port                default protocol
//   host:port:user:pass                default protocol (Webshare format)
//   host:port                          default protocol
// ---------------------------------------------------------------------------

interface ParsedProxyLine {
  type: xm.ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function parseProxyLine(
  raw: string,
  defaultProtocol: 'http' | 'https' | 'socks5'
): ParsedProxyLine | null {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return null;

  let rest = line;
  let protocol: xm.ProxyType = defaultProtocol;
  const protoMatch = rest.match(/^(https?|socks5|ssh):\/\//i);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase() as xm.ProxyType;
    rest = rest.slice(protoMatch[0].length);
  }

  let username: string | undefined;
  let password: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at > 0) {
    const creds = rest.slice(0, at);
    rest = rest.slice(at + 1);
    const sep = creds.indexOf(':');
    if (sep > 0) {
      username = creds.slice(0, sep);
      password = creds.slice(sep + 1);
    } else {
      username = creds;
    }
  }

  // host:port[:user:pass]
  const parts = rest.split(':').map((p) => p.trim());
  if (parts.length < 2) return null;
  const host = parts[0];
  const port = Number(parts[1]);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;
  if (parts.length >= 4 && !username) {
    username = parts[2];
    password = parts[3];
  } else if (parts.length >= 4 && username !== undefined && password === undefined) {
    // user:pass came from @ but host part had extra cols — ignore
  }

  return { type: protocol, host, port, username, password };
}

export function parseProxyList(
  text: string,
  defaultProtocol: 'http' | 'https' | 'socks5'
): { parsed: ParsedProxyLine[]; invalid: number } {
  const parsed: ParsedProxyLine[] = [];
  let invalid = 0;
  for (const line of text.split(/\r?\n/)) {
    const p = parseProxyLine(line, defaultProtocol);
    if (p) parsed.push(p);
    else if (line.trim() && !line.trim().startsWith('#')) invalid++;
  }
  return { parsed, invalid };
}

const importListSchema = z.object({
  text: z.string().min(1),
  defaultProtocol: z.enum(['http', 'https', 'socks5']).default('socks5'),
});

router.post('/api/v1/proxy/import-list', (req, res) => {
  const parsed = importListSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }
  const { parsed: proxies, invalid } = parseProxyList(parsed.data.text, parsed.data.defaultProtocol);

  // Dedupe within the list and against existing proxies (host+port+username).
  const existing = new Set(
    xm.listProxies().map((p) => `${p.host}:${p.port}:${p.username ?? ''}`)
  );
  const created: string[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  for (const p of proxies) {
    const key = `${p.host}:${p.port}:${p.username ?? ''}`;
    if (seen.has(key) || existing.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    created.push(xm.createProxy(p));
  }
  res.json({
    code: 0,
    msg: 'success',
    data: { created: created.length, duplicates, invalid, proxy_ids: created },
  });
});

// ---------------------------------------------------------------------------
// Backup restore (v0.2.26): recover the database from a daily backup.
// ---------------------------------------------------------------------------

router.get('/api/v1/backups/list', (_req, res) => {
  res.json({ code: 0, msg: 'success', data: { list: listBackups() } });
});

const restoreSchema = z.object({ name: z.string().regex(/^antidetect-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.db$|^antidetect-[\w.-]+\.db$/) });

router.post('/api/v1/backups/restore', (req, res) => {
  const parsed = restoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid backup name', data: {} });
    return;
  }
  try {
    restoreBackup(parsed.data.name);
    res.json({ code: 0, msg: 'success', data: { restart_required: true } });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

export default router;
