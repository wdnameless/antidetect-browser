// Sync client (Sprint 1): push/pull encrypted profile bundles to the team sync
// server. Wire-format v1 (see openspec specs/sync-protocol):
//   payload = AES-256-GCM(bundle JSON, teamKey) -> nonce||tag||ciphertext
//   server row = {bundle_id, team_id, device_id, ciphertext, nonce, version, updated_at}
// Conflict resolution: last-write-wins by updated_at (ties -> higher version).
//
// Endpoint configuration: 'cloud' (default URL) or 'custom' (self-host URL),
// switchable in Settings -> Sync. All remote HTTP happens here; the renderer
// only talks to the local API.

import * as pm from '../profiles/profileManager';
import { getDb } from '../db';
import { getSetting, setSetting } from '../config';
import { protectSecret, revealSecret } from '../util/secretStore';
import { deriveTeamKey, encryptBundle, decryptBundle, getDeviceId } from './teamCrypto';

export const DEFAULT_CLOUD_URL = 'https://sync.antidetect.app';

export interface EndpointConfig {
  mode: 'cloud' | 'custom';
  customUrl: string;
}

export function getEndpointConfig(): EndpointConfig {
  const mode = getSetting('syncEndpointMode') === 'custom' ? 'custom' : 'cloud';
  const customUrl = String(getSetting('syncCustomUrl') ?? '').replace(/\/+$/, '');
  return { mode, customUrl };
}

export function setEndpointConfig(mode: 'cloud' | 'custom', customUrl?: string): void {
  setSetting('syncEndpointMode', mode === 'custom' ? 'custom' : 'cloud');
  if (typeof customUrl === 'string') {
    let url = customUrl.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
    setSetting('syncCustomUrl', url);
  }
}

export function getEndpointUrl(): string {
  const cfg = getEndpointConfig();
  return cfg.mode === 'custom' && cfg.customUrl ? cfg.customUrl : DEFAULT_CLOUD_URL;
}

/** Sync access token (issued by the server at device registration/accept). */
export function getSyncToken(): string {
  return revealSecret(String(getSetting('syncToken') ?? '')) ?? '';
}

export function setSyncToken(token: string): void {
  setSetting('syncToken', protectSecret(token) ?? '');
}

/** High-water mark: bundles with updated_at > cursor are pulled. */
export function getSyncCursor(teamId: string): number {
  const v = Number(getSetting(`syncCursor:${teamId}`));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function setSyncCursor(teamId: string, value: number): void {
  setSetting(`syncCursor:${teamId}`, value);
}

// ---------------------------------------------------------------------------
// Remote transport (mirrors routes/cloud.ts fetchJson pattern)
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 15000;

async function fetchJson(
  url: string,
  init: RequestInit = {},
  token?: string
): Promise<{ status: number; json: Record<string, unknown> | undefined; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
      signal: ctrl.signal,
    });
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

/** Probe the configured endpoint; used by Settings → Sync connection status. */
export async function probeEndpoint(): Promise<{ connected: boolean; url: string; error?: string; version?: string }> {
  const url = getEndpointUrl();
  if (!url) return { connected: false, url, error: 'not configured' };
  const r = await fetchJson(`${url}/status`);
  if (r.status !== 200) return { connected: false, url, error: r.error ?? `HTTP ${r.status}` };
  const data = r.json?.data as Record<string, unknown> | undefined;
  return { connected: true, url, version: typeof data?.version === 'string' ? data.version : undefined };
}

// ---------------------------------------------------------------------------
// Bundle push/pull
// ---------------------------------------------------------------------------

export interface PushResult {
  bundle_id: string;
  ok: boolean;
  version?: number;
  error?: string;
}

export interface PullResult {
  pulled: number;
  failed: number;
  errors: string[];
}

interface RemoteBundleRow {
  bundle_id: string;
  device_id: string | null;
  ciphertext: string; // base64 nonce||tag||ciphertext
  version: number;
  updated_at: number;
}

function getTeamKeyOrThrow(teamId: string, masterKey: Buffer): Buffer {
  return deriveTeamKey(masterKey, teamId);
}

/**
 * Push local profiles to a team workspace: export bundle -> encrypt -> POST.
 * Requires a Pro license (checked by the route) and the local team key.
 */
