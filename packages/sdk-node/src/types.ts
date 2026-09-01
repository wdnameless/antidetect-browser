export interface ClientConfig {
  baseUrl?: string;
  token?: string;
  timeout?: number;
}

export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

export interface BrowserStartData {
  ws?: {
    puppeteer?: string;
    selenium?: string;
  };
  pid?: number;
  debug_port?: number;
  [key: string]: unknown;
}

export interface ProfileItem {
  user_id: string;
  name: string;
  group_id?: string;
  browser_type?: 'chrome' | 'firefox';
  proxy_id?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

export interface ProfileListFilter {
  page?: number;
  page_size?: number;
  group_id?: string;
  name?: string;
}

export interface ProfileListResult {
  list: ProfileItem[];
  total?: number;
  page?: number;
  page_size?: number;
}

export interface CreateProfileParams {
  name: string;
  group_id?: string;
  proxy_id?: string;
  browser_type?: 'chrome' | 'firefox';
  os?: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  notes?: string;
  [key: string]: unknown;
}

export interface UpdateProfileParams {
  user_id: string;
  name?: string;
  group_id?: string;
  proxy_id?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface TemporaryProfileParams {
  name?: string;
  browser_type?: 'chrome' | 'firefox';
  proxy_id?: string;
  os?: 'windows' | 'macos' | 'linux';
  ttl_minutes?: number;
  [key: string]: unknown;
}

export interface ProxyItem {
  proxy_id?: string;
  id?: string;
  type: 'http' | 'https' | 'socks5' | 'ssh' | string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CreateProxyParams {
  type: 'http' | 'https' | 'socks5' | 'ssh' | string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  name?: string;
  [key: string]: unknown;
}

export interface UpdateProxyParams {
  proxy_id: string;
  type?: 'http' | 'https' | 'socks5' | 'ssh' | string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ProxyCheckResult {
  ok?: boolean;
  status?: string;
  latency_ms?: number;
  ip?: string;
  country?: string;
  [key: string]: unknown;
}

export interface DiagnosticReport {
  profileId: string;
  timestamp?: number;
  checks?: Record<string, unknown>;
  [key: string]: unknown;
}
