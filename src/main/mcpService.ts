import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { API_HOST, API_PORT, getApiKey } from './config';
import { TOOL_DEFINITIONS } from '../../mcp/src/tools';

export interface McpStatusResponse {
  running: boolean;
  transport: 'http' | null;
  httpPort: number | null;
  httpUrl: string | null;
  toolCount: number;
  tier1Count: number;
  tier2Count: number;
  startedAt: string | null;
}

export class McpService {
  private static instance: McpService | null = null;

  private child: ChildProcess | null = null;
  private httpPort: number | null = null;
  private startedAt: string | null = null;

  private constructor() {}

  public static getInstance(): McpService {
    if (!McpService.instance) {
      McpService.instance = new McpService();
    }
    return McpService.instance;
  }

  /**
   * Find an available TCP port on loopback (127.0.0.1).
   */
  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error('Failed to obtain free loopback port')));
        }
      });
    });
  }

  /**
   * Check whether the child process is running and alive.
   */
  public isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /**
   * Calculate tool counts directly from real registry definitions.
   */
  public getToolCounts(): { toolCount: number; tier1Count: number; tier2Count: number } {
    const toolCount = TOOL_DEFINITIONS.length;
    let tier1Count = 0;
    let tier2Count = 0;
    for (const tool of TOOL_DEFINITIONS) {
      if (tool.tier === 'default') {
        tier1Count++;
      } else if (tool.tier === 'gated') {
        tier2Count++;
      }
    }
    return { toolCount, tier1Count, tier2Count };
  }

  /**
   * Return status matching Contract 2 shape.
   */
  public status(): McpStatusResponse {
    const running = this.isRunning();
    const { toolCount, tier1Count, tier2Count } = this.getToolCounts();

    if (!running) {
      return {
        running: false,
        transport: null,
        httpPort: null,
        httpUrl: null,
        toolCount,
        tier1Count,
        tier2Count,
        startedAt: null,
      };
    }

    return {
      running: true,
      transport: 'http',
      httpPort: this.httpPort,
      httpUrl: this.httpPort ? `http://127.0.0.1:${this.httpPort}/mcp` : null,
      toolCount,
      tier1Count,
      tier2Count,
      startedAt: this.startedAt,
    };
  }

  /**
   * Start the MCP server process.
   */
  public async start(): Promise<McpStatusResponse> {
    if (this.isRunning()) {
      return this.status();
    }

    const freePort = await this.findFreePort();
    // The entry is mcp/dist/mcp/src/index.js, not mcp/dist/index.js: mcp/src/browser.ts
    // imports ../../src/main/motion/*, so TypeScript computes a project root above mcp/
    // and nests the output. tsconfig pins `rootDir: '..'` to make that deterministic, and
    // `mcp/package.json` advertises the same path via `main`.
    const scriptPath = path.resolve(process.cwd(), 'mcp', 'dist', 'mcp', 'src', 'index.js');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(
        `MCP entry not found at ${scriptPath}. Run \`npm run build:mcp\` before starting the server.`,
      );
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MCP_HTTP_PORT: String(freePort),
      // The MCP server reaches the app's own API as a client. Without these it used a
      // hardcoded default port this app never listens on, and sent no auth at all — every
      // tool call would fail. Both values are the ones the running app actually uses.
      ANTIDETECT_API_URL: `http://${API_HOST}:${API_PORT}`,
      ANTIDETECT_API_TOKEN: getApiKey(),
    };

    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child = child;
    this.httpPort = freePort;
    this.startedAt = new Date().toISOString();

    child.on('exit', () => {
      if (this.child === child) {
        this.child = null;
        this.httpPort = null;
        this.startedAt = null;
      }
    });

    // Wait for the port to actually accept a connection rather than sleeping a fixed
    // 500ms: `running` is supposed to reflect the real process, and a slow first start
    // would otherwise report running=false for a server that is about to be up.
    await this.waitForPort(freePort, 8000);

    return this.status();
  }

  /** Resolve once the port accepts a TCP connection, or after the timeout. */
  private async waitForPort(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.child === null) return; // died during startup
      const ok = await this.probePort(port);
      if (ok) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /** True when a TCP connection to the loopback port succeeds. */
  private probePort(port: number): Promise<boolean> {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    return promise;
  }

  /**
   * Stop the MCP server process.
   */
  public async stop(): Promise<McpStatusResponse> {
    if (this.child && this.child.exitCode === null) {
      const childToKill = this.child;
      const { promise, resolve } = Promise.withResolvers<void>();
      const timeout = setTimeout(() => {
        try {
          childToKill.kill('SIGKILL');
        } catch {
          // already gone
        }
        resolve();
      }, 1500);

      childToKill.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      childToKill.kill('SIGTERM');
      await promise;
    }

    this.child = null;
    this.httpPort = null;
    this.startedAt = null;

    return this.status();
  }
}
