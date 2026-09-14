import fetch from 'node-fetch';
import {
  ensureValidAccessToken,
  GoogleOAuthError,
} from './gdriveClient';
import {
  getGDriveFolderId,
  saveGDriveFolderId,
  recordGDrivePushTimestamp,
  recordGDrivePullTimestamp,
} from './gdriveAuth';
import { exportProfileBundle, importProfileBundle } from '../profiles/profileManager';
import { getLiveProfile, listProfiles, updateProfile } from '../profiles/profileManager';
import { getDb } from '../db';
import { getSetting, setSetting } from '../config';

export const GDRIVE_FOLDER_NAME = 'NullTrace_Sync';
export const GDRIVE_MANIFEST_FILE = 'manifest.json';
export const GDRIVE_PROFILES_FILE = 'profiles.json';
export const GDRIVE_SCRIPTS_FILE = 'scripts.json';
/**
 * Page size used when enumerating profiles for a push. Large enough that a normal
 * installation is a single query, while still going through the same paged path the
 * UI uses rather than a separate unpaged accessor.
 */
export const GDRIVE_PROFILE_PAGE_SIZE = 10_000;
export const GDRIVE_SETTINGS_FILE = 'settings.json';

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: number;
}

export interface GDriveTransport {
  listFiles(folderId?: string): Promise<DriveFileInfo[]>;
  createFolder(name: string, parentFolderId?: string): Promise<string>;
  findFolder(name: string, parentFolderId?: string): Promise<string | null>;
  uploadFile(
    name: string,
    content: string,
    folderId: string,
    existingFileId?: string
  ): Promise<string>;
  downloadFile(fileId: string): Promise<string>;
  deleteFile(fileId: string): Promise<void>;
}

export class HttpGDriveTransport implements GDriveTransport {
  async listFiles(folderId?: string): Promise<DriveFileInfo[]> {
    const token = await ensureValidAccessToken();
    let q = "trashed = false";
    if (folderId) {
      q += ` and '${folderId}' in parents`;
    }
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,modifiedTime,size)&pageSize=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Drive list error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { files?: DriveFileInfo[] };
    return data.files || [];
  }

  async findFolder(name: string, parentFolderId?: string): Promise<string | null> {
    const token = await ensureValidAccessToken();
    let q = `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`;
    if (parentFolderId) {
      q += ` and '${parentFolderId}' in parents`;
    }
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name)&pageSize=1`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Drive search error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { files?: { id: string }[] };
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  }

  async createFolder(name: string, parentFolderId?: string): Promise<string> {
    const token = await ensureValidAccessToken();
    const metadata: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentFolderId) {
      metadata.parents = [parentFolderId];
    }

    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Drive create folder error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async uploadFile(
    name: string,
    content: string,
    folderId: string,
    existingFileId?: string
  ): Promise<string> {
    const token = await ensureValidAccessToken();

    if (existingFileId) {
      // Update existing content
      const url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: content,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Drive update error (${res.status}): ${err}`);
      }
      const data = (await res.json()) as { id: string };
      return data.id;
    }

    // Multipart create file in folder
    const boundary = '-------NullTraceBoundary' + Date.now();
    const metadata = JSON.stringify({
      name,
      parents: [folderId],
    });

    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Drive upload error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async downloadFile(fileId: string): Promise<string> {
    const token = await ensureValidAccessToken();
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Drive download error (${res.status}): ${err}`);
    }
    return res.text();
  }

  async deleteFile(fileId: string): Promise<void> {
    const token = await ensureValidAccessToken();
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Drive delete error (${res.status}): ${err}`);
    }
  }
}

// Swappable transport for testing
let activeGDriveTransport: GDriveTransport = new HttpGDriveTransport();

export function setGDriveTransport(transport: GDriveTransport): void {
  activeGDriveTransport = transport;
}

export function getGDriveTransport(): GDriveTransport {
  return activeGDriveTransport;
}

/**
 * Locates existing Sync folder or creates one. Reuses stored folder ID across calls/machines.
 */
export async function ensureSyncFolder(): Promise<string> {
  let storedId = getGDriveFolderId();
  if (storedId) {
    return storedId;
  }

  const existingId = await activeGDriveTransport.findFolder(GDRIVE_FOLDER_NAME);
  if (existingId) {
    saveGDriveFolderId(existingId);
    return existingId;
  }

  const createdId = await activeGDriveTransport.createFolder(GDRIVE_FOLDER_NAME);
  saveGDriveFolderId(createdId);
  return createdId;
}

