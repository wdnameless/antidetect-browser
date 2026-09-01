import * as readline from 'node:readline';
import express, { Express, Request, Response } from 'express';
import { Server } from 'node:http';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  parseJsonRpcMessage,
  createErrorResponse,
  createSuccessResponse,
  RPC_ERRORS,
} from './protocol';
import { ToolRouter } from './tools';
import { NonceReplayDefense, SessionTokenManager } from './auth';

export interface McpServerOptions {
  toolRouter?: ToolRouter;
  tokenManager?: SessionTokenManager;
  nonceDefense?: NonceReplayDefense;
  defaultScope?: string;
  allowedGatedEnv?: string;
}

export class McpServer {
  private readonly toolRouter: ToolRouter;
  private readonly tokenManager: SessionTokenManager;
  private readonly nonceDefense: NonceReplayDefense;
  private readonly defaultScope: string;
  private readonly allowedGatedEnv?: string;
  private httpServer: Server | null = null;
  private rl: readline.Interface | null = null;

  constructor(options?: McpServerOptions) {
    this.toolRouter = options?.toolRouter || new ToolRouter();
    this.tokenManager = options?.tokenManager || new SessionTokenManager();
    this.nonceDefense = options?.nonceDefense || new NonceReplayDefense();
    this.defaultScope = options?.defaultScope || 'standard';
    this.allowedGatedEnv = options?.allowedGatedEnv;
  }

  public async handleJsonRpcRequest(
    request: JsonRpcRequest,
    callerContext: { scope?: string; caller?: string; nonce?: string } = {}
  ): Promise<JsonRpcResponse> {
    const { id, method, params } = request;
    const reqId = id !== undefined ? id : null;

    // Check nonce replay if provided
    const nonce = callerContext.nonce || (params && typeof params === 'object' && !Array.isArray(params) && typeof params.nonce === 'string' ? params.nonce : undefined);
    if (nonce) {
      const nonceCheck = this.nonceDefense.validateAndRecord(nonce);
      if (!nonceCheck.valid) {
        return createErrorResponse(reqId, RPC_ERRORS.NONCE_REPLAY, nonceCheck.error);
      }
    }

    switch (method) {
      case 'initialize': {
        return createSuccessResponse(reqId, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: '@antidetect/mcp-server',
            version: '0.1.0',
          },
        });
      }

      case 'ping': {
        return createSuccessResponse(reqId, {});
      }

      case 'tools/list': {
        const tools = this.toolRouter.listTools();
        return createSuccessResponse(reqId, { tools });
      }

      case 'tools/call': {
        if (!params || typeof params !== 'object' || Array.isArray(params)) {
          return createErrorResponse(reqId, RPC_ERRORS.INVALID_PARAMS, 'Params must be an object with name and arguments');
        }

        const toolName = typeof params.name === 'string' ? params.name : '';
        if (!toolName) {
          return createErrorResponse(reqId, RPC_ERRORS.INVALID_PARAMS, 'Tool name is required');
        }

        const toolArgs = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments))
          ? (params.arguments as Record<string, unknown>)
          : {};

        const scope = callerContext.scope || this.defaultScope;
        const caller = callerContext.caller || 'mcp-caller';

        const result = await this.toolRouter.callTool(toolName, toolArgs, {
          scope,
          caller,
          nonce,
          allowedGatedEnv: this.allowedGatedEnv,
        });

        if (!result.success) {
          if (result.isProhibited) {
            return createErrorResponse(reqId, RPC_ERRORS.PROHIBITED, result.error);
          }
          if (result.isForbidden) {
            return createErrorResponse(reqId, RPC_ERRORS.FORBIDDEN, result.error);
          }
          return createErrorResponse(reqId, RPC_ERRORS.INTERNAL_ERROR, result.error);
        }

        return createSuccessResponse(reqId, {
          content: [
            {
              type: 'text',
              text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2),
            },
          ],
        });
      }

      default:
        return createErrorResponse(reqId, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  public startStdio(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', async (line: string) => {
      if (!line.trim()) return;

      const parsed = parseJsonRpcMessage(line);
      if (parsed.error) {
        process.stdout.write(JSON.stringify(parsed.error) + '\n');
        return;
      }

      if (parsed.request) {
        const response = await this.handleJsonRpcRequest(parsed.request, {
          scope: process.env.ANTIDETECT_MCP_SCOPE || this.defaultScope,
          caller: 'stdio-agent',
        });
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    });
  }

  public async startHttp(port: number, host: string = '127.0.0.1'): Promise<Server> {
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`MCP HTTP server MUST bind strictly to loopback interface (127.0.0.1). Rejected binding to '${host}'`);
    }
    const app: Express = express();
    app.use(express.json());

    // Loopback-only gate middleware
    app.use((req: Request, res: Response, next) => {
      const ip = req.socket.remoteAddress || '';
      if (!ip.includes('127.0.0.1') && !ip.includes('::1') && !ip.includes('localhost')) {
        res.status(403).json({ error: 'Forbidden: MCP server only accepts loopback connections' });
        return;
      }
      next();
    });

    // POST /mcp endpoint
    app.post('/mcp', async (req: Request, res: Response) => {
      const authHeader = req.headers.authorization || '';
      let scope = this.defaultScope;
      let caller = 'http-agent';

      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        const verification = this.tokenManager.verifyToken(token);
        if (!verification.valid || !verification.payload) {
          res.status(401).json(createErrorResponse(null, RPC_ERRORS.AUTH_EXPIRED, verification.error));
          return;
        }
        scope = verification.payload.scope || this.defaultScope;
        caller = verification.payload.sub || caller;
      }

      const rawBody = req.body;
      let jsonRpcReq: JsonRpcRequest;

      if (typeof rawBody === 'object' && rawBody !== null && rawBody.jsonrpc === '2.0') {
        jsonRpcReq = rawBody as JsonRpcRequest;
      } else {
        res.status(400).json(createErrorResponse(null, RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC request'));
        return;
      }

      const nonceHeader = req.headers['x-mcp-nonce'];
      const nonce = typeof nonceHeader === 'string' ? nonceHeader : undefined;

      const response = await this.handleJsonRpcRequest(jsonRpcReq, { scope, caller, nonce });
      res.json(response);
    });

    // GET /mcp/health endpoint
    app.get('/mcp/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', server: '@antidetect/mcp-server' });
    });

    return new Promise((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1', () => {
        this.httpServer = server;
        resolve(server);
      });
      server.on('error', (err) => reject(err));
    });
  }

  public stop(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.httpServer = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
