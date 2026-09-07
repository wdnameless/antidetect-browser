# Design: Folder Bookmarks

## Key Decisions

1. **Managed-node merge, never a whole-file write**: Chromium `Bookmarks` is a JSON tree with checksums in some builds — we modify only our own `"Antidetect"` child under `bookmark_bar`, leaving ids, dates_added, and user nodes byte-identical; `checksum` field is dropped for our node only (Chromium tolerates and recomputes; verified behavior in the 148 engine).
2. **Idempotent rewrite per launch**: managed node is replaced wholesale on each launch; user data outside it is never rewritten. Launch order: merge runs pre-spawn so Chromium sees a consistent file.
3. **Corruption policy**: malformed `Bookmarks` JSON → rename to `Bookmarks.pre-managed.bak` (once; second corruption overwrites nothing and surfaces a launch warning) → create a fresh tree with the managed node.
4. **Registry on the group (folder) row**: JSON column on the existing groups table (no new table); CRUD validates title ≤ 200 chars and http(s) URLs.

## Testing Strategy

- `tests/unit/folderBookmarks.test.ts` (fs sandbox with fixture Bookmarks trees):
  - merge into existing tree: managed node replaced, user nodes and ids preserved byte-for-byte;
  - idempotency: two consecutive merges produce identical files;
  - empty registry → no managed node left behind (cleanup on removal);
  - absent file → created with only managed node;
  - malformed JSON → `.bak` created, fresh tree written, warning surfaced;
  - URL/title validation rejections.