// Teams API router (Sprint 1). All routes are Pro-gated: a Free license gets
// {code:"LICENSE_REQUIRED"}. Zod validates every request body.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as tm from '../../teams/teamManager';

const router = Router();

const permissionsSchema = z.object({
  can_run_profiles: z.boolean().optional(),
  can_add_profiles: z.boolean().optional(),
  can_remove_profiles: z.boolean().optional(),
  can_invite: z.boolean().optional(),
});

function licenseGate(res: Response): boolean {
  // lazy import avoids a module-load cycle with licensing
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { hasFeature } = require('../../licensing/licenseManager') as typeof import('../../licensing/licenseManager');
  if (hasFeature('teams')) return true;
  res.json({ code: 'LICENSE_REQUIRED', msg: 'Pro license required', data: {} });
  return false;
}

function fail(res: Response, r: { ok: false; code: string; msg: string }): void {
  const status = r.code === 'NOT_FOUND' ? 404 : r.code === 'INVALID_INPUT' ? 400 : 403;
  res.status(status).json({ code: r.code, msg: r.msg, data: {} });
}

router.get('/api/v1/teams', (_req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  res.json({ code: 0, msg: 'success', data: { list: tm.listTeams(), active_workspace: tm.getActiveWorkspace() } });
});

router.post('/api/v1/teams', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: parsed.error.issues[0]?.message ?? 'invalid input', data: {} });
    return;
  }
  const r = tm.createTeam(parsed.data.name);
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.get('/api/v1/teams/:id', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const team = tm.getTeam(String(req.params.id));
  if (!team) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'team not found', data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: team });
});

router.post('/api/v1/teams/:id/update', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'name is required (1..100 chars)', data: {} });
    return;
  }
  const r = tm.renameTeam(String(req.params.id), parsed.data.name);
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/teams/:id/delete', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const r = tm.deleteTeam(String(req.params.id));
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.get('/api/v1/teams/:id/members', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  res.json({ code: 0, msg: 'success', data: { list: tm.listMembers(String(req.params.id)) } });
});

router.post('/api/v1/teams/:id/invites', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z
    .object({
      email: z.string().email().max(254),
      permissions: permissionsSchema.optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'valid email required', data: {} });
    return;
  }
  const r = tm.inviteMember(String(req.params.id), parsed.data.email, parsed.data.permissions);
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: { ...r.data, activation_code: r.activation_code } });
});

router.post('/api/v1/invites/accept', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z
    .object({ team_id: z.string().min(1), email: z.string().email(), activation_code: z.string().min(6).max(64) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'team_id, email and activation_code are required', data: {} });
    return;
  }
  const r = tm.acceptInvite(parsed.data.team_id, parsed.data.email, parsed.data.activation_code);
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/teams/:id/invites/cancel', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ member_id: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'member_id required', data: {} });
    return;
  }
  const r = tm.cancelInvite(String(req.params.id), parsed.data.member_id);
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/teams/:id/members/remove', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ member_id: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'member_id required', data: {} });
    return;
  }
  const r = tm.removeMember(String(req.params.id), parsed.data.member_id);
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

router.post('/api/v1/teams/:id/members/permissions', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ member_id: z.string().min(1), permissions: permissionsSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'member_id and permissions required', data: {} });
    return;
  }
  const r = tm.updateMemberPermissions(String(req.params.id), parsed.data.member_id, parsed.data.permissions);
  if (!r.ok) {
    fail(res, r);
    return;
  }
  res.json({ code: 0, msg: 'success', data: r.data });
});

// ---- Workspace state ----

router.get('/api/v1/workspace/active', (_req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  res.json({ code: 0, msg: 'success', data: { workspace: tm.getActiveWorkspace() } });
});

router.post('/api/v1/workspace/active', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ workspace: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'workspace required', data: {} });
    return;
  }
  tm.setActiveWorkspace(parsed.data.workspace);
  res.json({ code: 0, msg: 'success', data: { workspace: tm.getActiveWorkspace() } });
});

// ---- Team profile bindings ----

router.get('/api/v1/teams/:id/profiles', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  res.json({ code: 0, msg: 'success', data: { list: tm.listTeamProfiles(String(req.params.id)) } });
});

router.post('/api/v1/teams/:id/profiles/add', (req: Request, res: Response) => {
  if (!licenseGate(res)) return;
  const parsed = z.object({ user_id: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'user_id required', data: {} });
    return;
  }
  // RBAC: adding profiles to a team needs can_add_profiles (or owner).
  if (!tm.checkPermission(String(req.params.id), 'can_add_profiles')) {
    res.status(403).json({ code: 'NO_PERMISSION', msg: 'can_add_profiles required', data: {} });
    return;
  }
  tm.addProfileToTeam(String(req.params.id), parsed.data.user_id);
  res.json({ code: 0, msg: 'success', data: {} });
});

export default router;