import express, { Express, Request, Response } from 'express';
import { Database } from 'sql.js';
import {
  authenticate,
  authorizeRole,
  checkWorkspaceAccess,
  generateToken,
  Role,
} from './auth';
import { logAudit, queryAudit } from './audit';
import { createRateLimiter } from './rateLimiter';

export interface ServerOptions {
  db: Database;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  onPersist?: () => void;
}

export function createServer(options: ServerOptions): Express {
  const { db, onPersist } = options;
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // Global rate limiter
  const limiter = createRateLimiter({
    windowMs: options.rateLimitWindowMs ?? 60000,
    maxRequests: options.rateLimitMax ?? 60,
  });
  app.use(limiter.middleware);

  // Health / Status endpoint
  app.get('/status', (_req: Request, res: Response) => {
    res.json({
      code: 0,
      msg: 'success',
      data: { status: 'ok', version: '1.0.0', service: 'team-sync-server' },
    });
  });

  // ---------------------------------------------------------------------------
  // Workspaces / Teams Creation
  // ---------------------------------------------------------------------------

  const handleCreateWorkspace = (req: Request, res: Response): void => {
    const workspaceId =
      req.body?.workspace_id || req.body?.team_id || req.body?.id;
    const ownerId =
      req.body?.owner_id || req.body?.owner_device_id || req.body?.user_id;
    const name = String(req.body?.name ?? workspaceId ?? 'Workspace');

    if (
      typeof workspaceId !== 'string' ||
      !workspaceId ||
      typeof ownerId !== 'string' ||
      !ownerId
    ) {
      res.status(400).json({
        code: 'INVALID_INPUT',
        msg: 'workspace_id and owner_id are required',
        data: {},
      });
      return;
    }

    const checkStmt = db.prepare('SELECT id FROM workspaces WHERE id = ?');
    checkStmt.bind([workspaceId]);
    if (checkStmt.step()) {
      checkStmt.free();
      res.status(409).json({
        code: 'ALREADY_EXISTS',
        msg: 'Workspace/Team already exists',
        data: {},
      });
      return;
    }
    checkStmt.free();

    const now = Date.now();
    const token = generateToken();

    // Insert workspace
    const wsStmt = db.prepare(
      'INSERT INTO workspaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)'
    );
    wsStmt.run([workspaceId, name, ownerId, now]);
    wsStmt.free();

    // Insert owner member
    const memStmt = db.prepare(
      'INSERT INTO members (id, workspace_id, user_id, role, token, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    memStmt.run([
      `mem_${now}_${Math.random().toString(36).substring(2, 8)}`,
      workspaceId,
      ownerId,
      'owner',
      token,
      'active',
      now,
    ]);
    memStmt.free();

    logAudit(db, {
      workspaceId,
      actor: ownerId,
      action: 'workspace_created',
      outcome: 'success',
      details: { name },
      timestamp: now,
    });
    onPersist?.();

    res.json({
      code: 0,
      msg: 'success',
      data: {
        workspace_id: workspaceId,
        team_id: workspaceId,
        token,
        role: 'owner',
      },
    });
  };

  app.post('/api/v1/workspaces', handleCreateWorkspace);
  app.post('/api/v1/teams', handleCreateWorkspace);

  // ---------------------------------------------------------------------------
  // Workspace Members Management (Owner only)
  // ---------------------------------------------------------------------------

  const handleAddMember = (req: Request, res: Response): void => {
    const targetWorkspace =
      req.params.workspace_id || req.params.team_id || req.params.id;
    const { user_id, member_id, role } = req.body ?? {};
    const effectiveUserId = String(user_id || member_id || '');
    const effectiveRole: Role = role === 'owner' || role === 'editor' ? role : 'viewer';

    if (!effectiveUserId) {
      res.status(400).json({
        code: 'INVALID_INPUT',
        msg: 'user_id is required',
        data: {},
      });
      return;
    }

    const token = generateToken();
    const now = Date.now();

    const memStmt = db.prepare(
      'INSERT INTO members (id, workspace_id, user_id, role, token, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    memStmt.run([
      `mem_${now}_${Math.random().toString(36).substring(2, 8)}`,
      targetWorkspace,
      effectiveUserId,
      effectiveRole,
      token,
      'active',
      now,
    ]);
    memStmt.free();

    logAudit(db, {
      workspaceId: targetWorkspace,
      actor: req.auth!.userId,
      action: 'member_added',
      outcome: 'success',
      details: { userId: effectiveUserId, role: effectiveRole },
      timestamp: now,
    });
    onPersist?.();

    res.json({
      code: 0,
      msg: 'success',
      data: {
        user_id: effectiveUserId,
        role: effectiveRole,
        token,
      },
    });
  };

  app.post(
    '/api/v1/workspaces/:workspace_id/members',
    authenticate(db),
    checkWorkspaceAccess,
    authorizeRole(['owner']),
    handleAddMember
  );
  app.post(
    '/api/v1/teams/:id/members',
    authenticate(db),
    checkWorkspaceAccess,
    authorizeRole(['owner']),
    handleAddMember
  );

  // ---------------------------------------------------------------------------
  // Bundle Push (Editor or Owner)
  // ---------------------------------------------------------------------------

  const handlePushBundle = (req: Request, res: Response): void => {
    const targetWorkspace =
      req.params.workspace_id || req.params.team_id || req.params.id;
    const actor = req.auth!.userId;
    const role = req.auth!.role;

    // Check role before processing
    if (role !== 'owner' && role !== 'editor') {
      logAudit(db, {
        workspaceId: targetWorkspace,
        actor,
        action: 'bundle_push',
        bundleId: req.body?.bundle_id || req.body?.id || null,
        outcome: 'denied',
        details: { reason: 'role-denied', requiredRoles: ['owner', 'editor'], role },
      });
      res.status(403).json({
        code: 'role-denied',
        msg: `Forbidden: role '${role}' is not authorized to push bundles`,
        data: {},
      });
      return;
    }

    const bundleId = req.body?.bundle_id || req.body?.id;
    const deviceId = req.body?.device_id || actor;
    const ciphertext = req.body?.ciphertext;
    const iv = req.body?.iv || req.body?.nonce || null;
    const authTag = req.body?.auth_tag || null;
    const clientUpdatedAt =
      typeof req.body?.updated_at === 'number' && req.body.updated_at > 0
        ? req.body.updated_at
        : Date.now();

    // Validation: validate required fields
    if (
      typeof bundleId !== 'string' ||
      !bundleId ||
      typeof ciphertext !== 'string' ||
      !ciphertext
    ) {
      logAudit(db, {
        workspaceId: targetWorkspace,
        actor,
        action: 'bundle_push',
        bundleId: bundleId ?? null,
        outcome: 'failure',
        details: { error: 'invalid payload fields' },
      });
      res.status(400).json({
        code: 'INVALID_INPUT',
        msg: 'bundle_id and ciphertext are required',
        data: {},
      });
      return;
    }

    // Verify ciphertext is valid base64
    const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (!base64Regex.test(ciphertext)) {
      logAudit(db, {
        workspaceId: targetWorkspace,
        actor,
        action: 'bundle_push',
        bundleId,
        outcome: 'failure',
        details: { error: 'corrupted bundle: invalid base64 encoding' },
      });
      res.status(400).json({
        code: 'CORRUPTED_BUNDLE',
        msg: 'Invalid ciphertext encoding (must be valid base64)',
        data: {},
      });
      return;
    }

    // Check existing bundle for version & conflict resolution
    const checkStmt = db.prepare(`
      SELECT version, updated_at
      FROM bundles
      WHERE workspace_id = ? AND id = ?
    `);
    checkStmt.bind([targetWorkspace, bundleId]);
    const existing = checkStmt.step()
      ? (checkStmt.getAsObject() as { version: number; updated_at: number })
      : null;
    checkStmt.free();

    let version: number;
    let applied = true;

    if (!existing) {
      version = 1;
      const insStmt = db.prepare(`
        INSERT INTO bundles (id, workspace_id, device_id, ciphertext, iv, auth_tag, version, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insStmt.run([
        bundleId,
        targetWorkspace,
        String(deviceId),
        ciphertext,
        iv,
        authTag,
        version,
        clientUpdatedAt,
        Date.now(),
      ]);
      insStmt.free();
    } else {
      // Last-Write-Wins: greater updated_at wins; tie broken by existing version > 1
      if (
        clientUpdatedAt < existing.updated_at ||
        (clientUpdatedAt === existing.updated_at && existing.version > 1)
      ) {
        // Stale write ignored
        applied = false;
        version = existing.version;
        logAudit(db, {
          workspaceId: targetWorkspace,
          actor,
          action: 'bundle_push',
          bundleId,
          outcome: 'failure',
          details: { conflict: 'stale write ignored', winningVersion: version },
        });
        res.json({
          code: 0,
          msg: 'stale write ignored',
          data: { version, applied: false },
        });
        return;
      }

      version = existing.version + 1;
      const updStmt = db.prepare(`
        UPDATE bundles
        SET ciphertext = ?, device_id = ?, iv = ?, auth_tag = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `);
      updStmt.run([
        ciphertext,
        String(deviceId),
        iv,
        authTag,
        version,
        clientUpdatedAt,
        targetWorkspace,
        bundleId,
      ]);
      updStmt.free();
    }

    logAudit(db, {
      workspaceId: targetWorkspace,
      actor,
      action: 'bundle_push',
      bundleId,
      outcome: 'success',
      details: { version, applied },
    });
    onPersist?.();

    res.json({
      code: 0,
      msg: 'success',
      data: {
        bundle_id: bundleId,
        version,
        applied,
      },
    });
  };

  app.post(
    '/api/v1/workspaces/:workspace_id/bundles',
    authenticate(db),
    checkWorkspaceAccess,
    handlePushBundle
  );
  app.post(
    '/api/v1/teams/:id/bundles',
    authenticate(db),
    checkWorkspaceAccess,
    handlePushBundle
  );

  // ---------------------------------------------------------------------------
  // Bundle Pull (Viewer, Editor, Owner)
  // ---------------------------------------------------------------------------

  const handlePullBundles = (req: Request, res: Response): void => {
    const targetWorkspace =
      req.params.workspace_id || req.params.team_id || req.params.id;
    const actor = req.auth!.userId;
    const since = Number(req.query.since ?? 0);

    let sql = `
      SELECT id, device_id, ciphertext, iv, auth_tag, version, updated_at
      FROM bundles
      WHERE workspace_id = ?
    `;
    const params: (string | number)[] = [targetWorkspace];

    if (Number.isFinite(since) && since > 0) {
      sql += ' AND updated_at > ?';
      params.push(since);
    }
    sql += ' ORDER BY updated_at DESC';

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows: Array<{
      bundle_id: string;
      device_id: string | null;
      ciphertext: string;
      iv?: string | null;
      auth_tag?: string | null;
      version: number;
      updated_at: number;
    }> = [];

    while (stmt.step()) {
      const obj = stmt.getAsObject() as {
        id: string;
        device_id: string | null;
        ciphertext: string;
        iv: string | null;
        auth_tag: string | null;
        version: number;
        updated_at: number;
      };
      rows.push({
        bundle_id: obj.id,
        device_id: obj.device_id,
        ciphertext: obj.ciphertext,
        iv: obj.iv,
        auth_tag: obj.auth_tag,
        version: obj.version,
        updated_at: obj.updated_at,
      });
    }
    stmt.free();

    logAudit(db, {
      workspaceId: targetWorkspace,
      actor,
      action: 'bundle_pull',
      outcome: 'success',
      details: { count: rows.length, since },
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        list: rows,
      },
    });
  };

  app.get(
    '/api/v1/workspaces/:workspace_id/bundles',
    authenticate(db),
    checkWorkspaceAccess,
    authorizeRole(['owner', 'editor', 'viewer']),
    handlePullBundles
  );
  app.get(
    '/api/v1/teams/:id/bundles',
    authenticate(db),
    checkWorkspaceAccess,
    authorizeRole(['owner', 'editor', 'viewer']),
    handlePullBundles
  );

  // ---------------------------------------------------------------------------
  // Audit Logs Query
  // ---------------------------------------------------------------------------

  const handleGetAuditLogs = (req: Request, res: Response): void => {
    const targetWorkspace =
      req.params.workspace_id || req.params.team_id || req.params.id;
    const since = req.query.since ? Number(req.query.since) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const actor = req.query.actor ? String(req.query.actor) : undefined;
    const action = req.query.action ? String(req.query.action) : undefined;

    const logs = queryAudit(db, targetWorkspace, {
      since,
      limit,
      actor,
      action,
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        list: logs,
      },
    });
  };

  app.get(
    '/api/v1/workspaces/:workspace_id/audit',
    authenticate(db),
    checkWorkspaceAccess,
    authorizeRole(['owner', 'editor']),
    handleGetAuditLogs
  );
  app.get(
    '/api/v1/teams/:id/audit',
    authenticate(db),
    checkWorkspaceAccess,
    authorizeRole(['owner', 'editor']),
    handleGetAuditLogs
  );

  // ---------------------------------------------------------------------------
  // 404 handler & error handler
  // ---------------------------------------------------------------------------

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: -1, msg: 'not found', data: {} });
  });

  return app;
}
