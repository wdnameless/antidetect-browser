// AdsPower-parity rate limiting for the Local API.
// All endpoints are rate-limited per (client, method, path); list/cookies are 1 req/s
// (AdsPower parity), heavy operations (start/stop) allow modest parallelism, everything
// else defaults to 10 req/s. Throttled responses: HTTP 429 with
// { code: -1, msg: 'rate limit exceeded', data: { retry_after_ms } }.
import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 1000;

// Per-path limits (requests per second). Paths not listed use DEFAULT_LIMIT.
const LIMITS: Record<string, number> = {
  // AdsPower parity: 1 req/s on list/cookies endpoints.
  '/api/v1/browser/list': 1,
  '/api/v2/browser-profile/list': 1,
  '/api/v1/proxy/list': 1,
  '/api/v1/device/list': 1,
  '/api/v1/extension/list': 1,
  '/api/v1/group/list': 1,
  '/api/v1/browser-profile/cookies/import': 1,
  '/api/v1/browser-profile/cookies/export': 1,
  // Heavy operations: allow modest parallelism (5 req/s).
  '/api/v1/browser/start': 5,
  '/api/v1/browser/stop': 5,
  '/api/v2/browser-profile/start': 5,
  '/api/v2/browser-profile/stop': 5,
};

const DEFAULT_LIMIT = 10;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export function getRateLimit(path: string): number {
  return LIMITS[path] ?? DEFAULT_LIMIT;
}

function clientKey(req: Request): string {
  const auth = req.headers.authorization || '';
  return auth ? `auth:${auth}` : `ip:${req.ip || 'anon'}`;
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const limit = getRateLimit(req.path);
  const key = `${clientKey(req)}|${req.method}|${req.path}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= WINDOW_MS) {
    b = { count: 0, windowStart: now };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > limit) {
    const retryAfterMs = Math.max(WINDOW_MS - (now - b.windowStart), 0);
    res.status(429).json({
      code: -1,
      msg: 'rate limit exceeded',
      data: { retry_after_ms: retryAfterMs },
    });
    return;
  }
  next();
}

// Prevent unbounded growth of the bucket map (idle clients).
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.windowStart >= WINDOW_MS * 2) buckets.delete(key);
  }
}, WINDOW_MS * 10).unref();