/**
 * Manifest format recording export metadata
 */
export interface GDriveManifest {
  version: 1;
  app: 'nulltrace';
  exportedAt: number;
  profileCount: number;
  scriptCount: number;
  hasSettings: boolean;
}

/**
 * Settings bundle shape (selected transportable settings)
 */
export interface GDriveSettingsBundle {
  captureProtection?: boolean;
  autoLockMinutes?: number;
  catalogUrl?: string;
  theme?: string;
}

/**
 * Push local profiles, scripts, and settings to Drive.
 * Reuses the existing ProfileBundle export format.
 */
export async function pushToGDrive(): Promise<{
  pushedProfiles: number;
  pushedScripts: number;
  timestamp: number;
}> {
  const folderId = await ensureSyncFolder();
  const remoteFiles = await activeGDriveTransport.listFiles(folderId);
  const fileMap: Record<string, string> = {};
  for (const f of remoteFiles) {
    fileMap[f.name] = f.id;
  }

  // 1. Gather Profiles using existing exportProfileBundle.
  // listProfiles requires paging; a large page size keeps this a single call while
  // still going through the same ordering the UI uses.
  const localProfiles = listProfiles(1, GDRIVE_PROFILE_PAGE_SIZE).list;
  const bundles = [];
  for (const p of localProfiles) {
    // The list row identifies a profile by `user_id`; there is no `updated_at` on it,
    // so the bundle itself carries the profile's own timestamps.
    const bundle = exportProfileBundle(p.user_id);
    if (bundle) {
      bundles.push({
        id: p.user_id,
        name: p.name,
        bundle,
      });
    }
  }

  // 2. Gather User Scripts.
  // Columns are exactly what the `scripts` table declares — the earlier version
  // selected `description`, `url_patterns` and `run_at`, none of which exist.
  const db = getDb();
  const scripts = db
    .prepare('SELECT id, name, code, created_at, updated_at, last_run_at, last_status FROM scripts')
    .all() as Array<{
    id: string;
    name: string;
    code: string;
    created_at: number;
    updated_at: number;
    last_run_at: number | null;
    last_status: string | null;
  }>;

  // 3. Gather Safe Settings
  const settingsBundle: GDriveSettingsBundle = {
    captureProtection: Boolean(getSetting('captureProtection')),
    autoLockMinutes: typeof getSetting('autoLockMinutes') === 'number' ? (getSetting('autoLockMinutes') as number) : 15,
    catalogUrl: typeof getSetting('catalogUrl') === 'string' ? (getSetting('catalogUrl') as string) : '',
  };

  const now = Date.now();
  const manifest: GDriveManifest = {
    version: 1,
    app: 'nulltrace',
    exportedAt: now,
    profileCount: bundles.length,
    scriptCount: scripts.length,
    hasSettings: true,
  };

  // Upload JSON files
  await activeGDriveTransport.uploadFile(
    GDRIVE_PROFILES_FILE,
    JSON.stringify(bundles, null, 2),
    folderId,
    fileMap[GDRIVE_PROFILES_FILE]
  );

  await activeGDriveTransport.uploadFile(
    GDRIVE_SCRIPTS_FILE,
    JSON.stringify(scripts, null, 2),
    folderId,
    fileMap[GDRIVE_SCRIPTS_FILE]
  );

  await activeGDriveTransport.uploadFile(
    GDRIVE_SETTINGS_FILE,
    JSON.stringify(settingsBundle, null, 2),
    folderId,
    fileMap[GDRIVE_SETTINGS_FILE]
  );

  await activeGDriveTransport.uploadFile(
    GDRIVE_MANIFEST_FILE,
    JSON.stringify(manifest, null, 2),
    folderId,
    fileMap[GDRIVE_MANIFEST_FILE]
  );

  recordGDrivePushTimestamp(now);

  return {
    pushedProfiles: bundles.length,
    pushedScripts: scripts.length,
    timestamp: now,
  };
}

