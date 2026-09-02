import type { PreflightVerdict } from './preflight';
let apiKey = '';

export interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

export interface StartResult {
  ws: { puppeteer: string; selenium: string };
  debug_port: string;
  webdriver: string;
  pid: number;
}

export interface ProfileListItem {
  user_id: string;
  name: string | null;
  status: string;
  group_id: string | null;
  proxy_type?: string | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_country?: string | null;
  fingerprint_seed?: number | null;
  platform?: string | null;
  device_name?: string | null;
}

export interface ProfileDetails {
  user_id: string;
  name: string | null;
  status: string;
  group_id: string | null;
  device_id: string | null;
  browser_type: string;
  user_agent: string | null;
  timezone: string | null;
  proxy?: {
    id: string;
    type: 'http' | 'https' | 'socks5' | 'ssh';
    host: string;
    port: number;
    username: string | null;
    country: string | null;
    timezone: string | null;
    status: string;
  } | null;
  fingerprint?: {
    seed: number;
    platform: string;
    hardwareConcurrency?: number;
    brand?: string;
    config: Record<string, unknown>;
  } | null;
  device?: {
    id: string;
    name: string;
    platform: string;
    config: Record<string, unknown>;
  } | null;
}

export interface ProxyItem {
  proxy_id: string;
  type: string;
  host: string;
  port: number;
  username: string | null;
  country: string | null;
  timezone: string | null;
  status: string;
}

export interface DeviceItem {
  device_id: string;
  name: string;
  platform: string;
  config: Record<string, unknown>;
}

export interface ExtensionItem {
  extension_id: string;
  name: string;
  path: string;
  version: string | null;
  enabled: boolean;
}

export interface GroupItem {
  id: string;
  name: string;
  created_at: number;
  profile_count: number;
}

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  country?: string;
  timezone?: string;
  latencyMs?: number;
  error?: string;
}

export async function initApiKey(): Promise<void> {
  if (window.antidetect?.getApiKey) {
    try {
      apiKey = await window.antidetect.getApiKey();
      return;
    } catch {
      // fall through to manual entry
    }
  }
  const stored = localStorage.getItem('apiKey');
  if (stored) {
    apiKey = stored;
    return;
  }
  const entered = window.prompt('Enter Local API key (printed in the service console):') || '';
  apiKey = entered;
  if (entered) localStorage.setItem('apiKey', entered);
}

export function getApiBase(): string {
  // Dev/test override: localStorage.apiBase (e.g. a second service instance on another port).
  const override = typeof localStorage !== 'undefined' ? localStorage.getItem('apiBase') : null;
  if (override && override.startsWith('http')) return override.replace(/\/$/, '');
  return 'http://127.0.0.1:50325';
}

async function request<T>(path: string, options: RequestInit = {}, retries = 3): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 429 && retries > 0) {
    let delayMs = 250;
    try {
      const data = (await res.clone().json()) as { data?: { retry_after_ms?: number } };
      if (typeof data?.data?.retry_after_ms === 'number') {
        delayMs = Math.max(data.data.retry_after_ms + 50, 100);
      }
    } catch {
      // fallback delay
    }
    await new Promise((r) => setTimeout(r, delayMs));
    return request<T>(path, options, retries - 1);
  }

  return (await res.json()) as ApiEnvelope<T>;
}

export interface CloudStateData {
  configured: boolean;
  url?: string;
  user?: string;
  hasToken?: boolean;
  connected?: boolean;
  version?: string;
  hasPassword?: boolean;
  authorized?: boolean;
  error?: string;
}

export interface CloudSessionItem {
  at: number;
  ip: string;
  ua: string;
  username: string;
}

export interface SyncResultRow {
  user_id: string;
  name: string;
  ok: boolean;
  new_id?: string;
  error?: string;
}

export interface TeamPermissions {
  can_run_profiles: boolean;
  can_add_profiles: boolean;
  can_remove_profiles: boolean;
  can_invite: boolean;
}

