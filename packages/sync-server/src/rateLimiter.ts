import { Request, Response, NextFunction } from 'express';
import { extractBearerToken } from './auth';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options?: {
  windowMs?: number;
  maxRequests?: number;
}) {
  const windowMs = options?.windowMs ?? 60000;
  const maxRequests = options?.maxRequests ?? 60;
  const clients = new Map<string, RateLimitEntry>();

  // Cleanup old entries periodically
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clients.entries()) {
      if (now > entry.resetAt) {
        clients.delete(key);
      }
    }
  }, Math.max(windowMs, 30000));

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = token ? `token:${token}` : `ip:${ip}`;

    const now = Date.now();
    let entry = clients.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs };
      clients.set(key, entry);
    } else {
      entry.count += 1;
    }

    const remaining = Math.max(0, maxRequests - entry.count);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      res.status(429).json({
        code: 'RATE_LIMIT_EXCEEDED',
        msg: 'Too many requests, please try again later',
        data: {
          retryAfterMs: entry.resetAt - now,
        },
      });
      return;
    }

    next();
  };

  return {
    middleware,
    reset: () => clients.clear(),
  };
}
