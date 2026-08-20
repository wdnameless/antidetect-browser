// AdsPower-parity rate limiting: list/cookies endpoints are limited to 1 request/second
// per client (per API key) per endpoint. Other endpoints are unlimited.
// Throttled responses: HTTP 429 with { code: -1, msg, data: { retry_after_ms } }.
import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 1000;
const MAX_REQUESTS = 1;

// Endpoints limited to 1 req/s (AdsPower parity). Keyed per (client, path).
const LIMITED_PATHS = new Set([
  '/api/v1/browser/list',
  '/api/v2/browser-profile/list',
  '/api/v1/proxy/list',
  '/api/v1/device/list',
  '/api/v1/extension/list',
  '/api/v1/group/list',
  '/api/v1/browser-profile/cookies/import',
  '/api/v1/browser-profile/cookies/export',
]);

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function clientKey(req: Request): string {
  const auth = req.headers.authorization || '';
  return auth ? `auth:${auth}` : `ip:${req.ip || 'anon'}`;
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!LIMITED_PATHS.has(req.path)) {
    next();
    return;
  }
  const key = `${clientKey(req)}|${req.method}|${req.path}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= WINDOW_MS) {
    b = { count: 0, windowStart: now };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > MAX_REQUESTS) {
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