export interface TeamItem {
  id: string;
  name: string;
  owner_device_id: string;
  created_at: number;
  local_role: 'owner' | 'member' | null;
  local_status: 'pending' | 'active' | null;
  member_count: number;
}

export interface TeamMemberItem {
  team_id: string;
  member_id: string;
  email: string | null;
  role: 'owner' | 'member';
  permissions: TeamPermissions | null;
  status: 'pending' | 'active';
  joined_at: number | null;
  created_at: number;
}

export interface LicenseStateData {
  plan: 'free' | 'pro';
  email?: string;
  exp?: number;
  expired: boolean;
}

// ---- Sprint 2: vault / diagnostics / tags / trash ----

export interface VaultEntry {
  id: string;
  profile_id: string;
  label: string | null;
  login: string | null;
  has_password: boolean;
  has_totp: boolean;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface DiagnosticsReport {
  profile_id: string;
  ip: string | null;
  geo: { country?: string; city?: string; timezone?: string; lat?: number; lon?: number } | null;
  timezone: string | null;
  ip_timezone: string | null;
  timezone_match: 'ok' | 'warn' | null;
  webrtc: 'ok' | 'warn' | null;
  webrtc_addresses: string[];
  consistency: 'ok' | 'warn' | null;
  consistency_detail: string | null;
  dns_leak: null;
  collected_at: number;
}

export interface TagItem {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
  profile_count: number;
}

export interface ProfileTagBinding {
  tag_id: string;
  name: string;
  color: string | null;
}

export interface TrashItem {
  id: string;
  name: string | null;
  group_name: string | null;
  deleted_at: number;
  created_at: number;
}

// ---- Sprint 3: action syncer ----

export interface SyncSessionInfo {
  id: string;
  master_profile_id: string;
  created_at: number;
  status: string;
  members: string[];
}

export interface TileResult {
  tiled: string[];
  failed: Array<{ profile_id: string; error: string }>;
}

// ---- Sprint 4: script engine / keys / triggers / catalog ----

export interface ScriptItem {
  id: string;
  name: string;
  code: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  last_status: string | null;
}

export interface ScriptRunItem {
  id: string;
  script_id: string;
  profile_ids: string[];
  status: 'running' | 'done' | 'error' | 'timeout';
  log: string;
  started_at: number;
  finished_at: number | null;
}

export interface KeyItem {
  key: string;
  has_value: boolean;
  updated_at: number;
}

export interface TriggerItem {
  id: string;
  name: string;
  script_id: string;
  type: 'schedule' | 'event';
  schedule: string | null;
  event: 'profile_started' | 'profile_stopped' | null;
  enabled: number;
  last_fired_at: number | null;
  created_at: number;
}

export interface CatalogScriptItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  version: string;
  url: string;
  checksum_sha256: string;
}

