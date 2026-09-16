import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { API_HOST, API_PORT, getApiKey } from './config';
import { getMcpScope } from './api/routes/settings';
// Import the DATA-ONLY manifest, never `mcp/src/tools`: that module imports
// `@antidetect/sdk`, which is not bundled with the sidecar backend, and pulling it in made the
// packaged app crash at startup with `Cannot find module '@antidetect/sdk'`.
import { TOOL_DEFINITIONS } from '../../mcp/src/toolManifest';

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

/**
 * Candidate locations for the MCP entry, in priority order.
 *
 * The entry is `mcp/dist/mcp/src/index.js`, not `mcp/dist/index.js`: `mcp/src/browser.ts`
 * imports from `../../src/main/motion/*`, so TypeScript computes a project root above
 * `mcp/` and nests the output one level deeper. `tsconfig` pins `rootDir: '..'` to keep
 * that deterministic and `mcp/package.json` advertises the same path via `main`.
 *
 * It MUST NOT be resolved from `process.cwd()`. That was the original bug: in a portable
 * install the working directory is wherever the operator launched the exe from, so the
 * path could never point at the app's own files and MCP failed with "entry not found" in
 * every packaged build. The order below mirrors how the sidecar script path is resolved.
 */
function mcpEntryCandidates(): string[] {
  const rel = path.join('mcp', 'dist', 'mcp', 'src', 'index.js');
  const candidates: string[] = [];

  // 1) Explicit override, for unusual layouts and for tests.
  const override = process.env.ANTIDETECT_MCP_ENTRY;
  if (override && override.trim().length > 0) candidates.push(path.resolve(override.trim()));

  // 2) Bundled resources (the shell passes this; the installer and portable both use it).
  const resources = process.env.ANTIDETECT_TARGET_RESOURCES_DIR;
  if (resources && resources.trim().length > 0) {
    candidates.push(path.join(path.resolve(resources.trim()), rel));
    // The portable payload places `mcp/dist` under a `mcp/` directory next to the exe.
    candidates.push(path.join(path.resolve(resources.trim()), '..', rel));
  }

  // 3) Next to the running executable, and a couple of levels up — covers both the
  //    installed layout and the extracted portable directory.
  const exeDir = path.dirname(process.execPath);
  candidates.push(path.join(exeDir, rel));
  candidates.push(path.join(exeDir, '..', rel));
  candidates.push(path.join(exeDir, '..', '..', rel));

  // 4) The development checkout. LAST, because a packaged app must never depend on it.
  candidates.push(path.resolve(process.cwd(), rel));

  return candidates;
}

/** First existing candidate, or null when the entry is genuinely absent. */
function resolveMcpEntry(): string | null {
  return mcpEntryCandidates().find((p) => fs.existsSync(p)) ?? null;
}

export class McpService {
  private static instance: McpService | null = null;

