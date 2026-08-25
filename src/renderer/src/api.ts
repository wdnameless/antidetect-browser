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

export const api = {
  status: () => request<{ status: string; version: string }>('/status'),
  list: (opts?: { groupId?: string | null; page?: number; pageSize?: number; search?: string | null; platform?: string | null; status?: string | null }) => {
    const q = new URLSearchParams();
    if (opts?.groupId) q.set('group_id', opts.groupId);
    if (opts?.page) q.set('page', String(opts.page));
    if (opts?.pageSize) q.set('page_size', String(opts.pageSize));
    if (opts?.search) q.set('search', opts.search);
    if (opts?.platform) q.set('platform', opts.platform);
    if (opts?.status) q.set('status', opts.status);
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
};