export const api = {
  status: () => request<{ status: string; version: string }>('/status'),
  list: (opts?: { groupId?: string | null; page?: number; pageSize?: number; search?: string | null; platform?: string | null; status?: string | null; tagId?: string | null }) => {
    const q = new URLSearchParams();
    if (opts?.groupId) q.set('group_id', opts.groupId);
    if (opts?.page) q.set('page', String(opts.page));
    if (opts?.pageSize) q.set('page_size', String(opts.pageSize));
    if (opts?.search) q.set('search', opts.search);
    if (opts?.platform) q.set('platform', opts.platform);
    if (opts?.status) q.set('status', opts.status);
    if (opts?.tagId) q.set('tag_id', opts.tagId);
    const qs = q.toString();
    return request<{ list: ProfileListItem[]; total: number; page: number; page_size: number }>(
      `/api/v1/browser/list${qs ? `?${qs}` : ''}`
    );
  },
  profileDetail: (user_id: string) =>
    request<ProfileDetails>(`/api/v1/browser-profile/detail?user_id=${encodeURIComponent(user_id)}`),
  create: (body: {
    name?: string;
    group_id?: string;
    proxy_id?: string;
    proxy?: {
      type: 'http' | 'https' | 'socks5' | 'ssh';
      host: string;
      port: number;
      username?: string;
      password?: string;
    };
    device_id?: string;
    fingerprint_seed?: number;
    mobile_model_id?: string;
    user_agent?: string;
    timezone?: string;
  }) =>
    request<{ user_id: string }>('/api/v1/browser-profile/create', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  start: (id: string) =>
    request<StartResult>(`/api/v1/browser/start?user_id=${encodeURIComponent(id)}`),
  stop: (id: string) =>
    request<Record<string, never>>(`/api/v1/browser/stop?user_id=${encodeURIComponent(id)}`),
  profileUpdate: (body: {
    user_id: string;
    name?: string;
    group_id?: string | null;
    proxy_id?: string | null;
    proxy?: {
      type: 'http' | 'https' | 'socks5' | 'ssh';
      host: string;
      port: number;
      username?: string;
      password?: string;
    } | null;
    device_id?: string | null;
    mobile_model_id?: string | null;
    user_agent?: string | null;
    timezone?: string | null;
  }) =>
    request<Record<string, never>>('/api/v1/browser-profile/update', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  profileDelete: (user_id: string) =>
    request<Record<string, never>>('/api/v1/browser-profile/delete', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),
  profileDuplicate: (user_id: string, name?: string) =>
    request<{ user_id: string }>('/api/v1/browser-profile/duplicate', {
      method: 'POST',
      body: JSON.stringify({ user_id, name }),
    }),
  profileExport: (user_id: string) =>
    request<{ bundle: Record<string, unknown> }>(
      `/api/v1/browser-profile/export?user_id=${encodeURIComponent(user_id)}`
    ),
  profileImportBundle: (bundle: Record<string, unknown>) =>
    request<{ user_id: string }>('/api/v1/browser-profile/import-bundle', {
      method: 'POST',
      body: JSON.stringify({ bundle }),
    }),
  logsList: () =>
    request<{ dir: string; list: Array<{ name: string; size: number; modified: number }> }>(
      '/api/v1/logs/list'
    ),
  logsGet: (name: string, tail = 500) =>
    request<{ name: string; content: string }>(
      `/api/v1/logs/get?name=${encodeURIComponent(name)}&tail=${tail}`
    ),
  kernelInfo: () => request<{ installed: string | null }>('/api/v1/kernel/info'),
  kernelCheckUpdate: () =>
    request<{ installed: string | null; latest: string | null; updateAvailable: boolean; releaseUrl?: string; error?: string }>(
      '/api/v1/kernel/check-update'
    ),
  bulkStart: (user_ids: string[]) =>
    request<{ succeeded: Array<{ user_id: string }>; failed: Array<{ user_id: string; error: string }>; total: number }>(
      '/api/v1/browser-profile/bulk-start',
      { method: 'POST', body: JSON.stringify({ user_ids }) }
    ),
  bulkStop: (user_ids: string[]) =>
    request<{ succeeded: string[]; failed: Array<{ user_id: string; error: string }>; total: number }>(
      '/api/v1/browser-profile/bulk-stop',
      { method: 'POST', body: JSON.stringify({ user_ids }) }
    ),
  bulkDelete: (user_ids: string[]) =>
    request<{ succeeded: string[]; failed: Array<{ user_id: string; error: string }>; total: number }>(
      '/api/v1/browser-profile/bulk-delete',
      { method: 'POST', body: JSON.stringify({ user_ids }) }
    ),
  bulkGroup: (user_ids: string[], group_id: string | null) =>
    request<{ succeeded: string[]; failed: Array<{ user_id: string; error: string }>; total: number }>(
      '/api/v1/browser-profile/bulk-group',
      { method: 'POST', body: JSON.stringify({ user_ids, group_id }) }
    ),
  randomizeFingerprint: (user_id: string) =>
    request<{ seed: number }>('/api/v1/browser-profile/randomize-fingerprint', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),
  groupList: () => request<{ list: GroupItem[] }>('/api/v1/group/list'),
  groupCreate: (name: string) =>
    request<{ group_id: string }>('/api/v1/group/create', { method: 'POST', body: JSON.stringify({ name }) }),
  groupUpdate: (group_id: string, name: string) =>
    request<Record<string, never>>('/api/v1/group/update', { method: 'POST', body: JSON.stringify({ group_id, name }) }),
  groupDelete: (group_id: string) =>
    request<Record<string, never>>('/api/v1/group/delete', { method: 'POST', body: JSON.stringify({ group_id }) }),
  proxyList: () => request<{ list: ProxyItem[]; total: number }>('/api/v1/proxy/list'),
  proxyCreate: (body: Record<string, unknown>) =>
    request<{ proxy_id: string }>('/api/v1/proxy/create', { method: 'POST', body: JSON.stringify(body) }),
  proxyImportList: (text: string, defaultProtocol: 'http' | 'https' | 'socks5') =>
    request<{ created: number; duplicates: number; invalid: number; proxy_ids: string[] }>(
      '/api/v1/proxy/import-list',
      { method: 'POST', body: JSON.stringify({ text, defaultProtocol }) }
    ),
  backupsList: () =>
    request<{ list: Array<{ name: string; size: number; modified: number }> }>('/api/v1/backups/list'),
  backupRestore: (name: string) =>
    request<{ restart_required: boolean }>('/api/v1/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  dataScan: () =>
    request<{ current: string; found: Array<{ dir: string; isCurrent: boolean; dbSize: number; modified: number; profiles: number }> }>(
      '/api/v1/data/scan'
    ),
  proxyTest: (body: { type: string; host: string; port: number; username?: string; password?: string }) =>
    request<ProxyTestResult>('/api/v1/proxy/test', { method: 'POST', body: JSON.stringify(body) }),
  proxyCheck: (proxy_id: string) =>
    request<{ ok: boolean; ip?: string; country?: string; timezone?: string; latencyMs?: number; error?: string }>(
      '/api/v1/proxy/check',
      { method: 'POST', body: JSON.stringify({ proxy_id }) }
    ),
  proxyDelete: (proxy_id: string) =>
    request<Record<string, never>>('/api/v1/proxy/delete', {
      method: 'POST',
      body: JSON.stringify({ proxy_id }),
    }),
  deviceList: () => request<{ list: DeviceItem[]; total: number }>('/api/v1/device/list'),
  mobilePresets: () =>
    request<{ list: Array<{ id: string; name: string; model: string; androidVersion: string; gpu: string }> }>(
      '/api/v1/device/mobile-presets'
    ),
  extensionList: () => request<{ list: ExtensionItem[]; total: number }>('/api/v1/extension/list'),
  extensionImport: (name: string, path: string) =>
    request<{ extension_id: string }>('/api/v1/extension/import', {
      method: 'POST',
      body: JSON.stringify({ name, path }),
    }),
  extensionDelete: (extension_id: string) =>
    request<Record<string, never>>('/api/v1/extension/delete', {
      method: 'POST',
      body: JSON.stringify({ extension_id }),
    }),
  profileBindExtensions: (user_id: string, extension_ids: string[]) =>
    request<{ count: number }>('/api/v1/browser-profile/extensions/bind', {
      method: 'POST',
      body: JSON.stringify({ user_id, extension_ids }),
    }),
  profileExtensionsBind: (user_id: string, extension_ids: string[]) =>
    request<{ count: number }>('/api/v1/browser-profile/extensions/bind', {
      method: 'POST',
      body: JSON.stringify({ user_id, extension_ids }),
    }),
  profileExtensions: (user_id: string) =>
    request<{ extension_ids: string[] }>(
      `/api/v1/browser-profile/extensions?user_id=${encodeURIComponent(user_id)}`
    ),
  cookiesImport: (user_id: string, cookies: Array<Record<string, unknown>>) =>
    request<{ count: number }>('/api/v1/browser-profile/cookies/import', {
      method: 'POST',
      body: JSON.stringify({ user_id, cookies }),
    }),
  cookiesExport: (user_id: string) =>
    request<{ cookies: Array<Record<string, unknown>>; source: string }>(
      `/api/v1/browser-profile/cookies/export?user_id=${encodeURIComponent(user_id)}`
    ),
  profileUpdateFingerprint: (user_id: string, config: Record<string, unknown>) =>
    request<Record<string, never>>('/api/v1/browser-profile/fingerprint', {
      method: 'POST',
      body: JSON.stringify({ user_id, config }),
    }),
  batchCreate: (body: { count: number; name_prefix?: string; proxy_ids?: string[]; device_id?: string }) =>
    request<{ user_ids: string[]; count: number }>('/api/v1/browser-profile/batch-create', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  batchDelete: (user_ids: string[]) =>
    request<{ deleted: number }>('/api/v1/browser-profile/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ user_ids }),
    }),
  batchBindProxy: (user_ids: string[], proxy_ids: string[]) =>
    request<{ updated: number }>('/api/v1/browser-profile/batch-bind-proxy', {
      method: 'POST',
      body: JSON.stringify({ user_ids, proxy_ids }),
    }),
  importCsv: (csv: string) =>
    request<{ user_ids: string[]; count: number }>('/api/v1/browser-profile/import', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  // ---- Cloud Sync (bridge endpoints on the LOCAL service) ----
  cloudState: () => request<CloudStateData>('/api/v1/cloud/state'),
  cloudConnect: (url: string) =>
    request<CloudStateData>('/api/v1/cloud/connect', { method: 'POST', body: JSON.stringify({ url }) }),
  cloudSetup: (username: string, password: string) =>
    request<{ username: string }>('/api/v1/cloud/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  cloudLogin: (username: string, password: string) =>
    request<{ username: string }>('/api/v1/cloud/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  cloudDisconnect: () => request<Record<string, never>>('/api/v1/cloud/disconnect', { method: 'POST' }),
  cloudSessions: () => request<{ list: CloudSessionItem[] }>('/api/v1/cloud/sessions'),
  cloudRemoteList: () => request<{ list: ProfileListItem[]; total: number }>('/api/v1/cloud/remote-list'),
  cloudPush: (user_ids?: string[]) =>
    request<{ pushed: number; failed: number; results: SyncResultRow[] }>('/api/v1/cloud/push', {
      method: 'POST',
      body: JSON.stringify({ user_ids: user_ids ?? null }),
    }),
  cloudPull: (user_ids?: string[]) =>
    request<{ pulled: number; failed: number; results: SyncResultRow[] }>('/api/v1/cloud/pull', {
      method: 'POST',
      body: JSON.stringify({ user_ids: user_ids ?? null }),
    }),
  // ---- Teams / RBAC (Pro) ----
  teamsList: () =>
    request<{ list: TeamItem[]; active_workspace: string }>('/api/v1/teams'),
  teamCreate: (name: string) =>
    request<{ team_id: string; name: string; role: string }>('/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  teamUpdate: (teamId: string, name: string) =>
    request<{ team_id: string; name: string }>(`/api/v1/teams/${encodeURIComponent(teamId)}/update`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  teamDelete: (teamId: string) =>
    request<{ team_id: string; deleted: boolean }>(`/api/v1/teams/${encodeURIComponent(teamId)}/delete`, {
      method: 'POST',
    }),
  teamMembers: (teamId: string) =>
    request<{ list: TeamMemberItem[] }>(`/api/v1/teams/${encodeURIComponent(teamId)}/members`),
  teamInvite: (teamId: string, email: string, permissions: TeamPermissions) =>
    request<{ member_id: string; activation_code?: string }>(`/api/v1/teams/${encodeURIComponent(teamId)}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email, permissions }),
    }),
  inviteAccept: (teamId: string, email: string, activation_code: string) =>
    request<{ team_id: string; status: string }>('/api/v1/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ team_id: teamId, email, activation_code }),
    }),
  teamInviteCancel: (teamId: string, member_id: string) =>
    request<{ cancelled: boolean }>(`/api/v1/teams/${encodeURIComponent(teamId)}/invites/cancel`, {
      method: 'POST',
      body: JSON.stringify({ member_id }),
    }),
  teamMemberRemove: (teamId: string, member_id: string) =>
    request<{ removed: boolean }>(`/api/v1/teams/${encodeURIComponent(teamId)}/members/remove`, {
      method: 'POST',
      body: JSON.stringify({ member_id }),
    }),
  teamMemberPermissions: (teamId: string, member_id: string, permissions: Partial<TeamPermissions>) =>
    request<{ permissions: TeamPermissions }>(`/api/v1/teams/${encodeURIComponent(teamId)}/members/permissions`, {
      method: 'POST',
      body: JSON.stringify({ member_id, permissions }),
    }),
  teamProfiles: (teamId: string) =>
    request<{ list: string[] }>(`/api/v1/teams/${encodeURIComponent(teamId)}/profiles`),
  workspaceSetActive: (workspace: string) =>
    request<{ workspace: string }>('/api/v1/workspace/active', {
      method: 'POST',
      body: JSON.stringify({ workspace }),
    }),
  // ---- Sync (Pro) ----
  syncEndpoint: () =>
    request<{ mode: 'cloud' | 'custom'; url: string; default_url: string; customUrl?: string }>('/api/v1/sync/endpoint'),
  syncEndpointSet: (mode: 'cloud' | 'custom', url?: string) =>
    request<{ mode: string; url: string }>('/api/v1/sync/endpoint', {
      method: 'POST',
      body: JSON.stringify({ mode, url }),
    }),
  syncStatus: () =>
    request<{ connected: boolean; url: string; error?: string; version?: string; token: boolean }>('/api/v1/sync/status'),
  teamPush: (teamId: string, user_ids?: string[]) =>
    request<{ pushed: number; failed: number; results: Array<{ bundle_id: string; ok: boolean; error?: string }> }>(
      `/api/v1/teams/${encodeURIComponent(teamId)}/push`,
      { method: 'POST', body: JSON.stringify({ user_ids: user_ids ?? null }) }
    ),
  teamPull: (teamId: string, user_ids?: string[]) =>
    request<{ pulled: number; failed: number; errors: string[] }>(
      `/api/v1/teams/${encodeURIComponent(teamId)}/pull`,
      { method: 'POST', body: JSON.stringify({ user_ids: user_ids ?? null }) }
    ),
  // ---- License ----
  licenseState: () => request<LicenseStateData>('/api/v1/license/state'),
  licenseActivate: (key: string) =>
    request<LicenseStateData>('/api/v1/license/activate', { method: 'POST', body: JSON.stringify({ key }) }),
  licenseDeactivate: () => request<LicenseStateData>('/api/v1/license/deactivate', { method: 'POST' }),
  // ---- Vault (Sprint 2.1) ----
  vaultList: (profileId: string) =>
    request<{ list: VaultEntry[] }>(`/api/v1/accounts/${encodeURIComponent(profileId)}`),
  vaultCreate: (profileId: string, body: { label?: string; login?: string; password?: string; totp_secret?: string; notes?: string }) =>
    request<{ id: string }>(`/api/v1/accounts/${encodeURIComponent(profileId)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  vaultUpdate: (profileId: string, entryId: string, body: { label?: string; login?: string; password?: string; totp_secret?: string; notes?: string }) =>
    request<{ id: string }>(`/api/v1/accounts/${encodeURIComponent(profileId)}/${encodeURIComponent(entryId)}/update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  vaultDelete: (profileId: string, entryId: string) =>
    request<{ deleted: boolean }>(`/api/v1/accounts/${encodeURIComponent(profileId)}/${encodeURIComponent(entryId)}/delete`, {
      method: 'POST',
    }),
  vaultReveal: (profileId: string, entryId: string, field: 'password' | 'totp_secret') =>
    request<{ value: string }>(
      `/api/v1/accounts/${encodeURIComponent(profileId)}/${encodeURIComponent(entryId)}/reveal?field=${field}`
    ),
  // ---- Diagnostics (Sprint 2.2) ----
  diagnosticsRun: (profileId: string) =>
    request<DiagnosticsReport>(`/api/v1/diagnostics/${encodeURIComponent(profileId)}`),
  // ---- Tags (Sprint 2.3) ----
  tagsList: () => request<{ list: TagItem[] }>('/api/v1/tags'),
  tagCreate: (name: string, color?: string) =>
    request<{ id: string }>('/api/v1/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  tagUpdate: (tagId: string, body: { name?: string; color?: string | null }) =>
    request<{ id: string }>(`/api/v1/tags/${encodeURIComponent(tagId)}/update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  tagDelete: (tagId: string) =>
    request<{ deleted: boolean }>(`/api/v1/tags/${encodeURIComponent(tagId)}/delete`, { method: 'POST' }),
  tagAttach: (tagId: string, userIds: string[]) =>
    request<{ attached: number }>(`/api/v1/tags/${encodeURIComponent(tagId)}/attach`, {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds }),
    }),
  tagDetach: (tagId: string, userIds: string[]) =>
    request<{ detached: number }>(`/api/v1/tags/${encodeURIComponent(tagId)}/detach`, {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds }),
    }),
  profileTags: (userId: string) =>
    request<{ tags: ProfileTagBinding[] }>(
      `/api/v1/browser-profile/tags?user_id=${encodeURIComponent(userId)}`
    ),
  // ---- Trash (Sprint 2.4) ----
  trashList: () => request<{ list: TrashItem[] }>('/api/v1/trash'),
  trashRestore: (id: string) =>
    request<{ restored: boolean }>(`/api/v1/trash/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  trashDeleteForever: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/trash/${encodeURIComponent(id)}/delete`, { method: 'POST' }),
  // ---- Export (Sprint 2.5) ----
  exportCsvUrl: () => `${getApiBase()}/api/v1/profiles/export-csv`,
  // ---- Action syncer (Sprint 3) ----
  syncCreate: (profileIds: string[]) =>
    request<SyncSessionInfo>('/api/v1/sync/sessions', {
      method: 'POST',
      body: JSON.stringify({ profile_ids: profileIds }),
    }),
  syncList: () => request<{ list: SyncSessionInfo[] }>('/api/v1/sync/sessions'),
  syncStop: (sessionId: string) =>
    request<{ stopped: boolean }>(`/api/v1/sync/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }),
  syncJoin: (sessionId: string, profileId: string) =>
    request<SyncSessionInfo>(`/api/v1/sync/sessions/${encodeURIComponent(sessionId)}/join`, {
      method: 'POST',
      body: JSON.stringify({ profile_id: profileId }),
    }),
  syncLeave: (sessionId: string, profileId: string) =>
    request<SyncSessionInfo>(`/api/v1/sync/sessions/${encodeURIComponent(sessionId)}/leave`, {
      method: 'POST',
      body: JSON.stringify({ profile_id: profileId }),
    }),
  syncTile: (sessionId: string, layout: '2x2' | '3x3' | 'auto') =>
    request<TileResult>('/api/v1/sync/tile', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, layout }),
    }),
  // ---- Scripts (Sprint 4) ----
  scriptsList: () => request<{ list: ScriptItem[] }>('/api/v1/scripts'),
  scriptGet: (id: string) => request<ScriptItem>(`/api/v1/scripts/${encodeURIComponent(id)}`),
  scriptCreate: (name: string, code: string) =>
    request<{ id: string }>('/api/v1/scripts', { method: 'POST', body: JSON.stringify({ name, code }) }),
  scriptUpdate: (id: string, body: { name?: string; code?: string }) =>
    request<Record<string, never>>(`/api/v1/scripts/${encodeURIComponent(id)}/update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  scriptDelete: (id: string) =>
    request<Record<string, never>>(`/api/v1/scripts/${encodeURIComponent(id)}/delete`, { method: 'POST' }),
  scriptRun: (id: string, profileIds: string[]) =>
    request<{ run_ids: string[]; queued: number }>(`/api/v1/scripts/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      body: JSON.stringify({ profile_ids: profileIds }),
    }),
  scriptRuns: (id: string) =>
    request<{ list: ScriptRunItem[] }>(`/api/v1/scripts/${encodeURIComponent(id)}/runs`),
  // ---- Keys (Sprint 4.2) ----
  keysList: () => request<{ list: KeyItem[] }>('/api/v1/keys'),
  keySet: (key: string, value: string) =>
    request<{ key: string }>('/api/v1/keys', { method: 'POST', body: JSON.stringify({ key, value }) }),
  keyDelete: (key: string) =>
    request<Record<string, never>>(`/api/v1/keys/${encodeURIComponent(key)}/delete`, { method: 'POST' }),
  keyReveal: (key: string) =>
    request<{ value: string }>(`/api/v1/keys/${encodeURIComponent(key)}/reveal`),
  // ---- Triggers (Sprint 4.3) ----
  triggersList: () => request<{ list: TriggerItem[] }>('/api/v1/triggers'),
  triggerCreate: (body: { name: string; script_id: string; type: 'schedule' | 'event'; schedule?: string; event?: string }) =>
    request<{ id: string }>('/api/v1/triggers', { method: 'POST', body: JSON.stringify(body) }),
  triggerUpdate: (id: string, body: { name?: string; schedule?: string; event?: string }) =>
    request<Record<string, never>>(`/api/v1/triggers/${encodeURIComponent(id)}/update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  triggerToggle: (id: string, enabled: boolean) =>
    request<{ enabled: boolean }>(`/api/v1/triggers/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  triggerDelete: (id: string) =>
    request<Record<string, never>>(`/api/v1/triggers/${encodeURIComponent(id)}/delete`, { method: 'POST' }),
  // ---- Catalog (Sprint 4.4) ----
  catalogFetch: () => request<{ url: string; scripts: CatalogScriptItem[] }>('/api/v1/catalog'),
  catalogCode: (url: string) =>
    request<{ code: string; checksum: string }>(`/api/v1/catalog/code?url=${encodeURIComponent(url)}`),
  catalogInstall: (catalogId: string) =>
    request<{ id: string }>('/api/v1/catalog/install', {
      method: 'POST',
      body: JSON.stringify({ catalog_id: catalogId }),
    }),
  catalogGetUrl: () => request<{ url: string }>('/api/v1/catalog/url'),
  catalogSetUrl: (url: string) =>
    request<{ url: string }>('/api/v1/catalog/url', { method: 'POST', body: JSON.stringify({ url }) }),
  // ---- Preflight & Launch Guard (Task 3.1 & 3.2) ----
  preflightRun: (profileId: string) =>
    request<PreflightVerdict>(`/api/profiles/${encodeURIComponent(profileId)}/preflight`, {
      method: 'POST',
    }),
  preflightLast: (profileId: string) =>
    request<PreflightVerdict>(`/api/profiles/${encodeURIComponent(profileId)}/preflight/last`),
  startWithPreflight: (profileId: string, blockOnFail: boolean = false) =>
    request<{ profileId: string; allowed: boolean; verdict?: PreflightVerdict }>(
      `/api/profiles/${encodeURIComponent(profileId)}/start-with-preflight`,
      {
        method: 'POST',
        body: JSON.stringify({ blockOnFail }),
      }
    ),
};
