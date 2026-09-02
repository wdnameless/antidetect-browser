import { Request, Response, NextFunction } from 'express';
import { Database } from 'sql.js';
import * as crypto from 'crypto';

export type Role = 'owner' | 'editor' | 'viewer';

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: Role;
  token: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function generateToken(prefix = 'synk_'): string {
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  // Also support bare token
  if (parts.length === 1 && parts[0]) {
    return parts[0];
  }
  return null;
}

export function authenticate(db: Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        msg: 'Missing authentication token',
        data: {},
      });
      return;
    }

    const stmt = db.prepare(`
      SELECT workspace_id, user_id, role, status
      FROM members
      WHERE token = ? AND status = 'active'
    `);
    stmt.bind([token]);
    if (!stmt.step()) {
      stmt.free();
      res.status(401).json({
        code: 'UNAUTHORIZED',
        msg: 'Invalid or inactive authentication token',
        data: {},
      });
      return;
    }

    const row = stmt.getAsObject() as {
      workspace_id: string;
      user_id: string;
      role: Role;
      status: string;
    };
    stmt.free();

    req.auth = {
      workspaceId: row.workspace_id,
      userId: row.user_id,
      role: row.role,
      token,
    };

    next();
  };
}

export function authorizeRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        msg: 'Authentication required',
        data: {},
      });
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        code: 'role-denied',
        msg: `Forbidden: role '${req.auth.role}' is not authorized for this operation`,
        data: {},
      });
      return;
    }

    next();
  };
}

export function checkWorkspaceAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      msg: 'Authentication required',
      data: {},
    });
    return;
  }

  const requestedWorkspace = req.params.workspace_id || req.params.team_id || req.params.id;
  if (requestedWorkspace && requestedWorkspace !== req.auth.workspaceId) {
    res.status(403).json({
      code: 'workspace-forbidden',
      msg: `Forbidden: access to workspace '${requestedWorkspace}' denied`,
      data: {},
    });
    return;
  }

  next();
}
