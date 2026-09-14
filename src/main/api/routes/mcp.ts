import { Router, Request, Response } from 'express';
import { McpService } from '../../mcpService';

export const mcpRouter = Router();
const mcpService = McpService.getInstance();

/**
 * GET /api/v1/mcp/status
 * Returns current status of MCP server child process and tool counts.
 */
mcpRouter.get('/status', (_req: Request, res: Response) => {
  try {
    const status = mcpService.status();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to retrieve MCP status' });
  }
});

/**
 * POST /api/v1/mcp/start
 * Starts the MCP child process if not already running.
 */
mcpRouter.post('/start', async (_req: Request, res: Response) => {
  try {
    const status = await mcpService.start();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start MCP server' });
  }
});

/**
 * POST /api/v1/mcp/stop
 * Stops the MCP child process if running.
 */
mcpRouter.post('/stop', async (_req: Request, res: Response) => {
  try {
    const status = await mcpService.stop();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to stop MCP server' });
  }
});
