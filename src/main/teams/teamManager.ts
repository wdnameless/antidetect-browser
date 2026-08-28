// Team manager (Sprint 1): team CRUD, RBAC checks, invitations with
// activation codes and workspace state.
//
// RBAC matrix (see openspec specs/teams):
//   owner  — everything (rename, delete, remove members, invite, run/add/remove profiles)
//   member — flags: {can_run_profiles, can_add_profiles, can_remove_profiles, can_invite}
//   member removal is owner-only; moving a profile out of the team goes to the
//   OWNER's personal space only.
//
// The team master key lives ONLY on the owner's device (secret store). Invitees
// receive it wrapped with an HKDF key derived from their one-time activation
// code (teamCrypto.wrapMasterKeyForInvite).

import { getDb } from '../db';
import { getSetting, setSetting } from '../config';
import { protectSecret, revealSecret } from '../util/secretStore';
import {
  generateMasterKey,
  generateActivationCode,
  hashActivationCode,
  wrapMasterKeyForInvite,
  unwrapMasterKeyFromInvite,
  getDeviceId,
} from './teamCrypto';

export type TeamRole = 'owner' | 'member';
export type MemberStatus = 'pending' | 'active';

export interface MemberPermissions {
  can_run_profiles: boolean;
  can_add_profiles: boolean;
  can_remove_profiles: boolean;
  can_invite: boolean;
}

export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  can_run_profiles: true,
  can_add_profiles: false,
  can_remove_profiles: false,
  can_invite: false,
};

export interface TeamRow {
  id: string;
  name: string;
  owner_device_id: string;
  created_at: number;
}

export interface TeamMemberRow {
  team_id: string;
  member_id: string;
  email: string | null;
  role: TeamRole;
  permissions: MemberPermissions | null;
  status: MemberStatus;
  joined_at: number | null;
  created_at: number;
}

export interface TeamInfo extends TeamRow {
  local_role: TeamRole | null;
  local_status: MemberStatus | null;
  member_count: number;
}

export type TeamOpResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; msg: string };

function id(prefix: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomUUID } = require('crypto') as typeof import('crypto');
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parsePermissions(raw: unknown): MemberPermissions | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const p = JSON.parse(raw) as Partial<MemberPermissions>;
    return {
      can_run_profiles: Boolean(p.can_run_profiles),
      can_add_profiles: Boolean(p.can_add_profiles),
      can_remove_profiles: Boolean(p.can_remove_profiles),
      can_invite: Boolean(p.can_invite),
    };
  } catch {
    return null;
  }
}

/** Read the locally stored master key for a team (owner/accepted member only). */
export function getTeamMasterKey(teamId: string): Buffer | null {
  const stored = revealSecret(String(getSetting(`teamKey:${teamId}`) ?? ''));
  if (!stored) return null;
  return Buffer.from(stored, 'base64');
}

function storeTeamMasterKey(teamId: string, key: Buffer): void {
  setSetting(`teamKey:${teamId}`, protectSecret(key.toString('base64')) ?? '');
}

function rowToMember(row: Record<string, unknown>): TeamMemberRow {
  return {
    team_id: String(row.team_id),
    member_id: String(row.member_id),
    email: row.email ? String(row.email) : null,
    role: row.role === 'owner' ? 'owner' : 'member',
    permissions: parsePermissions(row.permissions),
    status: row.status === 'active' ? 'active' : 'pending',
    joined_at: typeof row.joined_at === 'number' ? row.joined_at : null,
    created_at: Number(row.created_at ?? 0),
  };
}

