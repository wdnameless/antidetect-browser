import * as net from 'net';
import { notifyTransportLoss } from './transportPolicy';

export interface TransportDropMonitorOptions {
  profileId: string;
  host: string;
  port: number;
  intervalMs?: number;
  failureThreshold?: number;
  probe?: (host: string, port: number, timeoutMs?: number) => Promise<void>;
}

export function defaultTcpProbe(host: string, port: number, timeoutMs = 5000): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const socket = new net.Socket();
  let settled = false;

  const cleanup = () => {
    socket.removeAllListeners();
    socket.destroy();
  };

  socket.setTimeout(timeoutMs);

  socket.once('connect', () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  });

  socket.once('timeout', () => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(new Error(`TCP probe timed out after ${timeoutMs}ms`));
  });

  socket.once('error', (err) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(err);
  });

  try {
    socket.connect(port, host);
  } catch (err) {
    if (settled) return;
    settled = true;
    cleanup();
    reject(err);
  }

  return promise;
}

export class TransportDropMonitor {
  private profileId: string;
  private host: string;
  private port: number;
  private intervalMs: number;
  private failureThreshold: number;
  private probe: (host: string, port: number, timeoutMs?: number) => Promise<void>;

  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private isProbing = false;
  private hasNotified = false;

  constructor(opts: TransportDropMonitorOptions) {
    this.profileId = opts.profileId;
    this.host = opts.host;
    this.port = opts.port;
    this.intervalMs = opts.intervalMs ?? 15000;
    this.failureThreshold = opts.failureThreshold ?? 2;
    this.probe = opts.probe ?? defaultTcpProbe;
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.executeProbe();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  private async executeProbe(): Promise<void> {
    if (this.isProbing) {
      return;
    }
    this.isProbing = true;
    try {
      await this.probe(this.host, this.port);
      this.consecutiveFailures = 0;
      this.hasNotified = false;
    } catch {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.failureThreshold && !this.hasNotified) {
        this.hasNotified = true;
        notifyTransportLoss('proxy_connection_dropped', this.profileId);
      }
    } finally {
      this.isProbing = false;
    }
  }
}
