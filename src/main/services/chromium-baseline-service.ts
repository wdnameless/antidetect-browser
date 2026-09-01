import { createHash } from 'crypto';
import * as path from 'path';

export type LifecycleState = 'launching' | 'running' | 'stopping' | 'stopped' | 'error';
export type WebRtcMode = 'disabled' | 'fake' | 'public_only' | 'default';

export interface ChromiumScreenOverride {
  width: number;
  height: number;
  scaleFactor?: number;
}

export interface ChromiumFingerprintConfig {
  seed: number;
  platform?: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  platformVersion?: string;
  brand?: string;
  brandVersion?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  timezone?: string;
  lang?: string;
  webrtcMode?: WebRtcMode;
  audioNoise?: boolean;
  canvasNoise?: boolean;
  webglNoise?: boolean;
  fonts?: string[];
  clientHints?: {
    brands?: Array<{ brand: string; version: string }>;
    fullVersionList?: Array<{ brand: string; version: string }>;
    platform?: string;
    platformVersion?: string;
    architecture?: string;
    bitness?: string;
    model?: string;
    mobile?: boolean;
  };
}

export interface ChromiumProxyConfig {
  type: 'http' | 'https' | 'socks5' | 'direct';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ChromiumProfileConfig {
  id: string;
  name: string;
  engine: 'chromium';
  userDataDir: string;
  executablePath?: string;
  proxy?: ChromiumProxyConfig;
  fingerprint?: ChromiumFingerprintConfig;
  screenOverride?: ChromiumScreenOverride;
  extensions?: string[];
  flags?: string[];
  headless?: boolean;
  disableSandbox?: boolean;
}

export interface LaunchResult {
  profileId: string;
  pid: number;
  state: LifecycleState;
  debugPort: number;
  wsEndpoint: string;
  args: string[];
  startedAt: number;
}

export interface ProcessHandle {
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
}

export class ChromiumBaselineService {
  private activeInstances = new Map<string, {
    state: LifecycleState;
    result?: LaunchResult;
    process?: ProcessHandle;
    error?: string;
  }>();

