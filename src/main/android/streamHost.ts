import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { AdbClient, AdbError } from './adb';
import { ScrcpyParser, type ScrcpyCodecMeta } from './scrcpyProtocol';
import { logger } from '../util/logger';

export class StreamHostError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'StreamHostError';
  }
}

/**
 * Minimal surface streamHost needs, satisfied by A4's instance.
 * Declared here so A2 does not import A4 (instance.ts).
 */
export interface AndroidInstanceLike {
  readonly profileId: string;
  readonly serial: string;
  readonly adb: AdbClient;
  readonly screen: { width: number; height: number };
}

export interface AndroidStreamTicket {
  /** One-shot token; the WS upgrade URL must carry it. */
  ticket: string;
  wsUrl: string; // ws://127.0.0.1:<port>/android/stream?ticket=<t>
  width: number;
  height: number;
  expiresAt: number;
}

interface TicketRecord {
  expiresAt: number;
  consumed: boolean;
}

export interface StreamStartOptions {
  port: number;
  maxSize?: number;
  bitRate?: number;
  maxFps?: number;
  scrcpyServerPath?: string;
}

/**
 * Resolves the location of scrcpy-server.jar from explicit options, environment,
 * or standard project vendor/data directories.
 */
function resolveScrcpyServerPath(customPath?: string): string {
  const candidates: string[] = [];

  if (customPath) {
    candidates.push(customPath);
  }
  if (process.env.SCRCPY_SERVER_PATH) {
    candidates.push(process.env.SCRCPY_SERVER_PATH);
  }

  candidates.push(
    path.join(process.cwd(), 'data', 'android', 'scrcpy-server.jar'),
    path.join(process.cwd(), 'vendor', 'scrcpy-server.jar'),
    path.join(process.cwd(), 'scrcpy-server.jar'),
    path.resolve(__dirname, '..', '..', '..', 'vendor', 'scrcpy-server.jar'),
    path.resolve(__dirname, '..', '..', '..', 'data', 'android', 'scrcpy-server.jar')
  );

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  throw new StreamHostError(
    `scrcpy-server.jar not found. Checked candidate locations:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
    'ERR_ANDROID_SCRCPY_NOT_FOUND'
  );
}

/**
 * Relays an Android emulator screen stream (H.264 / scrcpy) to the frontend canvas
 * over a loopback-bound WebSocket server.
 *
 * Security and protocol invariants:
 * - Binds strictly to 127.0.0.1 (never 0.0.0.0).
 * - Upgrades require a valid, unconsumed single-use ticket issued by issueTicket().
 * - Binary WebSocket frames from guest are forwarded to connected clients untouched.
 * - Text WebSocket frames carry JSON status and error payloads per §4.1.
 * - Client binary frames are parsed per §4.1 and translated to guest control input.
 * - On stop(), every forwarded port is removed and the server process is killed.
 */
export class AndroidStreamHost {
  private readonly instance: AndroidInstanceLike;
  private _status: 'idle' | 'starting' | 'streaming' | 'error' = 'idle';
  private _port: number = 0;
  private _httpServer: http.Server | null = null;
  private _wss: WebSocketServer | null = null;
  private _serverProcess: ChildProcess | null = null;
  private _controlSocket: net.Socket | null = null;
  private _forwardedPorts: number[] = [];
  private readonly _tickets = new Map<string, TicketRecord>();
  private readonly _clients = new Set<WebSocket>();
  private readonly _parser = new ScrcpyParser({ expectCodecMeta: true });

  constructor(instance: AndroidInstanceLike) {
    this.instance = instance;
  }

  get status(): 'idle' | 'starting' | 'streaming' | 'error' {
    return this._status;
  }

  get codecMeta(): ScrcpyCodecMeta | null {
    return this._parser.codecMeta;
  }

  /**
   * Issues a one-shot stream ticket valid for 60 seconds.
   */
  issueTicket(): AndroidStreamTicket {
    const ticket = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 60_000;
    this._tickets.set(ticket, { expiresAt, consumed: false });

    return {
      ticket,
      wsUrl: `ws://127.0.0.1:${this._port}/android/stream?ticket=${ticket}`,
      width: this.instance.screen.width,
      height: this.instance.screen.height,
      expiresAt,
    };
  }

  /**
   * Pushes scrcpy-server.jar, forwards the socket, spawns the server, and starts the relay.
   */
  async start(opts: StreamStartOptions): Promise<void> {
    if (this._status === 'starting' || this._status === 'streaming') {
      throw new StreamHostError('Stream host is already running or starting', 'ERR_ANDROID_STREAM_ALREADY_STARTED');
    }

    this._status = 'starting';
    this._port = opts.port;

    try {
      // 1. Resolve and push scrcpy-server.jar
      const jarPath = resolveScrcpyServerPath(opts.scrcpyServerPath);
      logger.info(`[StreamHost] Pushing scrcpy-server.jar to ${this.instance.serial}...`);
      await this.instance.adb.push(jarPath, '/data/local/tmp/scrcpy-server.jar');

      // 2. Set up ADB forward for the scrcpy control/stream socket
      logger.info(`[StreamHost] Forwarding scrcpy socket on ${this.instance.serial}...`);
      const forwardPort = await this.instance.adb.forward('localabstract:scrcpy');
      this._forwardedPorts.push(forwardPort);

      // 3. Start local loopback HTTP server and WebSocketServer (never 0.0.0.0)
      this._httpServer = http.createServer((_req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });

      this._wss = new WebSocketServer({
        noServer: true,
        host: '127.0.0.1',
      });

      this.setupHttpUpgrade();

      const { promise: listenPromise, resolve: resolveListen, reject: rejectListen } = Promise.withResolvers<void>();
      this._httpServer.once('error', (err) => {
        rejectListen(new StreamHostError(`HTTP server failed to bind on 127.0.0.1:${this._port}: ${err.message}`, 'ERR_ANDROID_PORT_BIND'));
      });
      this._httpServer.listen(this._port, '127.0.0.1', () => {
        resolveListen();
      });
      await listenPromise;

      // 4. Spawn scrcpy server inside the guest via ADB shell app_process
      this.spawnScrcpyServer(opts);

      // 5. Connect control socket to the forwarded ADB port with retry
      this.connectControlSocket(forwardPort);

      logger.info(`[StreamHost] Android stream host listening on ws://127.0.0.1:${this._port}/android/stream`);
    } catch (err) {
      this._status = 'error';
      await this.cleanup();
      throw err;
    }
  }

  /**
   * Wires HTTP GET upgrade requests for `/android/stream?ticket=<token>`.
   */
  private setupHttpUpgrade(): void {
    if (!this._httpServer || !this._wss) return;

    this._httpServer.on('upgrade', (req, socket, head) => {
      const parsedUrl = new URL(req.url ?? '', 'http://127.0.0.1');

      if (req.method !== 'GET' || parsedUrl.pathname !== '/android/stream') {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const ticket = parsedUrl.searchParams.get('ticket');
      const record = ticket ? this._tickets.get(ticket) : undefined;
      const isTicketValid = record && !record.consumed && Date.now() <= record.expiresAt;

      if (!isTicketValid) {
        // Upgrade briefly to emit standard text error frame, then close
        this._wss?.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_TICKET', message: 'Invalid or expired stream ticket' }));
          ws.close(1008, 'INVALID_TICKET');
        });
        return;
      }

      // Mark single-use ticket consumed
      record.consumed = true;

      this._wss?.handleUpgrade(req, socket, head, (ws) => {
        this.handleClient(ws);
      });
    });
  }

  /**
   * Spawns the guest-side scrcpy server process using ADB and pipes stdout video frames.
   */
  private spawnScrcpyServer(opts: StreamStartOptions): void {
    const maxSize = opts.maxSize ?? 0;
    const bitRate = opts.bitRate ?? 4_000_000;
    const maxFps = opts.maxFps ?? 60;

    const cmd = [
      'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      '2.4',
      `max_size=${maxSize}`,
      `bit_rate=${bitRate}`,
      `max_fps=${maxFps}`,
      'audio=false',
      'tunnel_forward=true',
      'control=true',
    ].join(' ');

    const adbPath = this.instance.adb.adbPath;
    const adbArgs = ['-s', this.instance.serial, 'shell', cmd];

    this._serverProcess = spawn(adbPath, adbArgs, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._serverProcess.stdout?.on('data', (chunk: Buffer) => {
      this.handleGuestStreamData(chunk);
    });

    this._serverProcess.stderr?.on('data', (errChunk: Buffer) => {
      const text = errChunk.toString('utf-8').trim();
      if (text.length > 0) {
        logger.info(`[StreamHost:scrcpy:stderr] ${text}`);
      }
    });

    this._serverProcess.on('exit', (code, signal) => {
      logger.warn(`[StreamHost] scrcpy server process exited (code=${code}, signal=${signal})`);
      if (this._status !== 'idle') {
        this._status = 'error';
        this.broadcastStatus({
          type: 'error',
          code: 'ERR_ANDROID_SCRCPY_EXIT',
          message: `scrcpy server exited unexpectedly with code ${code}`,
        });
      }
    });
  }

  /**
   * Establishes TCP connection to the forwarded scrcpy control port on 127.0.0.1.
   */
  private connectControlSocket(port: number, attempt = 1): void {
    if (this._status === 'idle') return;

    const socket = net.connect({ host: '127.0.0.1', port });

    socket.once('connect', () => {
      logger.info(`[StreamHost] Connected to scrcpy control socket on port ${port}`);
      this._controlSocket = socket;
    });

    socket.on('data', (data: Buffer) => {
      // If video frames are routed through the socket tunnel, relay them
      this.handleGuestStreamData(data);
    });

    socket.on('error', (err) => {
      if (attempt < 5 && this._status !== 'idle') {
        setTimeout(() => this.connectControlSocket(port, attempt + 1), 300);
      } else {
        logger.warn(`[StreamHost] Control socket error: ${err.message}`);
      }
    });
  }

  /**
   * Processes raw scrcpy binary video chunks received from the guest,
   * feeds the incremental parser to track codec metadata, and relays untouched
   * binary frames to connected WebSocket clients.
   */
  private handleGuestStreamData(chunk: Buffer): void {
    if (this._status === 'starting') {
      this._status = 'streaming';
      this.broadcastStatus({ type: 'status', message: 'streaming' });
    }

    try {
      this._parser.feed(chunk);
    } catch (err) {
      logger.warn(`[StreamHost] ScrcpyParser error: ${(err as Error).message}`);
    }

    for (const client of this._clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(chunk, { binary: true });
      }
    }
  }

  /**
   * Manages an active WebSocket client connection.
   */
  private handleClient(ws: WebSocket): void {
    this._clients.add(ws);

    ws.send(JSON.stringify({ type: 'status', message: this._status }));

    ws.on('message', (data: unknown, isBinary: boolean) => {
      if (isBinary && Buffer.isBuffer(data)) {
        this.handleClientBinaryMessage(ws, data);
      }
    });

    ws.on('close', () => {
      this._clients.delete(ws);
    });

    ws.on('error', (err) => {
      logger.warn(`[StreamHost] Client WS error: ${err.message}`);
      this._clients.delete(ws);
    });
  }

  /**
   * Interprets client binary control messages per interfaces.md §4.1.
   */
  private handleClientBinaryMessage(ws: WebSocket, buf: Buffer): void {
    if (buf.length < 1) return;
    const type = buf.readUInt8(0);

    switch (type) {
      case 0x01: {
        // Touch: [0x01][action uint8][x uint32][y uint32][screenW uint32][screenH uint32][buttons uint8] (19 bytes)
        if (buf.length >= 19) {
          this.sendControl(buf);
        }
        break;
      }
      case 0x02: {
        // Scroll: [0x02][x uint32][y uint32][screenW uint32][screenH uint32][hScroll int32][vScroll int32] (25 bytes)
        if (buf.length >= 25) {
          this.sendControl(buf);
        }
        break;
      }
      case 0x03: {
        // Key: [0x03][keycode uint8] (2 bytes)
        if (buf.length >= 2) {
          this.sendControl(buf);
        }
        break;
      }
      case 0x04: {
        // Rotate: [0x04] (1 byte)
        this.sendControl(buf);
        // Dispatch emulator rotate console command
        this.instance.adb.emu(['rotate']).catch(() => {
          // Fallback to sending orientation toggle via settings/input
          this.instance.adb.shell(['input', 'keyevent', '26']).catch(() => {});
        });
        break;
      }
      case 0x05: {
        // Viewport changed: [0x05][width uint32][height uint32] (9 bytes)
        if (buf.length >= 9) {
          const width = buf.readUInt32BE(1);
          const height = buf.readUInt32BE(5);

          // Return fresh ScrcpyCodecMeta frame per §4.1: [12-byte header with size 12] + [12-byte body]
          const metaFrame = Buffer.allocUnsafe(24);
          metaFrame.writeBigUInt64BE(0n, 0); // pts = 0
          metaFrame.writeUInt32BE(12, 8); // size = 12
          metaFrame.writeUInt32BE(0x68323634, 12); // codecId: 'h264'
          metaFrame.writeUInt32BE(width, 16);
          metaFrame.writeUInt32BE(height, 20);

          ws.send(metaFrame, { binary: true });
        }
        break;
      }
      default:
        logger.warn(`[StreamHost] Unknown client control message type: ${type}`);
    }
  }

  /**
   * Broadcasts a text JSON status or error frame to all connected clients.
   */
  private broadcastStatus(payload: { type: 'status' | 'error'; message: string; code?: string }): void {
    const text = JSON.stringify(payload);
    for (const client of this._clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    }
  }

  /**
   * Sends a control message (touch/scroll/key/rotate) to the guest scrcpy server.
   */
  sendControl(msg: Buffer): void {
    if (this._controlSocket && !this._controlSocket.destroyed && this._controlSocket.writable) {
      this._controlSocket.write(msg);
    }
  }

  /**
   * Cleanly shuts down the stream host, closing sockets, killing the server process,
   * and removing all forwarded ADB ports.
   */
  async stop(): Promise<void> {
    if (this._status === 'idle') {
      return;
    }

    this._status = 'idle';
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    // 1. Close connected WebSocket clients
    for (const ws of this._clients) {
      try {
        ws.close(1000, 'Stream stopped');
      } catch {
        // Safe ignore
      }
    }
    this._clients.clear();

    // 2. Close WebSocketServer
    if (this._wss) {
      try {
        this._wss.close();
      } catch {
        // Safe ignore
      }
      this._wss = null;
    }

    // 3. Close HTTP server
    if (this._httpServer) {
      try {
        this._httpServer.close();
      } catch {
        // Safe ignore
      }
      this._httpServer = null;
    }

    // 4. Destroy control socket
    if (this._controlSocket) {
      try {
        this._controlSocket.destroy();
      } catch {
        // Safe ignore
      }
      this._controlSocket = null;
    }

    // 5. Kill server process
    if (this._serverProcess) {
      try {
        this._serverProcess.kill('SIGTERM');
      } catch {
        // Safe ignore
      }
      this._serverProcess = null;
    }

    // 6. Remove all forwarded ADB ports
    for (const port of this._forwardedPorts) {
      try {
        await this.instance.adb.removeForward(port);
      } catch {
        // Safe ignore removal errors on teardown
      }
    }
    this._forwardedPorts = [];
  }
}
