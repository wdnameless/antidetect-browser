import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { getApiKey } from '../config';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '');
  const expected = getApiKey();
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timing-safe comparison; length check first (length itself is not secret here)
  if (a.length === b.length && a.length > 0 && timingSafeEqual(a, b)) {
    next();
    return;
  }
  res.status(401).json({ code: -1, msg: 'unauthorized', data: {} });
}
