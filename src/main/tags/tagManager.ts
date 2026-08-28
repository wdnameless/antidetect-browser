// Profile tags (Sprint 2.3): many-to-many labeling with colors.
// tags (id, name, color) + profile_tags (profile_id, tag_id); attach/detach are
// idempotent; the profile list can be filtered by tag_id.
import { randomUUID } from 'crypto';
import { getDb } from '../db';

export interface TagItem {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
  profile_count: number;
}

export type TagResult<T> = { ok: true; data: T } | { ok: false; code: string; msg: string };

export function listTags(): TagItem[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.id, t.name, t.color, t.created_at, COUNT(pt.profile_id) AS profile_count
       FROM tags t
       LEFT JOIN profile_tags pt ON pt.tag_id = t.id
       LEFT JOIN profiles p ON p.id = pt.profile_id AND p.deleted_at IS NULL
       GROUP BY t.id
       ORDER BY t.created_at ASC`
    )
    .all() as unknown as TagItem[];
}

export function createTag(name: string, color?: string): TagResult<{ id: string }> {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, code: 'INVALID_INPUT', msg: 'name is required' };
  const dup = db
    .prepare('SELECT id FROM tags WHERE lower(name) = lower(?)')
    .get(trimmed) as { id: string } | undefined;
  if (dup) return { ok: false, code: 'DUPLICATE', msg: 'tag already exists' };
  const id = 'tag_' + randomUUID();
  db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    trimmed,
    color ?? null,
    Date.now()
  );
  return { ok: true, data: { id } };
}

export function updateTag(id: string, updates: { name?: string; color?: string | null }): TagResult<{ id: string }> {
  const db = getDb();
  const row = db.prepare('SELECT id FROM tags WHERE id = ?').get(id);
  if (!row) return { ok: false, code: 'NOT_FOUND', msg: 'tag not found' };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) return { ok: false, code: 'INVALID_INPUT', msg: 'name is required' };
    const dup = db
      .prepare('SELECT id FROM tags WHERE lower(name) = lower(?) AND id != ?')
      .get(trimmed, id) as { id: string } | undefined;
    if (dup) return { ok: false, code: 'DUPLICATE', msg: 'tag already exists' };
    sets.push('name = ?');
    params.push(trimmed);
  }
  if (updates.color !== undefined) {
    sets.push('color = ?');
    params.push(updates.color);
  }
  if (sets.length === 0) return { ok: true, data: { id } };
  params.push(id);
  db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return { ok: true, data: { id } };
}

export function deleteTag(id: string): TagResult<{ deleted: boolean }> {
  const db = getDb();
  db.prepare('DELETE FROM profile_tags WHERE tag_id = ?').run(id);
  const res = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  if (res.changes === 0) return { ok: false, code: 'NOT_FOUND', msg: 'tag not found' };
  return { ok: true, data: { deleted: true } };
}

function filterExistingProfiles(db: ReturnType<typeof getDb>, userIds: string[]): string[] {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id FROM profiles WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
    .all(...userIds) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function attachTag(tagId: string, userIds: string[]): TagResult<{ attached: number }> {
  const db = getDb();
  const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
  if (!tag) return { ok: false, code: 'NOT_FOUND', msg: 'tag not found' };
  const ids = filterExistingProfiles(db, userIds);
  let attached = 0;
  for (const pid of ids) {
    const res = db
      .prepare('INSERT OR IGNORE INTO profile_tags (profile_id, tag_id) VALUES (?, ?)')
      .run(pid, tagId);
    attached += res.changes;
  }
  return { ok: true, data: { attached } };
}

export function detachTag(tagId: string, userIds: string[]): TagResult<{ detached: number }> {
  const db = getDb();
  const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
  if (!tag) return { ok: false, code: 'NOT_FOUND', msg: 'tag not found' };
  let detached = 0;
  for (const pid of userIds) {
    const res = db
      .prepare('DELETE FROM profile_tags WHERE profile_id = ? AND tag_id = ?')
      .run(pid, tagId);
    detached += res.changes;
  }
  return { ok: true, data: { detached } };
}

export interface ProfileTagBinding {
  tag_id: string;
  name: string;
  color: string | null;
}

/** Tags of one profile (joined with tag names/colors for the UI chips). */
export function tagsForProfile(profileId: string): ProfileTagBinding[] {
  return getDb()
    .prepare(
      `SELECT pt.tag_id, t.name, t.color
       FROM profile_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.profile_id = ?
       ORDER BY t.name ASC`
    )
    .all(profileId) as unknown as ProfileTagBinding[];
}

/** Tag map for a whole page of profiles (one query instead of N). */
export function tagsForProfiles(userIds: string[]): Map<string, ProfileTagBinding[]> {
  const map = new Map<string, ProfileTagBinding[]>();
  if (!userIds.length) return map;
  const db = getDb();
  const placeholders = userIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT pt.profile_id, pt.tag_id, t.name, t.color
       FROM profile_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.profile_id IN (${placeholders})
       ORDER BY t.name ASC`
    )
    .all(...userIds) as unknown as Array<{ profile_id: string; tag_id: string; name: string; color: string | null }>;
  for (const r of rows) {
    const list = map.get(r.profile_id) ?? [];
    list.push({ tag_id: r.tag_id, name: r.name, color: r.color });
    map.set(r.profile_id, list);
  }
  return map;
}

/** Cascade used by the trash "delete forever" path. */
export function removeBindingsForProfile(profileId: string): void {
  getDb().prepare('DELETE FROM profile_tags WHERE profile_id = ?').run(profileId);
}