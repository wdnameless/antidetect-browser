import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../src/main/api/auth';
import { getApiKey } from '../../src/main/config';

function makeReq(auth?: string): Request {
  return {
    headers: auth ? { authorization: auth } : {},
  } as unknown as Request;
}

function makeRes(): { res: Response; state: { status: number; body: unknown } } {
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
  return { res, state };
}

describe('authMiddleware', () => {
  it('passes through with a valid Bearer key', () => {
    const next = vi.fn();
    const { res, state } = makeRes();
    authMiddleware(makeReq(`Bearer ${getApiKey()}`), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(state.status).toBe(0);
  });

  it('rejects a wrong key with 401', () => {
    const next = vi.fn();
    const { res, state } = makeRes();
    authMiddleware(makeReq('Bearer 00000000-0000-0000-0000-000000000000'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.status).toBe(401);
  });

  it('rejects a missing header with 401', () => {
    const next = vi.fn();
    const { res, state } = makeRes();
    authMiddleware(makeReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.status).toBe(401);
  });

  it('rejects a key of different length with 401 (timing-safe path)', () => {
    const next = vi.fn();
    const { res, state } = makeRes();
    authMiddleware(makeReq('Bearer short'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.status).toBe(401);
  });
});
