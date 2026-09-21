import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as child_process from 'child_process';
import { AdbClient, allocateEmulatorPorts } from './adb';
import { AndroidStreamHost, type AndroidStreamTicket, type AndroidInstanceLike } from './streamHost';
import { generateAndroidFingerprint } from './fingerprint';
import { injectGuestIdentity, detectSpoofModule, type InjectResult } from './injector';
import {
  planGuestNetwork,
  setupGuestNetwork,
  teardownGuestNetwork,
  pushGeolocation,
  connectController,
} from './network';
import { logger } from '../util/logger';

export interface AndroidStartOptions {
  profileId: string;
  systemImageDir: string;
  emulatorPath: string;
  adbPath: string;
  /** Per-profile writable overlay; created from the read-only base if absent. */
  dataImagePath: string;
  screen: { width: number; height: number };
  proxy: { type: string; host: string; port: number; username?: string | null; password?: string | null } | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  seed: number;
  headless?: boolean; // always true today; kept explicit for R01
  coldBoot?: boolean; // skip the quickboot snapshot
}

export interface AndroidInstanceStatus {
  profileId: string;
  state: 'starting' | 'booting' | 'running' | 'stopped' | 'error';
  serial: string;
  consolePort: number;
  adbPort: number;
  screen: { width: number; height: number };
  stream: 'idle' | 'starting' | 'streaming' | 'error';
  startedAt: number;
  error?: { code: string; message: string };
  inject?: InjectResult;
}

export class AndroidRuntimeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AndroidRuntimeError';
  }
}

/** Allocates a free loopback port for the WebSocket stream relay */
function getFreePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      server.close(() => reject(new AndroidRuntimeError('Failed to obtain free port for stream host', 'ERR_PORT')));
      return;
    }
    const port = addr.port;
    server.close((err) => {
      if (err) reject(err);
      else resolve(port);
    });
  });
  return promise;
}

export class AndroidInstance implements AndroidInstanceLike {
  readonly profileId: string;
  serial: string;
  adb: AdbClient;
  readonly screen: { width: number; height: number };
  consolePort = 0;
  adbPort = 0;

  private process: child_process.ChildProcess | null = null;
  private streamHost: AndroidStreamHost | null = null;
  private _status: AndroidInstanceStatus;

  constructor(private readonly options: AndroidStartOptions) {
    this.profileId = options.profileId;
    this.screen = options.screen;
    this.serial = '';
    // Provisional AdbClient; updated when ports are allocated
    this.adb = new AdbClient(options.adbPath, 'emulator-provisional');

    this._status = {
      profileId: options.profileId,
      state: 'starting',
      serial: '',
      consolePort: 0,
      adbPort: 0,
      screen: options.screen,
      stream: 'idle',
      startedAt: Date.now(),
    };
  }

  get status(): AndroidInstanceStatus {
    return { ...this._status };
  }

