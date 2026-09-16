# MCP server

NullTrace exposes an MCP (Model Context Protocol) server so an AI agent can drive the
browser directly: create and launch profiles, navigate, click, type, take screenshots, read
the page, manage proxies and extensions, run flows, and touch cookies.

## Getting a server your agent can run

**Automation API panel → Download MCP.** The app asks for a folder, writes a
self-contained server into `<folder>/nulltrace-mcp`, and copies the agent configuration to
the clipboard. A `nulltrace-mcp.zip` sits beside it for moving to another machine.

The bundle vendors its runtime dependencies (`express`, `puppeteer-core`, `@antidetect/sdk`
and their transitive packages — about 6 MB), so **there is no `npm install` step**. The only
requirement is a Node runtime; the Windows build also ships `node.exe` next to the shell and
the generated `run.cmd` points at it.

## Pointing your agent at it

Paste this into the client's MCP configuration — Claude Desktop uses
`%APPDATA%\Claude\claude_desktop_config.json`, and most other clients accept the same shape:

```json
{
  "mcpServers": {
    "nulltrace": {
      "command": "node",
      "args": ["C:\\path\\to\\nulltrace-mcp\\index.js"],
      "env": {
        "ANTIDETECT_API_URL": "http://127.0.0.1:50325",
        "ANTIDETECT_API_TOKEN": "<the app's API key>",
        "ANTIDETECT_MCP_SCOPE": "standard"
      }
    }
  }
}
```

The app generates exactly this, with the real values filled in. `index.js` hands off to the
compiled server under `mcp/dist/`, which must be the process's main module — it starts only
when `require.main === module`.

The token is the running instance's API key, shown masked in the Automation API panel. It
changes if the app's data folder is reset; regenerate the bundle or read the current key
from the panel if calls start returning 401.

## Transports

- **stdio** — the default, and what desktop agent clients use. Spawning `index.js` is enough.
- **HTTP** — set `MCP_HTTP_PORT` and the server listens on
  `http://127.0.0.1:<port>/mcp` instead. The app uses this internally for its own panel.

## Tools

47 tools in two tiers. The tier is set by `ANTIDETECT_MCP_SCOPE` (`standard` by default, or
`admin` via **Settings → Security → MCP privileges**).

**Standard — reads and safe actions**

| Area | Tools |
|---|---|
| Profiles | `profiles.list`, `profiles.get`, `profiles.create`, `profiles.start`, `profiles.stop` |
| Browser | `browser.navigate`, `browser.click`, `browser.type`, `browser.human_click`, `browser.human_type`, `browser.evaluate_allowlisted`, `browser.screenshot` |
| Proxies | `proxies.list`, `proxies.create`, `proxies.check` |
| Extensions | `extensions.list`, `extensions.install` |
| Flows | `flows.list`, `flows.get`, `flows.run`, `flows.validate` |
| Task groups | `task_groups.list`, `task_groups.get`, `task_groups.tasks`, `task_groups.start`, `task_groups.stop` |
| Trash / triggers / tags / batch | `trash.list`, `triggers.list`, `triggers.create`, `triggers.toggle`, `tags.list`, `tags.attach`, `tags.detach`, `batch.start`, `batch.stop` |
| Diagnostics | `diagnostics.run` |

**Admin — destructive, refused unless the scope is `admin`**

`profiles.delete`, `profiles.restore`, `profiles.export_preserved`,
`profiles.cleanup_preserved`, `proxies.delete`, `extensions.delete`, `triggers.delete`,
`batch.delete`, `trash.delete_forever`, `cookies.export`, `cookies.import`.

## How it reaches the browser

The MCP server is an HTTP client of the app's own Local API (`ANTIDETECT_API_URL` +
bearer token). Browser control goes through the profile's CDP endpoint, which the app
already exposes for its own automation. Nothing is opened to the network: the API binds
loopback, and so does the MCP HTTP transport.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Panel says "MCP: Off" but the server runs | Should not happen: `/api/v1/mcp/status` answers the standard `{code,msg,data}` envelope. If it recurs, check that route's shape. |
| "Cannot reach the local service" | The backend is not running — the MCP panel is a client of it. |
| Agent spawns the server, gets no output | The entry must be run as the main module. Use the generated `index.js`, not a `require` of the built file. |
| `401` from tool calls | The token is stale; regenerate the bundle. |
| A destructive tool is rejected | The bundle is `standard`. Regenerate with `admin`, or raise it in Settings → Security. |
