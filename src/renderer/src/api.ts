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

interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

const API_BASE = 'http://127.0.0.1:50325';
let apiKey = '';

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
  return API_BASE;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers || {}),
    },
  });
  return (await res.json()) as ApiEnvelope<T>;
}

export interface GroupItem {
  id: string;
  name: string;
  created_at: number;
  profile_count: number;
}

export const api = {
  status: () => request<{ status: string; version: string }>('/status'),
  list: (groupId?: string | null) => {
    const url = groupId ? `/api/v1/browser/list?group_id=${encodeURIComponent(groupId)}` : '/api/v1/browser/list';
    return request<{ list: ProfileListItem[]; total: number; page: number; page_size: number }>(url);
  },
  create: (name?: string, groupId?: string, proxyId?: string, deviceId?: string) =>
    request<{ user_id: string }>('/api/v1/browser-profile/create', {
      method: 'POST',
      body: JSON.stringify({ name, group_id: groupId, proxy_id: proxyId, device_id: deviceId }),
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
    device_id?: string | null;
  }) =>
    request<Record<string, never>>('/api/v1/browser-profile/update', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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
  // Extensions (Sprint B)
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
  // Batch (Sprint C)
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
