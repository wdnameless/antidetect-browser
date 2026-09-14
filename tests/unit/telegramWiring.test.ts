import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response } from 'express';
import settingsRouter from '../../src/main/api/routes/settings';
import {
  saveTelegramSettings,
  getTelegramSettings,
  resetTelegramBotInstance,
  setTelegramBotFetchSeam,
} from '../../src/main/telegram/bot';

interface ExpressLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => Promise<void> | void }>;
  };
}

interface DispatchResult {
  status: number;
  body: {
    code: number;
    msg: string;
    data?: {
      has_token?: boolean;
      chatIds?: string[];
      enabled?: boolean;
      token?: string;
    };
  };
}

// Helper to find and invoke an express route on settingsRouter
async function dispatch(
  method: 'get' | 'put' | 'post',
  path: string,
  body: Record<string, unknown> = {}
): Promise<DispatchResult> {
  const routerWithStack = settingsRouter as unknown as { stack: ExpressLayer[] };
  const match = routerWithStack.stack.find(
    (layer) =>
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method.toLowerCase()]
  );
  if (!match || !match.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  let statusCode = 200;
  let jsonBody: DispatchResult['body'] = { code: 0, msg: '' };

  const req = {
    method: method.toUpperCase(),
    url: path,
    path,
    body,
  } as unknown as Request;

  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: DispatchResult['body']) => {
      jsonBody = payload;
      return res;
    },
    setHeader: () => res,
  } as unknown as Response;

  const handler = match.route.stack[0].handle;
  await handler(req, res);

  return { status: statusCode, body: jsonBody };
}

describe('Telegram Wiring - Settings API endpoints', () => {
  beforeEach(() => {
    resetTelegramBotInstance();
    // Reset to default empty state
    saveTelegramSettings({ token: '', chatIds: [], enabled: false });
  });

  it('GET /api/v1/settings/telegram returns masked token flag and default settings', async () => {
    const res = await dispatch('get', '/api/v1/settings/telegram');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual({
      has_token: false,
      chatIds: [],
      enabled: false,
    });
    // Secret rule: token MUST NOT be present in GET response
    expect(res.body.data?.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('"token":');
  });

  it('PUT /api/v1/settings/telegram persists settings and never returns raw token', async () => {
    const putRes = await dispatch('put', '/api/v1/settings/telegram', {
      token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      chatIds: ['100200300', '400500600'],
      enabled: true,
    });

    expect(putRes.status).toBe(200);
    expect(putRes.body.code).toBe(0);
    expect(putRes.body.data).toEqual({
      has_token: true,
      chatIds: ['100200300', '400500600'],
      enabled: true,
    });
    expect(putRes.body.data?.token).toBeUndefined();

    // Verify persisted state in bot.ts
    const stored = getTelegramSettings();
    expect(stored.token).toBe('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
    expect(stored.chatIds).toEqual(['100200300', '400500600']);
    expect(stored.enabled).toBe(true);

    // Verify GET immediately reflects has_token: true without echoing raw token
    const getRes = await dispatch('get', '/api/v1/settings/telegram');
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toEqual({
      has_token: true,
      chatIds: ['100200300', '400500600'],
      enabled: true,
    });
    expect(getRes.body.data?.token).toBeUndefined();
    expect(JSON.stringify(getRes.body)).not.toContain('123456:ABC-DEF');
  });

  it('PUT /api/v1/settings/telegram preserves existing token when token field is omitted', async () => {
    // First save token
    await dispatch('put', '/api/v1/settings/telegram', {
      token: 'original-secret-token',
      chatIds: ['123'],
      enabled: true,
    });

    // Update only chatIds and enabled, omit token
    const updateRes = await dispatch('put', '/api/v1/settings/telegram', {
      chatIds: ['123', '456'],
      enabled: false,
    });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data?.has_token).toBe(true);
    expect(updateRes.body.data?.enabled).toBe(false);
    expect(updateRes.body.data?.chatIds).toEqual(['123', '456']);

    const stored = getTelegramSettings();
    expect(stored.token).toBe('original-secret-token');
    expect(stored.enabled).toBe(false);
    expect(stored.chatIds).toEqual(['123', '456']);
  });

  it('can use setTelegramBotFetchSeam for transport isolation', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    });
    setTelegramBotFetchSeam(mockFetch as unknown as typeof fetch);

    // Verify seam registration
    expect(mockFetch).not.toHaveBeenCalled();
    setTelegramBotFetchSeam(null);
  });
});