  private child: ChildProcess | null = null;
  private httpPort: number | null = null;
  private startedAt: string | null = null;
  /** Last startup failure, kept so the UI can explain a toggle that did not work. */
  private lastError: string | null = null;

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
    const scriptPath = resolveMcpEntry();
    if (!scriptPath) {
      throw new Error(
        [
          'MCP entry (mcp/dist/mcp/src/index.js) was not found. Tried:',
          ...mcpEntryCandidates().map((p) => `  ${p}`),
          'Run `npm run build:mcp` before starting the server.',
        ].join('\n'),
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
      // Privilege level for tool authorization. Without this the server always ran at
      // `standard`, so its 12 destructive tools (delete / restore / import / export) were
      // unreachable no matter what the operator wanted — the setting had no way to reach it.
      // `getMcpScope()` resolves env-override-then-stored-setting.
      ANTIDETECT_MCP_SCOPE: getMcpScope(),
    };

    // The MCP entry lives in `mcp/dist/...` while its runtime dependencies live in a
    // sibling `dist/node_modules`. Node resolves upward from the ENTRY's directory, which
    // never passes through `dist/`, so `express` was unresolvable and the server died at
    // startup with no output. NODE_PATH is the supported way to add a search root. The
    // sidecar already does exactly this for the backend.
    //
    // Roots are derived by walking up from the ENTRY — the one location we know is real.
    // An earlier attempt built them from ANTIDETECT_TARGET_RESOURCES_DIR, which in a
    // portable install resolved to a bare drive letter and poisoned the whole list.
    {
      const roots: string[] = [];
      // Windows canonicalisation yields `\\?\C:\...` verbatim paths. They are valid for a
      // single path, but NODE_PATH is a DELIMITED LIST: the `?` and the prefix confuse
      // Node's path splitting, so the list collapsed into one bogus `C:` entry and every
      // lookup failed with EISDIR. Strip the prefix — it adds nothing here.
      const clean = (p: string): string =>
        p.startsWith('\\\\?\\') ? p.slice(4) : p;
      let dir = clean(path.dirname(scriptPath));
      for (let depth = 0; depth < 6; depth += 1) {
        roots.push(path.join(dir, 'node_modules'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      // Walking up from `mcp/dist/mcp/src` never passes through the app's own `dist/`,
      // because `dist/node_modules` is a SIBLING of `mcp/` — not an ancestor. Add the
      // roots the app layout actually uses: the executable's directory (portable extracts
      // `dist/` next to the shell exe), the bundled resources directory, then the working
      // directory for a dev run.
      const appRoots = [
        path.dirname(clean(process.execPath)),
        process.env.ANTIDETECT_TARGET_RESOURCES_DIR,
        process.cwd(),
      ];
      for (const root of appRoots) {
        if (!root || root.trim().length === 0) continue;
        const resolved = clean(path.resolve(root.trim()));
        // A degenerate value like `C:\` would poison the list; skip it.
        if (resolved === path.parse(resolved).root) continue;
        roots.push(path.join(resolved, 'dist', 'node_modules'));
        roots.push(path.join(resolved, 'node_modules'));
      }
      if (process.env.NODE_PATH && process.env.NODE_PATH.trim().length > 0) {
        roots.push(process.env.NODE_PATH.trim());
      }
      // De-duplicate: the same directory appears from several sources above.
      env.NODE_PATH = [...new Set(roots)].join(path.delimiter);
    }

    // Windows canonicalisation produces `\\?\C:\...` verbatim paths. Node tolerates them as
    // a single path but NOT as a child's entry/cwd here: the process died with
    // `EISDIR path: 'C:'`, because the `?` and prefix break Node's own path handling on
    // Windows. Plain paths are correct and sufficient for a local executable.
    const stripVerbatim = (p: string): string => (p.startsWith('\\\\?\\') ? p.slice(4) : p);
    const spawnEntry = stripVerbatim(scriptPath);

    const child = spawn(process.execPath, [spawnEntry], {
      // Run from the entry's own directory, not from whatever directory the operator
      // happened to launch the app in: the MCP server resolves its own relative imports
      // and config from there.
      cwd: path.dirname(spawnEntry),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child = child;
    this.httpPort = freePort;
    this.startedAt = new Date().toISOString();

    // Capture stderr so a failed start is reportable. Previously the child's output was
    // piped and never read: the process died, `running` came back false, and the operator
    // saw a toggle that silently did nothing with no explanation anywhere.
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.stdout?.on('data', () => {
      // Drain stdout; the MCP server logs there and an unread pipe can block it.
    });

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

    if (!this.isRunning()) {
      const tail = stderr.trim().split('\n').filter(Boolean).slice(-8).join(' | ');
      const tried = mcpEntryCandidates().join('\n    ');
      this.lastError =
        `MCP server failed to start.\n` +
        `  entry:      ${scriptPath}\n` +
        `  cwd:        ${path.dirname(scriptPath)}\n` +
        `  node:       ${process.execPath}\n` +
        `  NODE_PATH:  ${env.NODE_PATH ?? '(unset)'}\n` +
        `  candidates:\n    ${tried}\n` +
        `  stderr:     ${tail || '(no output)'}`;
      throw new Error(this.lastError);
    }
    this.lastError = null;

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
