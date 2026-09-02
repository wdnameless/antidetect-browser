import { ApiError } from './errors.js';
import type {
  ClientConfig,
  ApiResponse,
  BrowserStartData,
  ProfileItem,
  ProfileListFilter,
  ProfileListResult,
  CreateProfileParams,
  UpdateProfileParams,
  TemporaryProfileParams,
  ProxyItem,
  CreateProxyParams,
  UpdateProxyParams,
  ProxyCheckResult,
  DiagnosticReport,
} from './types.js';

export class AntidetectClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeout: number;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = (config.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    this.token = config.token;
    this.timeout = config.timeout ?? 30000;
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, unknown>;
    } = {}
  ): Promise<ApiResponse<T>> {
    const { method = 'GET', body, query } = options;

    let url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (query) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes('?') ? '&' : '?') + qs;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      throw new ApiError(`Network request failed: ${message}`, 0, -1, err);
    } finally {
      clearTimeout(timer);
    }

    let responseJson: unknown = null;
    try {
      responseJson = await response.json();
    } catch {
      // response body was not valid JSON
    }

    if (!response.ok) {
      let code = -1;
      let msg = `HTTP error ${response.status}: ${response.statusText}`;
      if (
        responseJson &&
        typeof responseJson === 'object' &&
        'msg' in responseJson &&
        typeof (responseJson as { msg: unknown }).msg === 'string'
      ) {
        msg = (responseJson as { msg: string }).msg;
      }
      if (
        responseJson &&
        typeof responseJson === 'object' &&
        'code' in responseJson &&
        typeof (responseJson as { code: unknown }).code === 'number'
      ) {
        code = (responseJson as { code: number }).code;
      }
      throw new ApiError(msg, response.status, code, responseJson);
    }

    const typedJson = responseJson as ApiResponse<T>;
    if (typedJson && typeof typedJson === 'object' && 'code' in typedJson && typedJson.code !== 0) {
      throw new ApiError(typedJson.msg || 'API returned failure code', response.status, typedJson.code, typedJson);
    }

    return typedJson;
  }

  public async getStatus(): Promise<ApiResponse<Record<string, unknown>>> {
    return this.request('/status');
  }

  public readonly profiles = {
    list: async (filter?: ProfileListFilter): Promise<ApiResponse<ProfileListResult>> => {
      return this.request<ProfileListResult>('/api/v1/browser/list', {
        method: 'GET',
        query: filter as Record<string, unknown>,
      });
    },

    get: async (userId: string): Promise<ApiResponse<ProfileItem>> => {
      return this.request<ProfileItem>('/api/v1/browser-profile/detail', {
        method: 'GET',
        query: { user_id: userId },
      });
    },

    create: async (params: CreateProfileParams): Promise<ApiResponse<ProfileItem>> => {
      return this.request<ProfileItem>('/api/v1/browser-profile/create', {
        method: 'POST',
        body: params,
      });
    },

    update: async (params: UpdateProfileParams): Promise<ApiResponse<ProfileItem>> => {
      return this.request<ProfileItem>('/api/v1/browser-profile/update', {
        method: 'POST',
        body: params,
      });
    },

    delete: async (userId: string): Promise<ApiResponse<Record<string, unknown>>> => {
      return this.request('/api/v1/browser-profile/delete', {
        method: 'POST',
        body: { user_id: userId },
      });
    },

    temporary: async (params?: TemporaryProfileParams): Promise<ApiResponse<ProfileItem>> => {
      return this.request<ProfileItem>('/api/v1/profiles/temporary', {
        method: 'POST',
        body: params || {},
      });
    },
  };

  public readonly browser = {
    start: async (
      userId: string,
      options: { headless?: boolean; proxy_id?: string; url?: string } = {}
    ): Promise<ApiResponse<BrowserStartData>> => {
      return this.request<BrowserStartData>('/api/v1/browser/start', {
        method: 'POST',
        body: { user_id: userId, ...options },
      });
    },

    stop: async (userId: string): Promise<ApiResponse<Record<string, unknown>>> => {
      return this.request('/api/v1/browser/stop', {
        method: 'POST',
        body: { user_id: userId },
      });
    },

    list: async (filter?: ProfileListFilter): Promise<ApiResponse<ProfileListResult>> => {
      return this.request<ProfileListResult>('/api/v1/browser/list', {
        method: 'GET',
        query: filter as Record<string, unknown>,
      });
    },
  };

  public readonly proxy = {
    list: async (): Promise<ApiResponse<{ list: ProxyItem[] }>> => {
      return this.request<{ list: ProxyItem[] }>('/api/v1/proxy/list', {
        method: 'GET',
      });
    },

    create: async (params: CreateProxyParams): Promise<ApiResponse<ProxyItem>> => {
      return this.request<ProxyItem>('/api/v1/proxy/create', {
        method: 'POST',
        body: params,
      });
    },

    update: async (params: UpdateProxyParams): Promise<ApiResponse<ProxyItem>> => {
      return this.request<ProxyItem>('/api/v1/proxy/update', {
        method: 'POST',
        body: params,
      });
    },

    delete: async (proxyId: string): Promise<ApiResponse<Record<string, unknown>>> => {
      return this.request('/api/v1/proxy/delete', {
        method: 'POST',
        body: { proxy_id: proxyId },
      });
    },

    check: async (proxyId: string): Promise<ApiResponse<ProxyCheckResult>> => {
      return this.request<ProxyCheckResult>('/api/v1/proxy/check', {
        method: 'POST',
        body: { proxy_id: proxyId },
      });
    },

    test: async (params: CreateProxyParams): Promise<ApiResponse<ProxyCheckResult>> => {
      return this.request<ProxyCheckResult>('/api/v1/proxy/test', {
        method: 'POST',
        body: params,
      });
    },
  };

  public readonly diagnostics = {
    run: async (profileId: string): Promise<ApiResponse<DiagnosticReport>> => {
      return this.request<DiagnosticReport>(`/api/v1/diagnostics/${encodeURIComponent(profileId)}`, {
        method: 'GET',
      });
    },
  };

  public readonly adspower = {
    userList: async (filter?: ProfileListFilter): Promise<ApiResponse<ProfileListResult>> => {
      return this.request<ProfileListResult>('/api/v1/user/list', {
        method: 'GET',
        query: filter as Record<string, unknown>,
      });
    },

    userCreate: async (params: Record<string, unknown>): Promise<ApiResponse<unknown>> => {
      return this.request('/api/v1/user/create', {
        method: 'POST',
        body: params,
      });
    },

    userUpdate: async (params: { user_id: string; [key: string]: unknown }): Promise<ApiResponse<unknown>> => {
      return this.request('/api/v1/user/update', {
        method: 'POST',
        body: params,
      });
    },

    userDelete: async (userIds: string[]): Promise<ApiResponse<unknown>> => {
      return this.request('/api/v1/user/delete', {
        method: 'POST',
        body: { user_ids: userIds },
      });
    },

    browserStart: async (
      userId: string,
      options: { headless?: boolean; [key: string]: unknown } = {}
    ): Promise<ApiResponse<BrowserStartData>> => {
      return this.request<BrowserStartData>('/api/v1/browser/start', {
        method: 'GET',
        query: { user_id: userId, ...options },
      });
    },

    browserStop: async (userId: string): Promise<ApiResponse<Record<string, unknown>>> => {
      return this.request('/api/v1/browser/stop', {
        method: 'GET',
        query: { user_id: userId },
      });
    },

    browserActive: async (): Promise<ApiResponse<unknown>> => {
      return this.request('/api/v1/browser/active', {
        method: 'GET',
      });
    },
  };
}
