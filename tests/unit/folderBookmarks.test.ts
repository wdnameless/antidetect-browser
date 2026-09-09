import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  mergeManagedBookmarks,
  mergeBookmarksTree,
  validateBookmarks,
  BookmarkEntry,
  ChromiumBookmarksRoot,
  MANAGED_NODE_ID,
  MANAGED_NODE_NAME,
} from '../../src/main/folders/bookmarks';

describe('folderBookmarks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Validation', () => {
    it('accepts valid http and https URLs and title <= 200', () => {
      const valid = [
        { title: 'Google', url: 'https://google.com' },
        { title: 'Internal HTTP', url: 'http://localhost:8080/path' },
        { title: 'A'.repeat(200), url: 'https://example.com' },
      ];
      const res = validateBookmarks(valid);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual(valid);
      }
    });

    it('rejects title > 200 chars', () => {
      const invalid = [{ title: 'A'.repeat(201), url: 'https://example.com' }];
      const res = validateBookmarks(invalid);
      expect(res.success).toBe(false);
    });

    it('rejects empty title', () => {
      const invalid = [{ title: '', url: 'https://example.com' }];
      const res = validateBookmarks(invalid);
      expect(res.success).toBe(false);
    });

    it('rejects non-http(s) URLs (e.g. javascript:, file:, ftp:)', () => {
      expect(validateBookmarks([{ title: 'XSS', url: 'javascript:alert(1)' }]).success).toBe(false);
      expect(validateBookmarks([{ title: 'File', url: 'file:///etc/passwd' }]).success).toBe(false);
      expect(validateBookmarks([{ title: 'FTP', url: 'ftp://example.com' }]).success).toBe(false);
      expect(validateBookmarks([{ title: 'Bad', url: 'not-a-url' }]).success).toBe(false);
    });
  });

  describe('mergeManagedBookmarks in fs sandbox', () => {
    const sampleEntries: BookmarkEntry[] = [
      { title: 'Acme Portal', url: 'https://acme.corp' },
      { title: 'Search', url: 'https://google.com' },
    ];

    it('scenario 4: absent Bookmarks file -> created with only managed node', () => {
      const syncedCount = mergeManagedBookmarks(tmpDir, sampleEntries);
      expect(syncedCount).toBe(2);

      const filePath = path.join(tmpDir, 'Default', 'Bookmarks');
      expect(fs.existsSync(filePath)).toBe(true);

      const content: ChromiumBookmarksRoot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const children = content.roots.bookmark_bar.children || [];
      expect(children).toHaveLength(1);
      expect(children[0].name).toBe(MANAGED_NODE_NAME);
      expect(children[0].id).toBe(MANAGED_NODE_ID);
      expect(children[0].type).toBe('folder');
      expect(children[0].children).toHaveLength(2);
      expect(children[0].children?.[0].name).toBe('Acme Portal');
      expect(children[0].children?.[0].url).toBe('https://acme.corp');
    });

    it('scenario 1: merge into existing tree replaces managed node, user nodes byte-identical', () => {
      const userNode = {
        date_added: '13200000000000000',
        id: 'user_bookmark_42',
        name: 'My Personal Bank',
        type: 'url' as const,
        url: 'https://bank.com',
        custom_field: 'keep_me_intact',
      };

      const initialTree: ChromiumBookmarksRoot = {
        checksum: 'old_checksum_value',
        roots: {
          bookmark_bar: {
            children: [
              userNode,
              {
                id: MANAGED_NODE_ID,
                name: MANAGED_NODE_NAME,
                type: 'folder' as const,
                children: [{ id: 'old_child', name: 'Old', url: 'https://old.com', type: 'url' as const }],
              },
            ],
            id: '1',
            name: 'Bookmarks bar',
            type: 'folder',
          },
        },
        version: 1,
      };

      const defaultDir = path.join(tmpDir, 'Default');
      fs.mkdirSync(defaultDir, { recursive: true });
      const filePath = path.join(defaultDir, 'Bookmarks');
      fs.writeFileSync(filePath, JSON.stringify(initialTree, null, 2), 'utf8');

      mergeManagedBookmarks(tmpDir, sampleEntries);

      const updated: ChromiumBookmarksRoot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // Checksum must be dropped
      expect(updated.checksum).toBeUndefined();

      const children = updated.roots.bookmark_bar.children || [];
      expect(children).toHaveLength(2);
      // User node preserved exactly
      expect(children[0]).toEqual(userNode);

      // Managed node replaced
      expect(children[1].name).toBe(MANAGED_NODE_NAME);
      expect(children[1].id).toBe(MANAGED_NODE_ID);
      expect(children[1].children).toHaveLength(2);
      expect(children[1].children?.[0].name).toBe('Acme Portal');
      expect(children[1].children?.[1].name).toBe('Search');
    });

    it('scenario 2: idempotent double-merge produces identical output', () => {
      const initialTree: ChromiumBookmarksRoot = {
        roots: {
          bookmark_bar: {
            children: [
              {
                date_added: '13200000000000000',
                id: 'user_1',
                name: 'User Bookmark',
                type: 'url' as const,
                url: 'https://user.com',
              },
            ],
            id: '1',
            name: 'Bookmarks bar',
            type: 'folder',
          },
        },
        version: 1,
      };

      const defaultDir = path.join(tmpDir, 'Default');
      fs.mkdirSync(defaultDir, { recursive: true });
      const filePath = path.join(defaultDir, 'Bookmarks');
      fs.writeFileSync(filePath, JSON.stringify(initialTree, null, 2), 'utf8');

      mergeManagedBookmarks(tmpDir, sampleEntries);
      const firstRun = fs.readFileSync(filePath, 'utf8');

      mergeManagedBookmarks(tmpDir, sampleEntries);
      const secondRun = fs.readFileSync(filePath, 'utf8');

      expect(firstRun).toBe(secondRun);
    });

    it('scenario 3: empty registry removes managed node, preserves user nodes', () => {
      const userNode = {
        id: 'user_1',
        name: 'Keep Me',
        type: 'url' as const,
        url: 'https://user.com',
      };

      const initialTree: ChromiumBookmarksRoot = {
        roots: {
          bookmark_bar: {
            children: [
              userNode,
              {
                id: MANAGED_NODE_ID,
                name: MANAGED_NODE_NAME,
                type: 'folder' as const,
                children: [],
              },
            ],
            id: '1',
            name: 'Bookmarks bar',
            type: 'folder',
          },
        },
        version: 1,
      };

      const defaultDir = path.join(tmpDir, 'Default');
      fs.mkdirSync(defaultDir, { recursive: true });
      const filePath = path.join(defaultDir, 'Bookmarks');
      fs.writeFileSync(filePath, JSON.stringify(initialTree, null, 2), 'utf8');

      const synced = mergeManagedBookmarks(tmpDir, []);
      expect(synced).toBe(0);

      const updated: ChromiumBookmarksRoot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const children = updated.roots.bookmark_bar.children || [];
      expect(children).toHaveLength(1);
      expect(children[0]).toEqual(userNode);
    });

    it('scenario 5: malformed JSON -> .bak quarantine once + fresh tree + no launch failure', () => {
      const defaultDir = path.join(tmpDir, 'Default');
      fs.mkdirSync(defaultDir, { recursive: true });
      const filePath = path.join(defaultDir, 'Bookmarks');
      const bakPath = path.join(defaultDir, 'Bookmarks.pre-managed.bak');

      const corruptContent = '{ "roots": { "bookmark_bar": { "children": [ MALFORMED_JSON ';
      fs.writeFileSync(filePath, corruptContent, 'utf8');

      // First run: should quarantine to .bak and write fresh tree
      const synced = mergeManagedBookmarks(tmpDir, sampleEntries);
      expect(synced).toBe(2);
      expect(fs.existsSync(bakPath)).toBe(true);
      expect(fs.readFileSync(bakPath, 'utf8')).toBe(corruptContent);

      const newContent: ChromiumBookmarksRoot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(newContent.roots.bookmark_bar.children?.[0].name).toBe(MANAGED_NODE_NAME);

      // Now corrupt again, but bak already exists: should NOT overwrite .bak
      fs.writeFileSync(filePath, '{ second corruption ', 'utf8');
      mergeManagedBookmarks(tmpDir, sampleEntries);
      expect(fs.readFileSync(bakPath, 'utf8')).toBe(corruptContent); // intact
    });
  });
});
