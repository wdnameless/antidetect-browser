import { McpServer } from './server';

export * from './protocol';
export * from './auth';
export * from './audit';
export * from './tools';
export * from './browser';
export * from './server';

function run(): void {
  const httpPortStr = process.env.MCP_HTTP_PORT;
  const server = new McpServer();

  if (httpPortStr) {
    const port = parseInt(httpPortStr, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.error(`Invalid MCP_HTTP_PORT: ${httpPortStr}`);
      process.exit(1);
    }
    server
      .startHttp(port, '127.0.0.1')
      .then(() => {
        console.log(`[MCP] Server listening on http://127.0.0.1:${port}/mcp`);
      })
      .catch((err) => {
        console.error('[MCP] Failed to start HTTP server:', err);
        process.exit(1);
      });
  } else {
    // Default: stdio transport
    server.startStdio();
  }
}

if (require.main === module) {
  run();
}
