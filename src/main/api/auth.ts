import { Request, Response, NextFunction } from 'express';
import { getApiKey } from '../config';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '');
  if (token.length > 0 && token === getApiKey()) {
    next();
    return;
  }
  res.status(401).json({ code: -1, msg: 'unauthorized', data: {} });
}
