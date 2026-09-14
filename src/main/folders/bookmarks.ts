import { z } from 'zod';
import fs from 'fs';
import path from 'path';

import { getDb } from '../db';
import { getProfile } from '../profiles/profileManager';

export const BookmarkEntrySchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), {
    message: 'Only http and https URLs are allowed',
  }),
});

export type BookmarkEntry = z.infer<typeof BookmarkEntrySchema>;

export const BookmarkRegistrySchema = z.array(BookmarkEntrySchema);

export interface ChromiumBookmarkNode {
  id?: string;
  name?: string;
  type?: 'folder' | 'url';
  url?: string;
  date_added?: string;
  date_last_used?: string;
  date_modified?: string;
  children?: ChromiumBookmarkNode[];
  guid?: string;
  [key: string]: unknown;
}

export interface ChromiumBookmarksRoot {
  checksum?: string;
  roots: {
    bookmark_bar: ChromiumBookmarkNode;
    other?: ChromiumBookmarkNode;
    synced?: ChromiumBookmarkNode;
    [key: string]: unknown;
  };
  version?: number;
  [key: string]: unknown;
}

export const MANAGED_NODE_NAME = 'NullTrace';
export const MANAGED_NODE_ID = 'antidetect_managed';

/**
 * Validates a list of bookmark entries.
 */