export async function pushTeamBundles(teamId: string, userIds?: string[]): Promise<PushResult[]> {
  const masterKey = getLocalTeamKey(teamId);
  if (!masterKey) return [{ bundle_id: '*', ok: false, error: 'team key not available locally' }];
  const teamKey = getTeamKeyOrThrow(teamId, masterKey);
  const deviceId = getDeviceId();

  const all = pm.listProfiles(1, 1000).list.filter((p) => !isRunningSafe(p.user_id));
  const targets = userIds?.length ? all.filter((p) => userIds.includes(p.user_id)) : all;
  const results: PushResult[] = [];

  for (const p of targets.slice(0, 500)) {
    const bundle = pm.exportProfileBundle(p.user_id);
    if (!bundle) {
      results.push({ bundle_id: p.user_id, ok: false, error: 'export failed' });
      continue;
    }
    try {
      const blob = encryptBundle(teamKey, Buffer.from(JSON.stringify(bundle), 'utf8'));
      const r = await fetchJson(
        `${getEndpointUrl()}/api/v1/teams/${encodeURIComponent(teamId)}/bundles`,
        {
          method: 'POST',
          body: JSON.stringify({
            bundle_id: p.user_id,
            device_id: deviceId,
            ciphertext: blob.toString('base64'),
            updated_at: Date.now(),
          }),
        },
        getSyncToken()
      );
      const data = r.json?.data as Record<string, unknown> | undefined;
      const ok = r.status === 200 && r.json?.code === 0;
      results.push({
        bundle_id: p.user_id,
        ok,
        version: ok && typeof data?.version === 'number' ? data.version : undefined,
        error: ok ? undefined : ((r.json?.msg as string) ?? `HTTP ${r.status}`),
      });
      if (ok) {
        // remember local meta so pull can skip our own fresh writes
        upsertBundleMeta(teamId, p.user_id, deviceId, typeof data?.version === 'number' ? (data.version as number) : 1);
      }
    } catch (err) {
      results.push({ bundle_id: p.user_id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

/**
 * Pull bundles newer than the local cursor, decrypt locally and import as new
 * profiles (importProfileBundle always creates a fresh id). Bundles that fail
 * decryption (foreign/stale team key) are skipped and reported.
 */
export async function pullTeamBundles(teamId: string, userIds?: string[]): Promise<PullResult> {
  const masterKey = getLocalTeamKey(teamId);
  if (!masterKey) return { pulled: 0, failed: 0, errors: ['team key not available locally'] };
  const teamKey = getTeamKeyOrThrow(teamId, masterKey);

  const since = getSyncCursor(teamId);
  const r = await fetchJson(
    `${getEndpointUrl()}/api/v1/teams/${encodeURIComponent(teamId)}/bundles?since=${since}`,
    {},
    getSyncToken()
  );
  if (r.status !== 200 || r.json?.code !== 0) {
    return { pulled: 0, failed: 0, errors: [(r.json?.msg as string) ?? `HTTP ${r.status}`] };
  }
  const data = r.json.data as Record<string, unknown> | undefined;
  const rows = (data?.list as RemoteBundleRow[] | undefined) ?? [];
  if (!Array.isArray(rows)) return { pulled: 0, failed: 0, errors: ['malformed pull response'] };

  let pulled = 0;
  let failed = 0;
  const errors: string[] = [];
  let maxUpdatedAt = since;

  for (const row of rows) {
    if (typeof row.updated_at === 'number' && row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at;
    if (userIds?.length && !userIds.includes(row.bundle_id)) continue;
    // skip bundles we just pushed from this device
    const meta = getBundleMeta(teamId, row.bundle_id);
    if (meta && meta.device_id === getDeviceId() && meta.version >= row.version) continue;
    try {
      const blob = Buffer.from(row.ciphertext, 'base64');
      const plain = decryptBundle(teamKey, blob);
      const bundle = JSON.parse(plain.toString('utf8')) as pm.ProfileBundle;
      pm.importProfileBundle(bundle);
      pulled += 1;
      upsertBundleMeta(teamId, row.bundle_id, row.device_id ?? null, row.version ?? 1, row.updated_at);
    } catch (err) {
      failed += 1;
      errors.push(`${row.bundle_id}: ${(err as Error).message}`);
    }
  }
  if (maxUpdatedAt > since) setSyncCursor(teamId, maxUpdatedAt);
  return { pulled, failed, errors: errors.slice(0, 20) };
}

/** Move a team profile to the OWNER's personal space (RBAC: transfer target). */
export function transferToOwnerPersonal(teamId: string, userId: string, ownerDeviceId: string): boolean {
  const local = getDeviceId();
  if (local !== ownerDeviceId) return false; // transfer only lands in the owner's space
  pm.importProfileBundle(pm.exportProfileBundle(userId) as pm.ProfileBundle);
  // remove from the team workspace
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tm = require('./teamManager') as typeof import('./teamManager');
  tm.removeProfileFromTeam(teamId, userId);
  return true;
}

// ---------------------------------------------------------------------------
// team_bundles_meta helpers
// ---------------------------------------------------------------------------

interface BundleMetaRow {
  team_id: string;
  bundle_id: string;
  device_id: string | null;
  version: number;
  updated_at: number;
}

function getBundleMeta(teamId: string, bundleId: string): BundleMetaRow | null {
  const row = getDb()
    .prepare('SELECT * FROM team_bundles_meta WHERE team_id = ? AND bundle_id = ?')
    .get(teamId, bundleId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    team_id: String(row.team_id),
    bundle_id: String(row.bundle_id),
    device_id: row.device_id ? String(row.device_id) : null,
    version: Number(row.version ?? 1),
    updated_at: Number(row.updated_at ?? 0),
  };
}

function upsertBundleMeta(
  teamId: string,
  bundleId: string,
  deviceId: string | null,
  version: number,
  updatedAt?: number
): void {
  const db = getDb();
  const ts = updatedAt ?? Date.now();
  const existing = db
    .prepare('SELECT version AS v, updated_at AS u FROM team_bundles_meta WHERE team_id = ? AND bundle_id = ?')
    .get(teamId, bundleId) as { v: number; u: number } | undefined;
  // last-write-wins by updated_at; ties broken by higher version
  if (existing && existing.u > ts) return;
  if (existing && existing.u === ts && existing.v >= version) return;
  db.prepare(
    `INSERT INTO team_bundles_meta (team_id, bundle_id, device_id, version, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(team_id, bundle_id) DO UPDATE SET device_id = excluded.device_id, version = excluded.version, updated_at = excluded.updated_at`
  ).run(teamId, bundleId, deviceId, version, ts);
}

function isRunningSafe(userId: string): boolean {
  try {
    // avoid a hard dependency cycle: launcher only
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isRunning } = require('../launcher/chromium') as { isRunning: (id: string) => boolean };
    return isRunning(userId);
  } catch {
    return false;
  }
}

function getLocalTeamKey(teamId: string): Buffer | null {
  // The raw master key lives in the local secret store (set on team
  // creation/invite accept).
  try {
    const stored = revealSecret(String(getSetting(`teamKey:${teamId}`) ?? ''));
    return stored ? Buffer.from(stored, 'base64') : null;
  } catch {
    return null;
  }
}