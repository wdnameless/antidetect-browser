import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { getRateLimit, rateLimitMiddleware } from '../../src/main/api/rateLimit';

function makeReq(path: string): Request {
  return { path, method: 'GET', headers: {}, ip: '127.0.0.1' } as unknown as Request;
}

function makeRes(): { res: Response; status: number; body: unknown } {
  const state = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, status: state.status, get body() { return state.body; }, state };
}

describe('rateLimit', () => {
  it('known paths map to their configured limits', () => {
    expect(getRateLimit('/api/v1/browser/list')).toBe(20);
    expect(getRateLimit('/api/v1/browser/start')).toBe(10);
    expect(getRateLimit('/status')).toBe(50);
  });

  it('unknown paths use the default limit', () => {
    expect(getRateLimit('/api/v1/some/new/path')).toBe(20);
  });

  it('allows requests under the limit and passes through', () => {
    const next = vi.fn();
    for (let i = 0; i < 10; i++) {
      rateLimitMiddleware(makeReq('/api/v1/browser/list'), makeRes().res, next);
    }
    expect(next).toHaveBeenCalledTimes(10);
  });

  it('returns 429 with retry_after_ms once the limit is exceeded', () => {
    const path = '/api/v1/browser/start'; // limit 10/s
    let blocked = 0;
    let retryAfter = -1;
    for (let i = 0; i < 15; i++) {
      const { res, state } = makeRes();
      const next = vi.fn();
      rateLimitMiddleware(makeReq(path), res, next);
      if (state.status === 429) {
        blocked++;
        retryAfter = (state.body as { data?: { retry_after_ms?: number } })?.data?.retry_after_ms ?? -1;
      } else {
        expect(next).toHaveBeenCalled();
      }
    }
    expect(blocked).toBe(5); // 15 calls, limit 10 -> exactly 5 blocked
    expect(retryAfter).toBeGreaterThanOrEqual(0);
    expect(retryAfter).toBeLessThanOrEqual(1000);
  });

  it('buckets are isolated per path', () => {
    const next = vi.fn();
    // exhaust the list bucket
    for (let i = 0; i < 20; i++) {
      rateLimitMiddleware(makeReq('/api/v1/browser/list'), makeRes().res, next);
    }
    // a different path must still be allowed
    const { res, state } = makeRes();
    rateLimitMiddleware(makeReq('/api/v1/group/list'), res, next);
    expect(state.status).toBe(0);
    expect(next).toHaveBeenCalled();
  });
});
