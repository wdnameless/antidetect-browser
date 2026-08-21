// Rate limiting for the Local API.
// Default limits provide protection against runaway loops while preventing
// UI blocking during regular desktop usage (filtering, rapid navigation).
// Throttled responses: HTTP 429 with { code: -1, msg: 'rate limit exceeded', data: { retry_after_ms } }.
import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 1000;

// Per-path limits (requests per second).
const LIMITS: Record<string, number> = {
  // Lists and queries: high throughput for responsive UI navigation (20 req/s)
  '/api/v1/browser/list': 20,
  '/api/v2/browser-profile/list': 20,
  '/api/v1/proxy/list': 20,
  '/api/v1/device/list': 20,
  '/api/v1/extension/list': 20,
  '/api/v1/group/list': 20,
  '/api/v1/device/mobile-presets': 20,
  '/api/v1/browser-profile/cookies/import': 5,
  '/api/v1/browser-profile/cookies/export': 5,
  // Heavy operations: allow moderate concurrency (10 req/s).
  '/api/v1/browser/start': 10,
  '/api/v1/browser/stop': 10,
  '/api/v1/browser/active': 20,
  '/status': 50,
};

const DEFAULT_LIMIT = 20;

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