  /**
   * Builds the writable data image from read-only base if absent.
   * NEVER writes to the base system image directory.
   */
  private ensureWritableDataImage(): void {
    const dataImagePath = this.options.dataImagePath;
    const targetDir = path.dirname(dataImagePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    if (!fs.existsSync(dataImagePath)) {
      const baseUserData = path.join(this.options.systemImageDir, 'userdata.img');
      if (fs.existsSync(baseUserData)) {
        logger.info(`Creating overlay data image for ${this.profileId} from ${baseUserData}`);
        fs.copyFileSync(baseUserData, dataImagePath);
      } else {
        fs.writeFileSync(dataImagePath, Buffer.alloc(0));
      }
    }
  }

  /**
   * Starts the emulator according to the documented lifecycle:
   * 1. build writable data image
   * 2. spawn emulator (-no-window -no-audio -no-boot-anim -read-only)
   * 3. adb.waitForBoot()
   * 4. inject guest identity
   * 5. setup guest network
   * 6. start stream host
   *
   * Note: status.state transitions from 'starting' -> 'booting' -> 'running'
   * and becomes 'running' ONLY AFTER waitForBoot() completes.
   */
  async start(): Promise<void> {
    this._status.state = 'starting';
    this._status.startedAt = Date.now();

    if (!this.options.emulatorPath || !fs.existsSync(this.options.emulatorPath)) {
      const err = new AndroidRuntimeError(
        `Emulator binary not found at ${this.options.emulatorPath}`,
        'ERR_ANDROID_NOT_READY'
      );
      this._status.state = 'error';
      this._status.error = { code: 'ERR_ANDROID_NOT_READY', message: err.message };
      throw err;
    }

    if (!this.options.systemImageDir || !fs.existsSync(this.options.systemImageDir)) {
      const err = new AndroidRuntimeError(
        `System image directory not found at ${this.options.systemImageDir}`,
        'ERR_ANDROID_NOT_READY'
      );
      this._status.state = 'error';
      this._status.error = { code: 'ERR_ANDROID_NOT_READY', message: err.message };
      throw err;
    }

    // 1. Build the writable data image
    this.ensureWritableDataImage();

    // Allocate emulator console and ADB ports
    const ports = await allocateEmulatorPorts();
    this.consolePort = ports.console;
    this.adbPort = ports.adb;
    this.serial = `emulator-${this.consolePort}`;
    this.adb = new AdbClient(this.options.adbPath, this.serial);

    this._status.serial = this.serial;
    this._status.consolePort = this.consolePort;
    this._status.adbPort = this.adbPort;

    // 2. Spawn the emulator
    this._status.state = 'booting';
    await this.spawnEmulator();

    try {
      // 3. Wait for guest to finish booting
      await this.adb.waitForBoot();

      // Guest is confirmed booted; transition to 'running'
      this._status.state = 'running';

      // 4. Inject mobile identity over ADB
      const fp = generateAndroidFingerprint(this.profileId, this.options.seed);
      const hasZygisk = await detectSpoofModule(this.adb).catch(() => false);
      const injectResult = await injectGuestIdentity(this.adb, fp, {
        timezone: this.options.timezone,
        hasZygisk,
      });
      this._status.inject = injectResult;

      // 5. Setup guest network & geolocation
      const netPlan = planGuestNetwork(this.options.proxy);
      await setupGuestNetwork(this.adb, netPlan, {});

      if (typeof this.options.latitude === 'number' && typeof this.options.longitude === 'number') {
        try {
          const homeDir = process.env.USERPROFILE || process.env.HOME || '';
          const authTokenPath = path.join(homeDir, '.emulator_console_auth_token');
          if (fs.existsSync(authTokenPath)) {
            const controller = connectController(this.consolePort, authTokenPath);
            await pushGeolocation(controller, {
              latitude: this.options.latitude,
              longitude: this.options.longitude,
            });
            controller.close();
          }
        } catch (geoErr) {
          logger.warn(`Failed to push geolocation for Android profile ${this.profileId}:`, geoErr);
        }
      }

      // 6. Start stream host
      this.streamHost = new AndroidStreamHost(this);
      this._status.stream = 'starting';
      const streamPort = await getFreePort();
      await this.streamHost.start({ port: streamPort });
      this._status.stream = this.streamHost.status;
    } catch (bootErr: unknown) {
      const code =
        bootErr && typeof bootErr === 'object' && 'code' in bootErr && typeof bootErr.code === 'string'
          ? bootErr.code
          : 'ERR_ANDROID_BOOT_FAILED';
      const message = bootErr instanceof Error ? bootErr.message : String(bootErr);
      this._status.state = 'error';
      this._status.error = { code, message };
      await this.stop().catch(() => {});
      throw bootErr;
    }
  }

  private async spawnEmulator(): Promise<void> {
    const args: string[] = [
      '-port',
      String(this.consolePort),
      '-sysdir',
      this.options.systemImageDir,
      '-data',
      this.options.dataImagePath,
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
      '-read-only',
      '-skin',
      `${this.options.screen.width}x${this.options.screen.height}`,
    ];

    if (this.options.coldBoot) {
      args.push('-no-snapshot-load', '-no-snapshot-save');
    }

    logger.info(`Spawning emulator for ${this.profileId}: ${this.options.emulatorPath} ${args.join(' ')}`);

    const child = child_process.spawn(this.options.emulatorPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    });

    this.process = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      logger.info(`[emulator ${this.profileId}] ${chunk.toString().trim()}`);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      logger.warn(`[emulator ${this.profileId} stderr] ${chunk.toString().trim()}`);
    });

    child.on('error', (err: Error) => {
      logger.error(`Emulator process error for ${this.profileId}:`, err);
      this._status.state = 'error';
      this._status.error = { code: 'ERR_ANDROID_EMULATOR_PROCESS', message: err.message };
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      logger.info(`Emulator process exited for ${this.profileId} (code: ${code}, signal: ${signal})`);
      if (this._status.state === 'running' || this._status.state === 'booting') {
        this._status.state = 'stopped';
      }
      this.process = null;
    });
  }

  /**
   * Tears down the running guest:
   * snapshots best-effort -> tears down network -> stops stream host -> adb emu kill -> kills process tree.
   */
  async stop(): Promise<void> {
    logger.info(`Stopping Android instance for ${this.profileId} (${this.serial})`);

    // 1. Snapshot best-effort unless coldBoot was requested
    if (!this.options.coldBoot && this.adb) {
      try {
        await this.adb.shell(['am', 'broadcast', '-a', 'android.intent.action.ACTION_SHUTDOWN']).catch(() => {});
      } catch {
        // ignore best-effort snapshot error
      }
    }

    // 2. Teardown guest network
    if (this.adb) {
      try {
        await teardownGuestNetwork(this.adb);
      } catch (err) {
        logger.warn(`Failed to teardown guest network for ${this.profileId}: ${err}`);
      }
    }

    // 3. Stop stream host (removes forwards)
    if (this.streamHost) {
      try {
        await this.streamHost.stop();
      } catch (err) {
        logger.warn(`Failed to stop stream host for ${this.profileId}: ${err}`);
      }
      this.streamHost = null;
    }

    // 4. ADB emu kill
    if (this.adb) {
      try {
        await this.adb.kill();
      } catch {
        // ignore adb kill failure if emulator already stopping
      }
    }

    // 5. Kill process tree
    if (this.process && this.process.pid) {
      const pid = this.process.pid;
      try {
        if (process.platform === 'win32') {
          child_process.execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(-pid, 'SIGKILL');
        }
      } catch {
        try {
          this.process.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      this.process = null;
    }

    this._status.state = 'stopped';
    this._status.stream = 'idle';
  }

  issueStreamTicket(): AndroidStreamTicket {
    if (this._status.state !== 'running' || !this.streamHost) {
      throw new AndroidRuntimeError(
        `Cannot issue stream ticket: Android instance for ${this.profileId} is not running (state: ${this._status.state})`,
        'NOT_RUNNING'
      );
    }
    return this.streamHost.issueTicket();
  }
}

// Module-level registry
const instances = new Map<string, AndroidInstance>();

export async function startAndroidProfile(o: AndroidStartOptions): Promise<AndroidInstanceStatus> {
  if (!o.emulatorPath || !fs.existsSync(o.emulatorPath)) {
    throw new AndroidRuntimeError(`Emulator binary not found at ${o.emulatorPath}`, 'ERR_ANDROID_NOT_READY');
  }
  if (!o.systemImageDir || !fs.existsSync(o.systemImageDir)) {
    throw new AndroidRuntimeError(
      `Android system image directory not found at ${o.systemImageDir}`,
      'ERR_ANDROID_NOT_READY'
    );
  }

  const existing = instances.get(o.profileId);
  if (existing && existing.status.state === 'running') {
    return existing.status;
  }

  if (existing) {
    await existing.stop().catch(() => {});
    instances.delete(o.profileId);
  }

  const instance = new AndroidInstance(o);
  instances.set(o.profileId, instance);

  try {
    await instance.start();
    return instance.status;
  } catch (err) {
    instances.delete(o.profileId);
    throw err;
  }
}

export async function stopAndroidProfile(profileId: string): Promise<boolean> {
  const instance = instances.get(profileId);
  if (!instance) return false;

  try {
    await instance.stop();
    return true;
  } finally {
    instances.delete(profileId);
  }
}

export function isAndroidRunning(profileId: string): boolean {
  const instance = instances.get(profileId);
  return Boolean(instance && instance.status.state === 'running');
}

export function getAndroidInstance(profileId: string): AndroidInstance | undefined {
  return instances.get(profileId);
}

export function listAndroidStatuses(): AndroidInstanceStatus[] {
  return Array.from(instances.values()).map((inst) => inst.status);
}

export async function shutdownAllAndroid(): Promise<void> {
  const all = Array.from(instances.values());
  await Promise.allSettled(all.map((inst) => inst.stop()));
  instances.clear();
}
