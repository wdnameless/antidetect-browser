# Design: Disposable Profiles

## Context and Scope

Ephemeral, single-use browser profiles are needed for rapid scraping runs, automated tests, and isolated sessions where no cookies, history, or disk cache should persist. This design defines an in-memory lifecycle registry, temporary folder structure, and guaranteed multi-signal cleanup.

## Key Decisions

1. **In-Memory Profile Descriptor**: Temporary profiles are not stored in SQLite tables. Instead, an in-memory `Map<string, TemporaryProfile>` tracks their status during runtime.
2. **Dedicated `.temporary_profiles/` Subfolder**: Each temporary profile allocates its browser state within `<userDataRoot>/.temporary_profiles/<uuid>`. This cleanly separates ephemeral directories from persistent profile data and backups.
3. **Multi-Signal Automatic Cleanup**: Ephemeral profiles trigger disk removal upon:
   - Browser process exit or crash.
   - Explicit `POST /profiles/:id/stop` request.
   - Application/launcher shutdown event.
4. **Startup Orphan Purges**: Upon main application startup, the launcher inspects `.temporary_profiles/` and purges any leftover directories from ungraceful shutdowns or host crashes.
5. **Isolation Guarantees**: Temporary profiles do not appear in `GET /profiles` unless explicitly queried via `?include_temporary=true`.

## Migration and Compatibility

- Zero changes to existing persistent profile tables or directory hierarchies.
- Fully transparent to automation APIs (Puppeteer / Playwright).