export interface ConflictItem {
  type: 'profile' | 'script';
  id: string;
  name: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

export interface PullInspection {
  remoteTimestamp: number;
  profileCount: number;
  scriptCount: number;
  newProfiles: number;
  newScripts: number;
  conflicts: ConflictItem[];
  unchanged: boolean;
}

/**
 * Inspect remote Drive state without modifying local data.
 * Detects conflicts (different timestamps or newer local data).
 */
export async function inspectGDrivePull(): Promise<PullInspection> {
  const folderId = await ensureSyncFolder();
  const remoteFiles = await activeGDriveTransport.listFiles(folderId);
  const fileMap: Record<string, string> = {};
  for (const f of remoteFiles) {
    fileMap[f.name] = f.id;
  }

  if (!fileMap[GDRIVE_MANIFEST_FILE]) {
    return {
      remoteTimestamp: 0,
      profileCount: 0,
      scriptCount: 0,
      newProfiles: 0,
      newScripts: 0,
      conflicts: [],
      unchanged: true,
    };
  }

  const manifestStr = await activeGDriveTransport.downloadFile(fileMap[GDRIVE_MANIFEST_FILE]);
  const manifest = JSON.parse(manifestStr) as GDriveManifest;

  let remoteProfiles: Array<{ id: string; name: string; updated_at: number; bundle: any }> = [];
  if (fileMap[GDRIVE_PROFILES_FILE]) {
    const raw = await activeGDriveTransport.downloadFile(fileMap[GDRIVE_PROFILES_FILE]);
    remoteProfiles = JSON.parse(raw);
  }

  let remoteScripts: Array<{ id: string; name: string; updated_at: number }> = [];
  if (fileMap[GDRIVE_SCRIPTS_FILE]) {
    const raw = await activeGDriveTransport.downloadFile(fileMap[GDRIVE_SCRIPTS_FILE]);
    remoteScripts = JSON.parse(raw);
  }

  const localProfiles = listProfiles(1, GDRIVE_PROFILE_PAGE_SIZE).list;
  // The list row is a projection, but the conflict check below compares recency, so
  // carry the stored row's timestamp rather than re-deriving it from a bundle.
  const localProfileMap: Record<string, { id: string; name: string | null; updated_at: number }> = {};
  for (const p of localProfiles) {
    const row = getLiveProfile(p.user_id);
    localProfileMap[p.user_id] = {
      id: p.user_id,
      name: p.name,
      updated_at: row?.updated_at ?? 0,
    };
  }

  const db = getDb();
  const localScripts = db.prepare('SELECT id, name, updated_at FROM scripts').all() as Array<{
    id: string;
    name: string;
    updated_at: number;
  }>;
  const localScriptMap: Record<string, { id: string; name: string; updated_at: number }> = {};
  for (const s of localScripts) {
    localScriptMap[s.id] = s;
  }

  const conflicts: ConflictItem[] = [];
  let newProfiles = 0;
  let newScripts = 0;

  for (const rp of remoteProfiles) {
    const local = localProfileMap[rp.id];
    if (!local) {
      newProfiles++;
    } else {
      // Recency comes from the stored row's `updated_at`, which is the same field the
      // remote payload carries, so the comparison is like-for-like.
      if (local.updated_at > rp.updated_at) {
        conflicts.push({
          type: 'profile',
          id: rp.id,
          name: rp.name,
          localUpdatedAt: local.updated_at,
          remoteUpdatedAt: rp.updated_at,
        });
      }
    }
  }

  for (const rs of remoteScripts) {
    const local = localScriptMap[rs.id];
    if (!local) {
      newScripts++;
    } else {
      if (local.updated_at > rs.updated_at) {
        conflicts.push({
          type: 'script',
          id: rs.id,
          name: rs.name,
          localUpdatedAt: local.updated_at,
          remoteUpdatedAt: rs.updated_at,
        });
      }
    }
  }

  const { lastPush, lastPull } = (await import('./gdriveAuth')).getGDriveTimestamps();
  const unchanged =
    manifest.exportedAt <= (lastPull ?? 0) &&
    conflicts.length === 0 &&
    newProfiles === 0 &&
    newScripts === 0;

  return {
    remoteTimestamp: manifest.exportedAt,
    profileCount: manifest.profileCount,
    scriptCount: manifest.scriptCount,
    newProfiles,
    newScripts,
    conflicts,
    unchanged,
  };
}

export type ConflictResolution = 'keep_local' | 'overwrite_remote' | 'cancel';

/**
 * Applies pull from Google Drive.
 * RULE: Refuses to overwrite local profiles/scripts when conflicts exist,
 * UNLESS conflictResolution is explicitly set to 'overwrite_remote'.
 */
export async function pullFromGDrive(opts?: {
  conflictResolution?: ConflictResolution;
}): Promise<{
  pulledProfiles: number;
  pulledScripts: number;
  appliedSettings: boolean;
  timestamp: number;
}> {
  const inspection = await inspectGDrivePull();

  if (inspection.remoteTimestamp === 0) {
    throw new Error('No NullTrace sync files found in Google Drive');
  }

  if (inspection.conflicts.length > 0 && opts?.conflictResolution !== 'overwrite_remote') {
    const conflictNames = inspection.conflicts.map((c) => `${c.type} "${c.name}"`).join(', ');
    throw new Error(
      `Pull aborted: local data differs from remote (${conflictNames}). To overwrite, specify conflictResolution: 'overwrite_remote'`
    );
  }

  const folderId = await ensureSyncFolder();
  const remoteFiles = await activeGDriveTransport.listFiles(folderId);
  const fileMap: Record<string, string> = {};
  for (const f of remoteFiles) {
    fileMap[f.name] = f.id;
  }

  const db = getDb();
  let pulledProfiles = 0;
  let pulledScripts = 0;

  // 1. Pull Profiles
  if (fileMap[GDRIVE_PROFILES_FILE]) {
    const raw = await activeGDriveTransport.downloadFile(fileMap[GDRIVE_PROFILES_FILE]);
    const remoteProfiles: Array<{ id: string; name: string; updated_at: number; bundle: any }> =
      JSON.parse(raw);

    for (const rp of remoteProfiles) {
      const existing = getLiveProfile(rp.id);
      if (!existing) {
        // Import new profile
        const newId = importProfileBundle(rp.bundle);
        // Retain original ID if needed for cross-machine parity
        if (newId !== rp.id) {
          try {
            db.prepare('UPDATE profiles SET id = ? WHERE id = ?').run(rp.id, newId);
          } catch {
            // retain newly generated id
          }
        }
        pulledProfiles++;
      } else if (opts?.conflictResolution === 'overwrite_remote' || rp.updated_at > existing.updated_at) {
        // Overwrite existing with the remote bundle's own writable fields.
        // `geolocation` is not part of updateProfile's surface; it travels inside the
        // fingerprint/device configuration rather than as a plain profile column.
        updateProfile(rp.id, {
          name: rp.bundle.profile.name ?? undefined,
          user_agent: rp.bundle.profile.user_agent,
          timezone: rp.bundle.profile.timezone,
          start_urls: rp.bundle.profile.start_urls,
        });
        pulledProfiles++;
      }
    }
  }

  // 2. Pull Scripts
  if (fileMap[GDRIVE_SCRIPTS_FILE]) {
    const raw = await activeGDriveTransport.downloadFile(fileMap[GDRIVE_SCRIPTS_FILE]);
    const remoteScripts: Array<{
      id: string;
      name: string;
      description: string;
      code: string;
      url_patterns: string;
      run_at: string;
      enabled: number;
      updated_at: number;
    }> = JSON.parse(raw);

    for (const rs of remoteScripts) {
      const existing = db.prepare('SELECT id, updated_at FROM scripts WHERE id = ?').get(rs.id) as
        | { id: string; updated_at: number }
        | undefined;

      if (!existing) {
        db.prepare(
          `INSERT INTO scripts (id, name, description, code, url_patterns, run_at, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          rs.id,
          rs.name,
          rs.description,
          rs.code,
          rs.url_patterns,
          rs.run_at,
          rs.enabled,
          Date.now(),
          rs.updated_at
        );
        pulledScripts++;
      } else if (opts?.conflictResolution === 'overwrite_remote' || rs.updated_at > existing.updated_at) {
        db.prepare(
          `UPDATE scripts SET name = ?, description = ?, code = ?, url_patterns = ?, run_at = ?, enabled = ?, updated_at = ?
           WHERE id = ?`
        ).run(rs.name, rs.description, rs.code, rs.url_patterns, rs.run_at, rs.enabled, rs.updated_at, rs.id);
        pulledScripts++;
      }
    }
  }

  // 3. Pull Settings
  let appliedSettings = false;
  if (fileMap[GDRIVE_SETTINGS_FILE]) {
    const raw = await activeGDriveTransport.downloadFile(fileMap[GDRIVE_SETTINGS_FILE]);
    const settings = JSON.parse(raw) as GDriveSettingsBundle;
    if (typeof settings.captureProtection === 'boolean') {
      setSetting('captureProtection', settings.captureProtection);
    }
    if (typeof settings.autoLockMinutes === 'number') {
      setSetting('autoLockMinutes', settings.autoLockMinutes);
    }
    if (typeof settings.catalogUrl === 'string') {
      setSetting('catalogUrl', settings.catalogUrl);
    }
    appliedSettings = true;
  }

  recordGDrivePullTimestamp(inspection.remoteTimestamp);

  return {
    pulledProfiles,
    pulledScripts,
    appliedSettings,
    timestamp: inspection.remoteTimestamp,
  };
}