export function validateBookmarks(entries: unknown): { success: true; data: BookmarkEntry[] } | { success: false; error: string } {
  const result = BookmarkRegistrySchema.safeParse(entries);
  if (!result.success) {
    return { success: false, error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
  }
  return { success: true, data: result.data };
}

/**
 * Builds the managed Chromium bookmark folder node from bookmark entries.
 */
export function buildManagedNode(entries: BookmarkEntry[]): ChromiumBookmarkNode {
  return {
    id: MANAGED_NODE_ID,
    name: MANAGED_NODE_NAME,
    type: 'folder',
    date_added: '13300000000000000',
    date_modified: '13300000000000000',
    children: entries.map((entry, idx) => ({
      id: `${MANAGED_NODE_ID}_${idx + 1}`,
      name: entry.title,
      type: 'url',
      url: entry.url,
      date_added: '13300000000000000',
    })),
  };
}

/**
 * Retrieves the folder bookmarks configured for a profile's group, if any.
 */
export function getProfileGroupBookmarks(profileId: string): BookmarkEntry[] {
  try {
    const profile = getProfile(profileId);
    if (!profile || !profile.group_id) {
      return [];
    }
    const db = getDb();
    const row = db.prepare('SELECT bookmarks FROM groups WHERE id = ?').get(profile.group_id) as
      | { bookmarks: string | null }
      | undefined;
    if (!row || !row.bookmarks) {
      return [];
    }
    const parsed = JSON.parse(row.bookmarks);
    const validated = validateBookmarks(parsed);
    return validated.success ? validated.data : [];
  } catch {
    return [];
  }
}

/**
 * Creates a blank Chromium bookmarks file structure with only the managed node (if entries non-empty).
 */
export function createDefaultBookmarksTree(entries: BookmarkEntry[]): ChromiumBookmarksRoot {
  const bookmark_bar_children: ChromiumBookmarkNode[] = [];
  if (entries.length > 0) {
    bookmark_bar_children.push(buildManagedNode(entries));
  }
  return {
    roots: {
      bookmark_bar: {
        children: bookmark_bar_children,
        date_added: '13300000000000000',
        date_modified: '13300000000000000',
        id: '1',
        name: 'Bookmarks bar',
        type: 'folder',
      },
      other: {
        children: [],
        date_added: '13300000000000000',
        date_modified: '13300000000000000',
        id: '2',
        name: 'Other bookmarks',
        type: 'folder',
      },
      synced: {
        children: [],
        date_added: '13300000000000000',
        date_modified: '13300000000000000',
        id: '3',
        name: 'Mobile bookmarks',
        type: 'folder',
      },
    },
    version: 1,
  };
}

/**
 * Pure JSON transform of a Chromium Bookmarks tree.
 * - Replaces or inserts the managed 'Antidetect' node under roots.bookmark_bar.children.
 * - If entries is empty, any existing managed node is removed.
 * - Leaves all other user nodes, dates, IDs untouched.
 * - Drops any checksum field on roots.
 */
export function mergeBookmarksTree(
  tree: ChromiumBookmarksRoot,
  entries: BookmarkEntry[]
): ChromiumBookmarksRoot {
  // Deep clone to avoid mutating input directly
  const newTree: ChromiumBookmarksRoot = JSON.parse(JSON.stringify(tree));

  // Drop checksum if present as per design
  delete newTree.checksum;

  if (!newTree.roots) {
    newTree.roots = {
      bookmark_bar: {
        children: [],
        id: '1',
        name: 'Bookmarks bar',
        type: 'folder',
      },
    };
  }

  if (!newTree.roots.bookmark_bar) {
    newTree.roots.bookmark_bar = {
      children: [],
      id: '1',
      name: 'Bookmarks bar',
      type: 'folder',
    };
  }

  if (!Array.isArray(newTree.roots.bookmark_bar.children)) {
    newTree.roots.bookmark_bar.children = [];
  }

  const children = newTree.roots.bookmark_bar.children;
  // Identify managed node either by id === MANAGED_NODE_ID or name === MANAGED_NODE_NAME
  const existingIdx = children.findIndex(
    (c) => c.id === MANAGED_NODE_ID || (c.type === 'folder' && c.name === MANAGED_NODE_NAME)
  );

  if (entries.length === 0) {
    // Empty registry removes managed node
    if (existingIdx !== -1) {
      children.splice(existingIdx, 1);
    }
  } else {
    const managedNode = buildManagedNode(entries);
    if (existingIdx !== -1) {
      children[existingIdx] = managedNode;
    } else {
      children.push(managedNode);
    }
  }

  return newTree;
}

/**
 * Merges managed bookmarks into a profile's Bookmarks file at <userDataDir>/Default/Bookmarks.
 * Handles:
 * - absent Bookmarks file (creates fresh tree with managed node)
 * - malformed JSON (quarantines to Bookmarks.pre-managed.bak once, writes fresh tree)
 * - empty entries (removes managed node)
 * - preserves user nodes byte-identical (order, fields, ids)
 * Returns the number of synced bookmarks.
 */
export function mergeManagedBookmarks(userDataDir: string, entries: BookmarkEntry[]): number {
  const defaultDir = path.join(userDataDir, 'Default');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }

  const bookmarksFile = path.join(defaultDir, 'Bookmarks');
  const bakFile = path.join(defaultDir, 'Bookmarks.pre-managed.bak');

  if (!fs.existsSync(bookmarksFile)) {
    // Absent file -> create fresh tree with managed node
    const fresh = createDefaultBookmarksTree(entries);
    fs.writeFileSync(bookmarksFile, JSON.stringify(fresh, null, 2), 'utf8');
    return entries.length;
  }

  const raw = fs.readFileSync(bookmarksFile, 'utf8');
  let tree: ChromiumBookmarksRoot;
  try {
    tree = JSON.parse(raw);
  } catch (err) {
    // Malformed JSON -> quarantine to .bak once (do not overwrite if .bak already exists)
    if (!fs.existsSync(bakFile)) {
      try {
        fs.renameSync(bookmarksFile, bakFile);
      } catch {
        // Fallback copy/write if rename fails
        fs.writeFileSync(bakFile, raw, 'utf8');
      }
    }
    // Write fresh tree with managed node
    const fresh = createDefaultBookmarksTree(entries);
    fs.writeFileSync(bookmarksFile, JSON.stringify(fresh, null, 2), 'utf8');
    return entries.length;
  }

  const updatedTree = mergeBookmarksTree(tree, entries);
  fs.writeFileSync(bookmarksFile, JSON.stringify(updatedTree, null, 2), 'utf8');
  return entries.length;
}
