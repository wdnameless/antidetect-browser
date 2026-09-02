# @antidetect/sync-server

Zero-knowledge team sync server for Antidetect Browser.

- Wire-format v1 compatible with `src/main/teams/syncClient.ts`
- E2E AES-256-GCM encrypted bundles
- Deterministic conflict detection
- Per-workspace namespacing & token auth
- Strict RBAC: Owner, Editor, Viewer
- Queryable tamper-evident audit logs
- In-memory SQLite with file persistence via sql.js

## Quick Start

```bash
cp .env.example .env
npm install
npm run build
npm start
```

## Docker

```bash
docker-compose up -d
```