function rowToTeam(row: Record<string, unknown>): TeamRow {
  return {
    id: String(row.id),
    name: String(row.name),
    owner_device_id: String(row.owner_device_id),
    created_at: Number(row.created_at ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Team CRUD
// ---------------------------------------------------------------------------

/** Create a team; this device becomes the owner and holds the master key. */
export function createTeam(name: string): TeamOpResult {
  const teamName = str(name);
  if (!teamName || teamName.length > 100) {
    return { ok: false, code: 'INVALID_INPUT', msg: 'name is required (1..100 chars)' };
  }
  const db = getDb();
  const deviceId = getDeviceId();
  const teamId = id('team');
  const masterKey = generateMasterKey();

  db.prepare('INSERT INTO teams (id, name, owner_device_id, created_at) VALUES (?, ?, ?, ?)').run(
    teamId,
    teamName,
    deviceId,
    nowSec()
  );
  db.prepare(
    `INSERT INTO team_members (team_id, member_id, email, role, permissions, status, joined_at, created_at)
     VALUES (?, ?, NULL, 'owner', NULL, 'active', ?, ?)`
  ).run(teamId, deviceId, nowSec(), nowSec());
  storeTeamMasterKey(teamId, masterKey);

  return { ok: true, data: { team_id: teamId, name: teamName, role: 'owner' } };
}

/** List teams where the local device holds any membership. */
export function listTeams(): TeamInfo[] {
  const db = getDb();
  const deviceId = getDeviceId();
  const rows = db
    .prepare(
      `SELECT t.*, m.role AS my_role, m.status AS my_status,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count
       FROM teams t JOIN team_members m ON m.team_id = t.id AND m.member_id = ?
       ORDER BY t.created_at ASC`
    )
    .all(deviceId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...rowToTeam(row),
    local_role: (row.my_role === 'owner' ? 'owner' : 'member') as TeamRole | null,
    local_status: (row.my_status === 'active' ? 'active' : 'pending') as MemberStatus | null,
    member_count: Number(row.member_count ?? 0),
  }));
}

function getTeamRow(teamId: string): TeamRow | null {
  const row = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTeam(row) : null;
}

function getMemberRow(teamId: string, memberId: string): TeamMemberRow | null {
  const row = getDb()
    .prepare('SELECT * FROM team_members WHERE team_id = ? AND member_id = ?')
    .get(teamId, memberId) as Record<string, unknown> | undefined;
  return row ? rowToMember(row) : null;
}

export function getTeam(teamId: string): TeamInfo | null {
  const team = getTeamRow(teamId);
  if (!team) return null;
  const me = getMemberRow(teamId, getDeviceId());
  const count = getDb().prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(teamId) as {
    n: number;
  };
  return { ...team, local_role: me?.role ?? null, local_status: me?.status ?? null, member_count: Number(count.n) };
}

/** Rename a team (owner only). */
export function renameTeam(teamId: string, name: string): TeamOpResult {
  const teamName = str(name);
  if (!teamName || teamName.length > 100) {
    return { ok: false, code: 'INVALID_INPUT', msg: 'name is required (1..100 chars)' };
  }
  const team = getTeamRow(teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', msg: 'team not found' };
  if (team.owner_device_id !== getDeviceId()) {
    return { ok: false, code: 'NO_PERMISSION', msg: 'only the owner can rename the team' };
  }
  getDb().prepare('UPDATE teams SET name = ? WHERE id = ?').run(teamName, teamId);
  return { ok: true, data: { team_id: teamId, name: teamName } };
}

/** Delete a team (owner only). Removes memberships and local key material. */
export function deleteTeam(teamId: string): TeamOpResult {
  const team = getTeamRow(teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', msg: 'team not found' };
  if (team.owner_device_id !== getDeviceId()) {
    return { ok: false, code: 'NO_PERMISSION', msg: 'only the owner can delete the team' };
  }
  const db = getDb();
  db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM team_profiles WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM team_bundles_meta WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  setSetting(`teamKey:${teamId}`, '');
  const active = str(getSetting('activeWorkspace'));
  if (active === teamId) setSetting('activeWorkspace', 'personal');
  return { ok: true, data: { team_id: teamId, deleted: true } };
}

// ---------------------------------------------------------------------------
// Members & RBAC
// ---------------------------------------------------------------------------

export function listMembers(teamId: string): TeamMemberRow[] {
  const db = getDb();
  const me = getMemberRow(teamId, getDeviceId());
  if (!me || me.status !== 'active') return [];
  const rows = db
    .prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY created_at ASC')
    .all(teamId) as Array<Record<string, unknown>>;
  return rows.map(rowToMember);
}

/** Effective permission check. Owner always passes; members need the flag. */
export function checkPermission(teamId: string, flag: keyof MemberPermissions): boolean {
  const me = getMemberRow(teamId, getDeviceId());
  if (!me || me.status !== 'active') return false;
  if (me.role === 'owner') return true;
  return Boolean(me.permissions?.[flag]);
}

/**
 * Invite a member (owner, or member with can_invite). Returns a one-time
 * activation code plus the wrapped master key blob the invitee will receive.
 */
export function inviteMember(
  teamId: string,
  email: string,
  permissions: Partial<MemberPermissions> | undefined
): TeamOpResult & { activation_code?: string } {
  const team = getTeamRow(teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', msg: 'team not found' };
  if (!checkPermission(teamId, 'can_invite')) {
    return { ok: false, code: 'NO_PERMISSION', msg: 'inviting requires owner rights or can_invite' };
  }
  const mail = str(email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 254) {
    return { ok: false, code: 'INVALID_INPUT', msg: 'valid email is required' };
  }
  const db = getDb();
  const existing = db
    .prepare("SELECT member_id FROM team_members WHERE team_id = ? AND email = ? AND status IN ('pending','active')")
    .get(teamId, mail);
  if (existing) return { ok: false, code: 'ALREADY_MEMBER', msg: 'this email already has a membership' };

  const perms: MemberPermissions = { ...DEFAULT_MEMBER_PERMISSIONS, ...(permissions ?? {}) };
  const activationCode = generateActivationCode();
  const memberId = id('m');
  const masterKey = getTeamMasterKey(teamId);
  const keyBlob = masterKey
    ? wrapMasterKeyForInvite(masterKey, Buffer.from(activationCode, 'utf8'), teamId).toString('base64')
    : null;

  db.prepare(
    `INSERT INTO team_members (team_id, member_id, email, role, permissions, status, invite_code_hash, key_blob, created_at)
     VALUES (?, ?, ?, 'member', ?, 'pending', ?, ?, ?)`
  ).run(teamId, memberId, mail, JSON.stringify(perms), hashActivationCode(activationCode, teamId), keyBlob, nowSec());

  return { ok: true, data: { member_id: memberId, email: mail, status: 'pending' }, activation_code: activationCode };
}

/** Accept an invite with the activation code: pending -> active, key unwrapped. */
export function acceptInvite(teamId: string, email: string, activationCode: string): TeamOpResult {
  const db = getDb();
  const mail = str(email).toLowerCase();
  const code = str(activationCode).toUpperCase();
  const row = db
    .prepare("SELECT * FROM team_members WHERE team_id = ? AND email = ? AND status = 'pending'")
    .get(teamId, mail) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, code: 'NOT_FOUND', msg: 'no pending invite for this email' };

  const expected = row.invite_code_hash ? String(row.invite_code_hash) : '';
  if (!expected || expected !== hashActivationCode(code, teamId)) {
    return { ok: false, code: 'INVALID_CODE', msg: 'activation code is invalid' };
  }
  const deviceId = getDeviceId();
  const keyBlob = row.key_blob ? String(row.key_blob) : '';
  try {
    if (keyBlob) {
      const masterKey = unwrapMasterKeyFromInvite(
        Buffer.from(keyBlob, 'base64'),
        Buffer.from(code, 'utf8'),
        teamId
      );
      storeTeamMasterKey(teamId, masterKey);
    }
  } catch {
    return { ok: false, code: 'INVALID_CODE', msg: 'activation code does not match the invite' };
  }
  db.prepare(
    "UPDATE team_members SET status = 'active', member_id = ?, joined_at = ?, invite_code_hash = NULL, key_blob = NULL WHERE team_id = ? AND email = ?"
  ).run(deviceId, nowSec(), teamId, mail);
  return { ok: true, data: { team_id: teamId, member_id: deviceId, status: 'active' } };
}

/** Cancel a PENDING invitation (owner only). Active members are not touched. */
export function cancelInvite(teamId: string, memberId: string): TeamOpResult {
  const team = getTeamRow(teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', msg: 'team not found' };
  if (team.owner_device_id !== getDeviceId()) {
    return { ok: false, code: 'NO_PERMISSION', msg: 'only the owner can cancel invitations' };
  }
  const target = getMemberRow(teamId, str(memberId));
  if (!target) return { ok: false, code: 'NOT_FOUND', msg: 'member not found' };
  if (target.status !== 'pending') {
    return { ok: false, code: 'INVALID_STATE', msg: 'use removeMember for accepted members' };
  }
  getDb().prepare('DELETE FROM team_members WHERE team_id = ? AND member_id = ?').run(teamId, str(memberId));
  return { ok: true, data: { member_id: str(memberId), cancelled: true } };
}

/** Remove a member — OWNER ONLY (RBAC matrix). */
export function removeMember(teamId: string, memberId: string): TeamOpResult {
  const team = getTeamRow(teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', msg: 'team not found' };
  if (team.owner_device_id !== getDeviceId()) {
    return { ok: false, code: 'NO_PERMISSION', msg: 'only the owner can remove members' };
  }
  const target = getMemberRow(teamId, str(memberId));
  if (!target) return { ok: false, code: 'NOT_FOUND', msg: 'member not found' };
  if (target.role === 'owner') return { ok: false, code: 'INVALID_STATE', msg: 'cannot remove the owner' };
  getDb().prepare('DELETE FROM team_members WHERE team_id = ? AND member_id = ?').run(teamId, str(memberId));
  return { ok: true, data: { member_id: str(memberId), removed: true } };
}

/** Update a member's permission flags (owner only). */
export function updateMemberPermissions(
  teamId: string,
  memberId: string,
  permissions: Partial<MemberPermissions>
): TeamOpResult {
  const team = getTeamRow(teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', msg: 'team not found' };
  if (team.owner_device_id !== getDeviceId()) {
    return { ok: false, code: 'NO_PERMISSION', msg: 'only the owner can change permissions' };
  }
  const target = getMemberRow(teamId, str(memberId));
  if (!target || target.role !== 'member') {
    return { ok: false, code: 'INVALID_STATE', msg: 'permissions apply to members only' };
  }
  const merged = { ...DEFAULT_MEMBER_PERMISSIONS, ...(target.permissions ?? {}), ...(permissions ?? {}) };
  getDb().prepare('UPDATE team_members SET permissions = ? WHERE team_id = ? AND member_id = ?').run(
    JSON.stringify(merged),
    teamId,
    str(memberId)
  );
  return { ok: true, data: { member_id: str(memberId), permissions: merged } };
}

// ---------------------------------------------------------------------------
// Workspace state & team profiles
// ---------------------------------------------------------------------------

export type WorkspaceId = string; // 'personal' | team_id

export function getActiveWorkspace(): WorkspaceId {
  const ws = str(getSetting('activeWorkspace'));
  return ws || 'personal';
}

export function setActiveWorkspace(ws: WorkspaceId): void {
  setSetting('activeWorkspace', ws);
}

/** Profiles bound to a team workspace. */
export function listTeamProfiles(teamId: string): string[] {
  const rows = getDb()
    .prepare('SELECT user_id FROM team_profiles WHERE team_id = ? ORDER BY added_at ASC')
    .all(teamId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

export function addProfileToTeam(teamId: string, userId: string): boolean {
  const db = getDb();
  const dup = db.prepare('SELECT 1 AS x FROM team_profiles WHERE team_id = ? AND user_id = ?').get(teamId, userId);
  if (dup) return true;
  db.prepare('INSERT INTO team_profiles (team_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)').run(
    teamId,
    userId,
    getDeviceId(),
    nowSec()
  );
  return true;
}

/** Remove a profile from the team workspace (it stays in the owner's space). */
export function removeProfileFromTeam(teamId: string, userId: string): boolean {
  getDb().prepare('DELETE FROM team_profiles WHERE team_id = ? AND user_id = ?').run(teamId, userId);
  return true;
}