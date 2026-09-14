// Cloud Sync bridge: lets the desktop app connect to a self-hosted server
// instance (see docs/SERVER_DEPLOY.md), manage credentials, inspect login
// sessions and push/pull profile bundles. The renderer talks only to THIS
// local API; all remote calls are made here, so the remote never needs CORS
// for us and credentials stay in the main process.
import { Router, Request, Response } from 'express';
import * as pm from '../../profiles/profileManager';
import { isRunning } from '../../launcher/chromium';
import { getSetting, setSetting } from '../../config';
import { protectSecret, revealSecret } from '../../util/secretStore';
import {
  getGDriveStatus,
  saveGDriveCredentials,
  disconnectGDrive,
} from '../../cloud/gdriveAuth';
import {
  getOAuthTransport,
  GDRIVE_REQUIRED_SCOPE,
  finalizeTokenExchange,
} from '../../cloud/gdriveClient';
import {
  pushToGDrive,
  inspectGDrivePull,
  pullFromGDrive,
  ConflictResolution,
} from '../../cloud/gdriveTransfer';

const router = Router();

const CONNECT_TIMEOUT_MS = 8000;

interface CloudState {
  url: string;
  user: string;
  token: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function getCloud(): CloudState {
  return {
    url: str(getSetting('cloudUrl')).replace(/\/+$/, ''),
    user: str(getSetting('cloudUser')),
    token: revealSecret(str(getSetting('cloudToken'))) ?? '',
  };
}

function saveToken(token: string): void {
  setSetting('cloudToken', protectSecret(token) ?? '');
}

function normalizeUrl(input: string): string {
  let u = String(input || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  token?: string
): Promise<{ status: number; json: Record<string, unknown> | undefined; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, signal: ctrl.signal });
    let json: Record<string, unknown> | undefined;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      // non-JSON body
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: undefined, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Ping the remote and summarize its state. */
async function probeRemote(url: string, token?: string): Promise<Record<string, unknown>> {
  if (!url) return { connected: false, error: 'not configured' };
  const status = await fetchJson(`${url}/status`);
  if (status.status !== 200) {
    return { connected: false, url, error: status.error ?? `HTTP ${status.status}` };
  }
  const authState = await fetchJson(`${url}/ui/auth-state`);
  const version =
    status.json && typeof status.json.data === 'object' && status.json.data !== null
      ? ((status.json.data as Record<string, unknown>).version as string | undefined)
      : undefined;
  const hasPassword =
    authState.json && typeof authState.json.data === 'object' && authState.json.data !== null
      ? Boolean((authState.json.data as Record<string, unknown>).hasPassword)
      : undefined;
  // Verify token when we have one.
  let authorized: boolean | undefined;
  if (token) {
    const check = await fetchJson(`${url}/api/v1/browser/list?page=1&page_size=1`, {}, token);
    authorized = check.status === 200;
  }
  return { connected: true, url, version, hasPassword, authorized };
}

router.get('/api/v1/cloud/state', async (_req, res) => {
  const cloud = getCloud();
  const remote = cloud.url ? await probeRemote(cloud.url, cloud.token || undefined) : { connected: false };
  res.json({
    code: 0,
    msg: 'success',
    data: { configured: Boolean(cloud.url), url: cloud.url, user: cloud.user, hasToken: Boolean(cloud.token), ...remote },
  });
});

router.post('/api/v1/cloud/connect', async (req: Request, res: Response) => {
  const url = normalizeUrl(String(req.body?.url || ''));
  if (!url) {
    res.json({ code: -1, msg: 'url is required', data: {} });
    return;
  }
  const probe = await probeRemote(url);
  if (!probe.connected) {
    res.json({ code: -1, msg: `server unreachable (${probe.error ?? 'unknown'})`, data: probe });
    return;
  }
  setSetting('cloudUrl', url);
  res.json({ code: 0, msg: 'success', data: { configured: true, url, user: getCloud().user, hasToken: Boolean(getCloud().token), ...probe } });
});

router.post('/api/v1/cloud/setup', async (req: Request, res: Response) => {
  const cloud = getCloud();
  if (!cloud.url) {
    res.json({ code: -1, msg: 'connect to a server first', data: {} });
    return;
  }
  const r = await fetchJson(
    `${cloud.url}/ui/setup`,
    { method: 'POST', body: JSON.stringify({ username: req.body?.username, password: req.body?.password }) }
  );
  const data = r.json?.data as Record<string, unknown> | undefined;
  if (r.status === 200 && data && typeof data.token === 'string') {
    setSetting('cloudUser', String(data.username ?? req.body?.username ?? ''));
    saveToken(data.token);
    res.json({ code: 0, msg: 'success', data: { username: data.username } });
    return;
  }
  res.json({ code: -1, msg: (r.json && (r.json.msg as string)) || `HTTP ${r.status}`, data: {} });
});

router.post('/api/v1/cloud/login', async (req: Request, res: Response) => {
  const cloud = getCloud();
  if (!cloud.url) {
    res.json({ code: -1, msg: 'connect to a server first', data: {} });
    return;
  }
  const r = await fetchJson(
    `${cloud.url}/ui/login`,
    { method: 'POST', body: JSON.stringify({ username: req.body?.username, password: req.body?.password }) }
  );
  const data = r.json?.data as Record<string, unknown> | undefined;
  if (r.status === 200 && data && typeof data.token === 'string') {
    setSetting('cloudUser', String(data.username ?? req.body?.username ?? ''));
    saveToken(data.token);
    res.json({ code: 0, msg: 'success', data: { username: data.username } });
    return;
  }
  res.json({ code: -1, msg: (r.json && (r.json.msg as string)) || `HTTP ${r.status}`, data: {} });
});

router.post('/api/v1/cloud/disconnect', (_req, res) => {
  setSetting('cloudUrl', '');
  setSetting('cloudUser', '');
  setSetting('cloudToken', '');
  res.json({ code: 0, msg: 'success', data: {} });
});

router.get('/api/v1/cloud/sessions', async (_req, res) => {
  const cloud = getCloud();
  if (!cloud.url || !cloud.token) {
    res.json({ code: -1, msg: 'not connected', data: {} });
    return;
  }
  const r = await fetchJson(`${cloud.url}/ui/sessions`, {}, cloud.token);
  if (r.status === 200 && r.json?.code === 0) {
    res.json(r.json);
    return;
  }
  res.json({ code: -1, msg: (r.json && (r.json.msg as string)) || `HTTP ${r.status}`, data: {} });
});

/** List profiles that exist on the remote server. */
router.get('/api/v1/cloud/remote-list', async (_req, res) => {
  const cloud = getCloud();
  if (!cloud.url || !cloud.token) {
    res.json({ code: -1, msg: 'not connected', data: {} });
    return;
  }
  const r = await fetchJson(`${cloud.url}/api/v1/browser/list?page=1&page_size=500`, {}, cloud.token);
  if (r.status === 200 && r.json?.code === 0) {
    res.json(r.json);
    return;
  }
  res.json({ code: -1, msg: (r.json && (r.json.msg as string)) || `HTTP ${r.status}`, data: {} });
});

interface SyncResultRow {
  user_id: string;
  name: string;
  ok: boolean;
  new_id?: string;
  skipped?: string;
  error?: string;
}

/** Push local profiles to the remote server (export bundle -> import). */
router.post('/api/v1/cloud/push', async (req: Request, res: Response) => {
  const cloud = getCloud();
  if (!cloud.url || !cloud.token) {
    res.json({ code: -1, msg: 'not connected', data: {} });
    return;
  }
  const requested = Array.isArray(req.body?.user_ids) ? (req.body.user_ids as string[]) : null;
  const locals = pm.listProfiles(1, 1000).list.filter((p) => !isRunning(p.user_id));
  const targets = requested ? locals.filter((p) => requested.includes(p.user_id)) : locals;

  const results: SyncResultRow[] = [];
  for (const p of targets.slice(0, 500)) {
    try {
      const bundle = pm.exportProfileBundle(p.user_id);
      if (!bundle) {
        results.push({ user_id: p.user_id, name: p.name ?? '', ok: false, error: 'export failed' });
        continue;
      }
      const r = await fetchJson(
        `${cloud.url}/api/v1/browser-profile/import-bundle`,
        { method: 'POST', body: JSON.stringify({ bundle }) },
        cloud.token
      );
      const data = r.json?.data as Record<string, unknown> | undefined;
      const ok = r.status === 200 && r.json?.code === 0 && typeof data?.user_id === 'string';
      results.push({
        user_id: p.user_id,
        name: p.name ?? '',
        ok,
        new_id: ok ? String(data?.user_id) : undefined,
        error: ok ? undefined : ((r.json?.msg as string) ?? `HTTP ${r.status}`),
      });
    } catch (err) {
      results.push({ user_id: p.user_id, name: p.name ?? '', ok: false, error: (err as Error).message });
    }
  }
  res.json({
    code: 0,
    msg: 'success',
    data: { pushed: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results },
  });
});

/** Pull profiles from the remote server into this machine. */
router.post('/api/v1/cloud/pull', async (req: Request, res: Response) => {
  const cloud = getCloud();
  if (!cloud.url || !cloud.token) {
    res.json({ code: -1, msg: 'not connected', data: {} });
    return;
  }
  const requested = Array.isArray(req.body?.user_ids) ? (req.body.user_ids as string[]) : null;
  const listRes = await fetchJson(`${cloud.url}/api/v1/browser/list?page=1&page_size=500`, {}, cloud.token);
  const data = listRes.json?.data as Record<string, unknown> | undefined;
  const remoteList = (data?.list as Array<Record<string, unknown>> | undefined) ?? [];
  if (!Array.isArray(remoteList)) {
    res.json({ code: -1, msg: 'cannot list remote profiles', data: {} });
    return;
  }

  const results: SyncResultRow[] = [];
  for (const item of remoteList) {
    const rid = String(item.user_id ?? '');
    if (!rid || (requested && !requested.includes(rid))) continue;
    try {
      const exp = await fetchJson(
        `${cloud.url}/api/v1/browser-profile/export?user_id=${encodeURIComponent(rid)}`,
        {},
        cloud.token
      );
      const expData = exp.json?.data as Record<string, unknown> | undefined;
      const bundle = expData?.bundle as pm.ProfileBundle | undefined;
      if (!bundle) {
        results.push({ user_id: rid, name: String(item.name ?? ''), ok: false, error: 'remote export failed' });
        continue;
      }
      const newId = pm.importProfileBundle(bundle);
      results.push({ user_id: rid, name: String(item.name ?? ''), ok: true, new_id: newId });
    } catch (err) {
      results.push({ user_id: rid, name: String(item.name ?? ''), ok: false, error: (err as Error).message });
    }
  }
  res.json({
    code: 0,
    msg: 'success',
    data: { pulled: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results },
  });
});

// ============================================================================
// Google Drive Sync Endpoints (nulltrace-gdrive)
// ============================================================================

/** Get GDrive status (safe status object, never leaks tokens or secrets) */
router.get('/api/v1/cloud/gdrive/status', (_req: Request, res: Response) => {
  res.json({
    code: 0,
    msg: 'success',
    data: getGDriveStatus(),
  });
});

/** Save operator's OAuth client credentials (stored in DPAPI secret store) */
router.post('/api/v1/cloud/gdrive/credentials', (req: Request, res: Response) => {
  const { clientId, clientSecret } = req.body || {};
  try {
    saveGDriveCredentials({ clientId, clientSecret });
    res.json({
      code: 0,
      msg: 'Credentials saved securely',
      data: getGDriveStatus(),
    });
  } catch (err) {
    res.status(400).json({
      code: 400,
      msg: (err as Error).message,
    });
  }
});

/** Initiate Device Code flow for authorization */
router.post('/api/v1/cloud/gdrive/auth/device-code', async (_req: Request, res: Response) => {
  const status = getGDriveStatus();
  if (!status.configured) {
    res.status(400).json({
      code: 400,
      msg: 'Google OAuth Client ID must be configured first',
    });
    return;
  }

  const { getGDriveCredentials } = await import('../../cloud/gdriveAuth');
  const creds = getGDriveCredentials();
  if (!creds) {
    res.status(400).json({ code: 400, msg: 'No credentials found' });
    return;
  }

  try {
    const transport = getOAuthTransport();
    const deviceResp = await transport.requestDeviceCode(creds.clientId, GDRIVE_REQUIRED_SCOPE);
    res.json({
      code: 0,
      msg: 'success',
      data: {
        userCode: deviceResp.user_code,
        verificationUrl: deviceResp.verification_url,
        deviceCode: deviceResp.device_code,
        expiresIn: deviceResp.expires_in,
        interval: deviceResp.interval,
      },
    });
  } catch (err) {
    res.status(500).json({
      code: 500,
      msg: (err as Error).message,
    });
  }
});

/** Poll Device Code flow */
router.post('/api/v1/cloud/gdrive/auth/poll', async (req: Request, res: Response) => {
  const { deviceCode } = req.body || {};
  if (!deviceCode) {
    res.status(400).json({ code: 400, msg: 'deviceCode is required' });
    return;
  }

  const { getGDriveCredentials } = await import('../../cloud/gdriveAuth');
  const creds = getGDriveCredentials();
  if (!creds) {
    res.status(400).json({ code: 400, msg: 'Credentials not configured' });
    return;
  }

  try {
    const transport = getOAuthTransport();
    const result = await transport.pollDeviceToken(creds.clientId, creds.clientSecret, deviceCode);
    if (result.status === 'pending' || result.status === 'slow_down') {
      res.json({ code: 0, msg: result.status, data: { status: result.status } });
      return;
    }

    if (result.status === 'success' && result.data) {
      const finalInfo = await finalizeTokenExchange(result.data);
      res.json({
        code: 0,
        msg: 'Connected successfully',
        data: {
          status: 'success',
          email: finalInfo.email,
          gdriveStatus: getGDriveStatus(),
        },
      });
      return;
    }

    res.status(400).json({ code: 400, msg: 'Polling failed' });
  } catch (err) {
    res.status(400).json({
      code: 400,
      msg: (err as Error).message,
    });
  }
});

/** Disconnect GDrive (clears refresh token) */
router.post('/api/v1/cloud/gdrive/disconnect', (_req: Request, res: Response) => {
  disconnectGDrive();
  res.json({
    code: 0,
    msg: 'Disconnected from Google Drive',
    data: getGDriveStatus(),
  });
});

/** Push profiles, scripts, and settings to Google Drive */
router.post('/api/v1/cloud/gdrive/push', async (_req: Request, res: Response) => {
  const status = getGDriveStatus();
  if (!status.connected) {
    res.status(400).json({ code: 400, msg: 'Not connected to Google Drive' });
    return;
  }

  try {
    const result = await pushToGDrive();
    res.json({
      code: 0,
      msg: 'Pushed to Google Drive successfully',
      data: result,
    });
  } catch (err) {
    res.status(500).json({
      code: 500,
      msg: (err as Error).message,
    });
  }
});

/** Inspect remote Drive state without pulling */
router.get('/api/v1/cloud/gdrive/inspect-pull', async (_req: Request, res: Response) => {
  const status = getGDriveStatus();
  if (!status.connected) {
    res.status(400).json({ code: 400, msg: 'Not connected to Google Drive' });
    return;
  }

  try {
    const inspection = await inspectGDrivePull();
    res.json({
      code: 0,
      msg: 'success',
      data: inspection,
    });
  } catch (err) {
    res.status(500).json({
      code: 500,
      msg: (err as Error).message,
    });
  }
});

/** Pull profiles, scripts, and settings from Google Drive */
router.post('/api/v1/cloud/gdrive/pull', async (req: Request, res: Response) => {
  const status = getGDriveStatus();
  if (!status.connected) {
    res.status(400).json({ code: 400, msg: 'Not connected to Google Drive' });
    return;
  }

  const { conflictResolution } = (req.body || {}) as { conflictResolution?: ConflictResolution };
  try {
    const result = await pullFromGDrive({ conflictResolution });
    res.json({
      code: 0,
      msg: 'Pulled from Google Drive successfully',
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      code: 400,
      msg: (err as Error).message,
    });
  }
});

export default router;