  /**
   * Generates Chromium command-line launch arguments based on profile configuration,
   * sandbox options, fingerprint options, proxy parameters, and privacy/leak prevention flags.
   */
  public generateLaunchArgs(config: ChromiumProfileConfig): string[] {
    const args: string[] = [
      `--user-data-dir=${config.userDataDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--persist-session-cookies',
    ];

    if (config.headless) {
      args.push('--headless=new');
    }

    if (config.disableSandbox) {
      args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    // Proxy configuration
    if (config.proxy && config.proxy.type !== 'direct') {
      const proto = config.proxy.type === 'socks5' ? 'socks5://' : 'http://';
      args.push(`--proxy-server=${proto}${config.proxy.host}:${config.proxy.port}`);
    }

    // Screen / Viewport override
    if (config.screenOverride) {
      args.push(`--window-size=${config.screenOverride.width},${config.screenOverride.height}`);
      args.push('--window-position=0,0');
      if (config.screenOverride.scaleFactor) {
        args.push(`--force-device-scale-factor=${config.screenOverride.scaleFactor}`);
      }
    }

    // WebRTC policy flags
    const webrtcMode = config.fingerprint?.webrtcMode ?? 'public_only';
    if (webrtcMode === 'disabled') {
      args.push(
        '--disable-webrtc',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--enforce-webrtc-ip-permission-check'
      );
    } else if (webrtcMode === 'public_only') {
      args.push(
        '--webrtc-ip-handling-policy=default_public_interface_only',
        '--enforce-webrtc-ip-permission-check'
      );
    } else if (webrtcMode === 'fake') {
      args.push(
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--webrtc-ip-handling-policy=default_public_and_private_interfaces'
      );
    }

    // Fingerprint parameters & flags
    if (config.fingerprint) {
      const fp = config.fingerprint;
      if (fp.seed > 0) {
        args.push(`--fingerprint=${fp.seed}`);
      }
      if (fp.platform) {
        args.push(`--fingerprint-platform=${fp.platform}`);
      }
      if (fp.platformVersion) {
        args.push(`--fingerprint-platform-version=${fp.platformVersion}`);
      }
      if (fp.brand) {
        args.push(`--fingerprint-brand=${fp.brand}`);
      }
      if (fp.brandVersion) {
        args.push(`--fingerprint-brand-version=${fp.brandVersion}`);
      }
      if (fp.hardwareConcurrency) {
        args.push(`--fingerprint-hardware-concurrency=${fp.hardwareConcurrency}`);
      }
      if (fp.timezone) {
        args.push(`--timezone=${fp.timezone}`);
      }
      if (fp.lang) {
        args.push(`--lang=${fp.lang}`);
        args.push(`--accept-lang=${fp.lang}`);
      }
    }

    // Extensions
    if (config.extensions && config.extensions.length > 0) {
      args.push(`--load-extension=${config.extensions.join(',')}`);
    }

    // Custom supplemental flags
    if (config.flags && config.flags.length > 0) {
      for (const flag of config.flags) {
        if (!args.includes(flag)) {
          args.push(flag);
        }
      }
    }

    return args;
  }

  /**
   * Generates injected stealth script payload for Client Hints, WebRTC, Canvas, WebGL, Audio Context, and Fonts.
   */
  public generateFingerprintScript(fp: ChromiumFingerprintConfig): string {
    const seed = fp.seed || 12345;
    const webrtcMode = fp.webrtcMode ?? 'public_only';

    return `(() => {
  'use strict';
  const SEED = ${seed};
  const WEBRTC_MODE = ${JSON.stringify(webrtcMode)};
  const AUDIO_NOISE = ${Boolean(fp.audioNoise)};
  const CANVAS_NOISE = ${Boolean(fp.canvasNoise)};
  const WEBGL_NOISE = ${Boolean(fp.webglNoise)};
  const FONTS = ${JSON.stringify(fp.fonts || [])};
  const CLIENT_HINTS = ${JSON.stringify(fp.clientHints || null)};
  const HARDWARE_CONCURRENCY = ${fp.hardwareConcurrency ?? 8};
  const DEVICE_MEMORY = ${fp.deviceMemory ?? 8};
  const MAX_TOUCH_POINTS = ${fp.maxTouchPoints ?? 0};

  function lcg(s) {
    let state = s;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  const rng = lcg(SEED);

  // 1. Client Hints (navigator.userAgentData)
  if (CLIENT_HINTS || HARDWARE_CONCURRENCY) {
    const brands = CLIENT_HINTS?.brands || [
      { brand: 'Chromium', version: '148' },
      { brand: 'Google Chrome', version: '148' },
      { brand: 'Not.A.Brand', version: '24' }
    ];
    const fullVersionList = CLIENT_HINTS?.fullVersionList || [
      { brand: 'Chromium', version: '148.0.7778.215' },
      { brand: 'Google Chrome', version: '148.0.7778.215' },
      { brand: 'Not.A.Brand', version: '24.0.0.0' }
    ];
    const isMobile = CLIENT_HINTS?.mobile ?? false;
    const platform = CLIENT_HINTS?.platform || 'Windows';
    const platformVersion = CLIENT_HINTS?.platformVersion || '15.0.0';
    const architecture = CLIENT_HINTS?.architecture || 'x86';
    const bitness = CLIENT_HINTS?.bitness || '64';
    const model = CLIENT_HINTS?.model || '';

    const uaData = {
      brands,
      mobile: isMobile,
      platform,
      platformVersion,
      architecture,
      bitness,
      wow64: false,
      model,
      fullVersionList,
      formFactors: isMobile ? ['mobile'] : ['desktop'],
      getHighEntropyValues: async (hints) => {
        const res = {
          brands,
          mobile: isMobile,
          platform,
          platformVersion,
          architecture,
          bitness,
          wow64: false,
          model,
          fullVersionList,
          formFactors: isMobile ? ['mobile'] : ['desktop'],
        };
        return res;
      },
      toJSON: () => ({ brands, mobile: isMobile, platform })
    };

    try {
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        configurable: true,
        enumerable: true,
        get: () => uaData
      });
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
        configurable: true,
        enumerable: true,
        get: () => HARDWARE_CONCURRENCY
      });
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        configurable: true,
        enumerable: true,
        get: () => DEVICE_MEMORY
      });
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
        configurable: true,
        enumerable: true,
        get: () => MAX_TOUCH_POINTS
      });
    } catch (e) {}
  }

  // 2. WebRTC Protection & Leak Prevention
  if (WEBRTC_MODE === 'disabled') {
    try {
      delete window.RTCPeerConnection;
      delete window.webkitRTCPeerConnection;
      delete window.RTCSessionDescription;
      delete window.RTCIceCandidate;
    } catch (e) {}
  } else if (WEBRTC_MODE === 'fake' || WEBRTC_MODE === 'public_only') {
    if (typeof RTCPeerConnection !== 'undefined') {
      const origCreateOffer = RTCPeerConnection.prototype.createOffer;
      RTCPeerConnection.prototype.createOffer = async function(options) {
        const offer = await origCreateOffer.apply(this, arguments);
        if (WEBRTC_MODE === 'fake') {
          // Replace candidate lines with deterministic fake IP
          offer.sdp = offer.sdp.replace(/([0-9]{1,3}\\.){3}[0-9]{1,3}/g, '192.0.2.1');
        }
        return offer;
      };
    }
  }

  // 3. Canvas Noise Injection
  if (CANVAS_NOISE) {
    try {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
        const imageData = origGetImageData.apply(this, arguments);
        const data = imageData.data;
        // Deterministic noise based on seed
        const noiseFactor = (SEED % 5) + 1;
        for (let i = 0; i < data.length; i += 64) {
          data[i] = (data[i] + noiseFactor) % 256;
        }
        return imageData;
      };

      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const img = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
            ctx.putImageData(img, 0, 0);
          } catch(e) {}
        }
        return origToDataURL.apply(this, args);
      };
    } catch (e) {}
  }

  // 4. WebGL Noise Injection & Vendor Masking
  if (WEBGL_NOISE) {
    try {
      const origGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(param) {
        // UNMASKED_VENDOR_WEBGL
        if (param === 0x9245) return 'Google Inc. (NVIDIA)';
        // UNMASKED_RENDERER_WEBGL
        if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return origGetParameter.apply(this, arguments);
      };
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(param) {
          if (param === 0x9245) return 'Google Inc. (NVIDIA)';
          if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return origGetParameter2.apply(this, arguments);
        };
      }
    } catch (e) {}
  }

  // 5. Audio Context Spoofing
  if (AUDIO_NOISE) {
    try {
      if (typeof AudioBuffer !== 'undefined') {
        const origGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(channel) {
          const data = origGetChannelData.apply(this, arguments);
          const offset = ((SEED % 10) - 5) * 1e-7;
          for (let i = 0; i < data.length; i += 100) {
            data[i] = data[i] + offset;
          }
          return data;
        };
      }
    } catch (e) {}
  }
})();`;
  }

  /**
   * Simulates/coordinates profile lifecycle state transitions.
   */
  public async launchProfile(
    config: ChromiumProfileConfig,
    customSpawn?: (args: string[]) => ProcessHandle
  ): Promise<LaunchResult> {
    if (this.activeInstances.has(config.id)) {
      const active = this.activeInstances.get(config.id)!;
      if (active.state === 'running' || active.state === 'launching') {
        throw new Error(`Profile ${config.id} is already in state ${active.state}`);
      }
    }

    this.activeInstances.set(config.id, { state: 'launching' });

    try {
      const args = this.generateLaunchArgs(config);
      const pid = Math.floor(1000 + Math.random() * 90000);
      const debugPort = Math.floor(9222 + Math.random() * 5000);
      const wsEndpoint = `ws://127.0.0.1:${debugPort}/devtools/browser/${config.id}`;

      let proc: ProcessHandle;
      if (customSpawn) {
        proc = customSpawn(args);
      } else {
        proc = {
          pid,
          killed: false,
          exitCode: null,
          signalCode: null,
          kill: (signal?: NodeJS.Signals | number) => {
            proc.killed = true;
            proc.exitCode = 0;
            return true;
          }
        };
      }

      const launchResult: LaunchResult = {
        profileId: config.id,
        pid: proc.pid,
        state: 'running',
        debugPort,
        wsEndpoint,
        args,
        startedAt: Date.now()
      };

      this.activeInstances.set(config.id, {
        state: 'running',
        result: launchResult,
        process: proc
      });

      return launchResult;
    } catch (err) {
      this.activeInstances.set(config.id, {
        state: 'error',
        error: (err as Error).message
      });
      throw err;
    }
  }

  /**
   * Stops an active profile cleanly.
   */
  public async stopProfile(profileId: string): Promise<boolean> {
    const instance = this.activeInstances.get(profileId);
    if (!instance || instance.state === 'stopped') {
      return false;
    }

    instance.state = 'stopping';
    if (instance.process && !instance.process.killed) {
      instance.process.kill('SIGTERM');
      instance.process.killed = true;
    }

    instance.state = 'stopped';
    return true;
  }

  /**
   * Retrieves current lifecycle state of a profile.
   */
  public getState(profileId: string): LifecycleState {
    const instance = this.activeInstances.get(profileId);
    return instance ? instance.state : 'stopped';
  }

  /**
   * Retrieves launch result if running.
   */
  public getLaunchResult(profileId: string): LaunchResult | undefined {
    return this.activeInstances.get(profileId)?.result;
  }
}

export const chromiumBaselineService = new ChromiumBaselineService();
