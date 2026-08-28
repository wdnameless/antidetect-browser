# Antidetect Sync Server (self-host)

Zero-knowledge team sync server for the Antidetect Browser teams feature.
It stores **only ciphertext**: `{bundle_id, team_id, device_id, ciphertext, version, updated_at}`.
Profile plaintext (names, proxies, cookies, fingerprints) never reaches this
server - bundles are encrypted client-side with the team key (AES-256-GCM,
HKDF-derived; see openspec/changes/add-teams-rbac-cloud-sync/specs/sync-protocol/spec.md).

## Quick start (Docker)

    cd server
    docker compose up -d --build
    # server listens on http://0.0.0.0:8787

Then in the desktop app: Settings -> Sync -> Custom and set the base URL
(e.g. http://your-server:8787). Connection status is shown on the same tab.

## Quick start (bare Node)

    cd server
    npm install
    npm run build
    SYNC_DATA_DIR=./data PORT=8787 npm start

No native modules are required - SQLite runs via sql.js (WASM) and the server
uses only node:crypto. There are no paid dependencies.

## API (wire-format v1)

    GET  /status                              health check
    POST /api/v1/teams                        create team, returns bearer token
    POST /api/v1/teams/:id/invites            register pending invite (+wrapped key)
    POST /api/v1/invites/accept               activate invite, returns token
    POST /api/v1/teams/:id/bundles            push encrypted bundle (LWW by updated_at)
    GET  /api/v1/teams/:id/bundles            pull bundles ?since=<updated_at>

Tokens are bound to (team_id, device_id); a token cannot read or write
another team data. The server never stores key material: during an invite
the owner uploads only the activation-code-wrapped master key blob, which the
invitee unwraps locally and the server deletes on accept.

## Data & backups

Everything lives in a single SQLite file ($SYNC_DATA_DIR/sync.db, default
/data inside the container). Mount the sync-data volume and back it up
like any SQLite file. Writes are atomic (tmp + rename).

## Configuration

    PORT           default 8787   HTTP port
    SYNC_DATA_DIR  default ./data SQLite storage directory

Put the server behind a reverse proxy (Traefik/Nginx) with TLS for production
use; the desktop client accepts both http:// and https:// custom URLs.
