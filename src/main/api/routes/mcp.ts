import { Router, Request, Response } from 'express';
import * as path from 'path';
import { McpService } from '../../mcpService';
import { buildMcpBundle } from '../../mcp/bundle';
import { getApiKey, API_HOST, API_PORT } from '../../config';
import { getMcpScope } from './settings';

export const mcpRouter = Router();
const mcpService = McpService.getInstance();

// Every other route in this API answers `{ code, msg, data }` (docs/API_CONTRACT.md). These
// three returned the bare status object instead, so the renderer — which checks
// `res.code === 0` — saw `undefined` and reported the MCP server as Off even while it was
// running with 47 tools. The envelope is the documented contract; honour it here too.

/**
 * GET /api/v1/mcp/status
 * Returns current status of MCP server child process and tool counts.
 */
mcpRouter.get('/status', (_req: Request, res: Response) => {
  try {
    res.json({ code: 0, msg: 'success', data: mcpService.status() });
  } catch (error) {
    res.json({
      code: -1,
      msg: error instanceof Error ? error.message : 'Failed to retrieve MCP status',
      data: {},
    });
  }
});

/**
 * POST /api/v1/mcp/start
 * Starts the MCP child process if not already running.
 */
mcpRouter.post('/start', async (_req: Request, res: Response) => {
  try {
    const status = await mcpService.start();
    res.json({ code: 0, msg: 'success', data: { ok: true, status } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start MCP server';
    res.json({ code: -1, msg, data: { ok: false, error: msg } });
  }
});

/**
 * POST /api/v1/mcp/stop
 * Stops the MCP child process if running.
 */
mcpRouter.post('/stop', async (_req: Request, res: Response) => {
  try {
    const status = await mcpService.stop();
    res.json({ code: 0, msg: 'success', data: { ok: true, status } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to stop MCP server';
    res.json({ code: -1, msg, data: { ok: false, error: msg } });
  }
});

/**
 * POST /api/v1/mcp/bundle { dir, scope? }
 *
 * Writes a ready-to-use MCP server into `dir` and returns the paths plus the exact agent
 * configuration to paste. The bundle vendors its dependencies, so the user's agent needs a
 * Node runtime and nothing else — no `npm install`, no registry access.
 *
 * This is the "point your agent at this file" affordance: the operator picks a folder, the
 * app produces the server, and the returned config can be pasted into any MCP client.
 */
mcpRouter.post('/bundle', (req: Request, res: Response) => {
  const dir = typeof req.body?.dir === 'string' ? req.body.dir.trim() : '';
  if (!dir) {
    res.json({ code: -1, msg: 'dir is required', data: { ok: false, error: 'dir is required' } });
    return;
  }
  const scope = req.body?.scope === 'admin' ? 'admin' : getMcpScope();
  const apiUrl = `http://${API_HOST}:${API_PORT}`;
  const result = buildMcpBundle({ targetDir: path.resolve(dir), apiUrl, apiToken: getApiKey(), scope });
  if (!result.ok) {
    res.json({ code: -1, msg: result.error ?? 'bundle failed', data: { ok: false, error: result.error } });
    return;
  }
  res.json({
    code: 0,
    msg: 'success',
    data: {
      ok: true,
      dir: result.dir,
      zip: result.zip,
      bytes: result.bytes,
      // Ready to paste into the client's MCP configuration. The agent spawns this file over
      // stdio; the app does not need to be told about the client.
      config: {
        mcpServers: {
          nulltrace: {
            command: 'node',
            args: [path.join(result.dir as string, 'index.js')],
            env: {
              ANTIDETECT_API_URL: apiUrl,
              ANTIDETECT_API_TOKEN: getApiKey(),
              ANTIDETECT_MCP_SCOPE: scope,
            },
          },
        },
      },
      toolCount: 47,
      scope,
    },
  });
});
