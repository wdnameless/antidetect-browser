import * as fs from 'fs';
import { deriveHardwareVector } from '../fingerprints/derivation';
import * as path from 'path';
import {
  deriveSubSeeds,
  getSyntheticVoicePool,
  getSyntheticMediaDevices,
  SubSeeds,
  SyntheticVoice,
  SyntheticMediaDevice,
} from './stealthNoise';

export type LogicalPlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

export interface StealthOptions {
  mobile: boolean;
  logicalPlatform: LogicalPlatform;
  ua?: string;
  model?: string;
  platformVersion?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  seed?: number;
  locale?: string;
  canvasNoise?: boolean;
  audioNoise?: boolean;
  rectsNoise?: boolean;
  webglNoise?: boolean;
  webglVendor?: string;
  webglRenderer?: string;
}

const BRANDS = [
  { brand: 'Google Chrome', version: '148' },
  { brand: 'Chromium', version: '148' },
  { brand: 'Not=A?Brand', version: '24' },
];

const FULL_VERSION_LIST = [
  { brand: 'Google Chrome', version: '148.0.7712.0' },
  { brand: 'Chromium', version: '148.0.7712.0' },
  { brand: 'Not=A?Brand', version: '24.0.0.0' },
];

function uaPlatform(lp: LogicalPlatform): string {
  switch (lp) {
    case 'windows': return 'Windows';
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    case 'android': return 'Android';
    case 'ios': return 'iOS';
  }
}

function navPlatform(lp: LogicalPlatform): string {
  switch (lp) {
    case 'windows': return 'Win32';
    case 'macos': return 'MacIntel';
    case 'linux': return 'Linux x86_64';
    case 'android': return 'Linux armv81';
    case 'ios': return 'iPhone';
  }
}

function defaultPlatformVersion(lp: LogicalPlatform): string {
  switch (lp) {
    case 'windows': return '15.0.0';
    case 'macos': return '14.5.0';
    case 'linux': return '6.5.0';
    case 'android': return '14.0.0';
    case 'ios': return '17.5.0';
  }
}

function architecture(lp: LogicalPlatform): string {
  switch (lp) {
    case 'android':
    case 'ios':
      return 'arm';
    default:
      return 'x86';
  }
}

export function buildStealthScript(opts: StealthOptions): string {
  const masterSeed = opts.seed ?? 12345;
  const subSeeds: SubSeeds = deriveSubSeeds(masterSeed);
  const voices: SyntheticVoice[] = getSyntheticVoicePool(opts.logicalPlatform, opts.locale ?? 'en-US');
  const mediaDevices: SyntheticMediaDevice[] = getSyntheticMediaDevices(masterSeed, opts.mobile);
  const hwVector = opts.logicalPlatform === 'windows' ? deriveHardwareVector(masterSeed) : null;

  const cfg = {
    mobile: opts.mobile,
    logicalPlatform: opts.logicalPlatform,
    locale: opts.locale ?? (hwVector ? hwVector.locale : 'en-US'),
    uaPlatform: uaPlatform(opts.logicalPlatform),
    navPlatform: navPlatform(opts.logicalPlatform),
    platformVersion: opts.platformVersion ?? (hwVector ? hwVector.platformVersion : defaultPlatformVersion(opts.logicalPlatform)),
    architecture: architecture(opts.logicalPlatform),
    bitness: '64',
    model: opts.model ?? (opts.logicalPlatform === 'android' ? 'Pixel 8' : opts.logicalPlatform === 'ios' ? 'iPhone' : ''),
    brands: BRANDS,
    fullVersionList: FULL_VERSION_LIST,
    hardwareConcurrency: opts.hardwareConcurrency ?? (hwVector ? hwVector.cpuCores : null),
    deviceMemory: opts.deviceMemory ?? (hwVector ? hwVector.ramGB : null),
    maxTouchPoints: opts.maxTouchPoints ?? null,
    canvasNoise: opts.canvasNoise ?? true,
    audioNoise: opts.audioNoise ?? true,
    rectsNoise: opts.rectsNoise ?? true,
    webglNoise: opts.webglNoise ?? true,
    webglVendor: opts.webglVendor ?? (hwVector ? hwVector.gpuVendor : 'Google Inc. (NVIDIA)'),
    webglRenderer: opts.webglRenderer ?? (hwVector ? hwVector.gpuRenderer : 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    seeds: subSeeds,
    voices,
    mediaDevices,
  };

  return `(() => {
  const CFG = ${JSON.stringify(cfg)};
  const isMobile = CFG.mobile;

  // Tiny embedded PRNG (Mulberry32)
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- Function.prototype.toString interception & Native function registry ---
  // TODO(engine-parity): Function.prototype.toString
  const origToString = Function.prototype.toString;
  const nativeFunctions = new WeakSet();
  const customNames = new WeakMap();

  function makeNative(fn, name, length) {
    if (typeof fn !== 'function') return fn;
    nativeFunctions.add(fn);
    if (name) {
      customNames.set(fn, name);
      try {
        Object.defineProperty(fn, 'name', {
          value: name,
          configurable: true,
          writable: false,
          enumerable: false,
        });
      } catch (e) {}
    }
    if (typeof length === 'number') {
      try {
        Object.defineProperty(fn, 'length', {
          value: length,
          configurable: true,
          writable: false,
          enumerable: false,
        });
      } catch (e) {}
    }
    return fn;
  }

  const customToString = function toString() {
    if (this === customToString) {
      return 'function toString() { [native code] }';
    }
    if (typeof this !== 'function') {
      return origToString.call(this);
    }
    if (nativeFunctions.has(this)) {
      const name = customNames.get(this) || this.name || '';
      return 'function ' + name + '() { [native code] }';
    }
    return origToString.call(this);
  };

  makeNative(customToString, 'toString', 0);

  try {
    Object.defineProperty(Function.prototype, 'toString', {
      value: customToString,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  } catch (e) {}

  function hookMethod(target, prop, fn) {
    if (!target) return;
    try {
      const orig = target[prop];
      const origLength = (orig && typeof orig.length === 'number') ? orig.length : 0;
      makeNative(fn, prop, origLength);
      Object.defineProperty(target, prop, {
        value: fn,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {}
  }

  function hookGetter(target, prop, getter) {
    if (!target) return;
    try {
      makeNative(getter, 'get ' + prop, 0);
      Object.defineProperty(target, prop, {
        get: getter,
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  // --- Client Hints: full navigator.userAgentData ---
  // TODO(engine-parity): Navigator.prototype.userAgentData
  const getHighEntropyValuesFn = makeNative(async function getHighEntropyValues(hints) {
    return {
      brands: CFG.brands,
      mobile: isMobile,
      platform: CFG.uaPlatform,
      platformVersion: CFG.platformVersion,
      architecture: CFG.architecture,
      bitness: CFG.bitness,
      wow64: false,
      model: CFG.model,
      fullVersionList: CFG.fullVersionList,
      formFactors: isMobile ? ['mobile'] : ['desktop'],
    };
  }, 'getHighEntropyValues', 1);

  const toJSONFn = makeNative(function toJSON() {
    return { brands: CFG.brands, mobile: isMobile, platform: CFG.uaPlatform };
  }, 'toJSON', 0);

  const uaData = {
    brands: CFG.brands,
    mobile: isMobile,
    platform: CFG.uaPlatform,
    platformVersion: CFG.platformVersion,
    architecture: CFG.architecture,
    bitness: CFG.bitness,
    wow64: false,
    model: CFG.model,
    fullVersionList: CFG.fullVersionList,
    formFactors: isMobile ? ['mobile'] : ['desktop'],
    getHighEntropyValues: getHighEntropyValuesFn,
    toJSON: toJSONFn,
  };

  if (typeof Navigator !== 'undefined') {
    hookGetter(Navigator.prototype, 'userAgentData', function () { return uaData; });
  }

  // --- Headless trace: window.chrome.runtime / webstore ---
  if (typeof window !== 'undefined' && window.chrome) {
    // TODO(engine-parity): window.chrome.runtime
    if (!window.chrome.runtime) {
      const noop = makeNative(function () {}, '', 0);
      const noopArrow = () => {};
      const evt = { addListener: noop, removeListener: noop, hasListener: makeNative(function () { return false; }, 'hasListener', 0) };
      const runtime = {
        id: undefined,
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        connect: () => null,
        connectNative: () => null,
        getBackgroundPage: () => null,
        getManifest: () => ({}),
        getURL: (p) => p,
        reload: noopArrow,
        requestUpdateCheck: (cb) => { if (cb) cb('no_update'); },
        sendMessage: noopArrow,
        sendNativeMessage: noopArrow,
        setUninstallURL: noopArrow,
        onConnect: evt,
        onInstalled: evt,
        onMessage: evt,
        onMessageExternal: evt,
        onStartup: evt,
        onSuspend: evt,
        onSuspendCanceled: evt,
        onUpdateAvailable: evt,
      };
      try { Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: runtime }); } catch (e) {}
    }
    // TODO(engine-parity): window.chrome.webstore
    if (!window.chrome.webstore) {
      const noop = makeNative(function () {}, '', 0);
      const noopArrow = () => {};
      const evt = { addListener: noop, removeListener: noop, hasListener: makeNative(function () { return false; }, 'hasListener', 0) };
      const webstore = {
        appPrivate: {
          beginInstallWithManifest: noopArrow,
          completeInstall: noopArrow,
          install: noopArrow,
          isInstalled: noopArrow,
          launch: noopArrow,
        },
        onInstallStageChanged: evt,
        onDownloadProgress: evt,
      };
      try { Object.defineProperty(window.chrome, 'webstore', { configurable: true, value: webstore }); } catch (e) {}
    }
  }

  // --- Platform consistency ---
  // TODO(engine-parity): Navigator.prototype.platform
  if (typeof Navigator !== 'undefined') {
    hookGetter(Navigator.prototype, 'platform', function () { return CFG.navPlatform; });
  }

  // --- Hardware signals ---
  if (typeof Navigator !== 'undefined') {
    // TODO(engine-parity): Navigator.prototype.hardwareConcurrency
    if (CFG.hardwareConcurrency !== null) {
      hookGetter(Navigator.prototype, 'hardwareConcurrency', function () { return CFG.hardwareConcurrency; });
    }

    // TODO(engine-parity): Navigator.prototype.deviceMemory
    if (isMobile) {
      hookGetter(Navigator.prototype, 'deviceMemory', function () { return undefined; });
    } else if (CFG.deviceMemory !== null) {
      hookGetter(Navigator.prototype, 'deviceMemory', function () { return CFG.deviceMemory; });
    }

    // TODO(engine-parity): Navigator.prototype.maxTouchPoints
    if (CFG.maxTouchPoints !== null) {
      hookGetter(Navigator.prototype, 'maxTouchPoints', function () { return CFG.maxTouchPoints; });
    }
  }

  // --- Mobile-only consistency ---
  if (isMobile) {
    const empty = {
      length: 0,
      item: makeNative(function item() { return null; }, 'item', 1),
      namedItem: makeNative(function namedItem() { return null; }, 'namedItem', 1),
      [Symbol.iterator]: function* () {},
    };
    if (typeof Navigator !== 'undefined') {
      // TODO(engine-parity): Navigator.prototype.plugins
      hookGetter(Navigator.prototype, 'plugins', function () { return empty; });
      // TODO(engine-parity): Navigator.prototype.mimeTypes
      hookGetter(Navigator.prototype, 'mimeTypes', function () { return empty; });
    }
    if (typeof Screen !== 'undefined') {
      // TODO(engine-parity): Screen.prototype.orientation
      hookGetter(Screen.prototype, 'orientation', function () { return { type: 'portrait-primary', angle: 0, onchange: null }; });
    }
    if (typeof Navigator !== 'undefined') {
      // TODO(engine-parity): Navigator.prototype.connection
      hookGetter(Navigator.prototype, 'connection', function () { return { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, onchange: null }; });
    }
  }

  // --- Notification permission ---
  // TODO(engine-parity): Notification.permission
  if (typeof Notification !== 'undefined') {
    try {
      const realPerm = Object.getOwnPropertyDescriptor(Notification, 'permission');
      hookGetter(Notification, 'permission', function () {
        let v = 'default';
        try { v = realPerm && realPerm.get ? realPerm.get.call(Notification) : Notification.permission; } catch (e) {}
        return v === 'denied' ? 'default' : v;
      });
    } catch (e) {}
  }

  // --- permissions.query ---
  // TODO(engine-parity): navigator.permissions.query
  if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    hookMethod(navigator.permissions, 'query', function query(desc) {
      return origQuery(desc).then(function (status) {
        if (desc && desc.name === 'notifications' && status && status.state === 'denied') {
          try { hookGetter(status, 'state', function () { return 'prompt'; }); } catch (e) {}
        }
        return status;
      });
    });
  }

  // --- Chromium API presence ---
  // TODO(engine-parity): window.ContentIndex
  if (typeof window !== 'undefined' && !('ContentIndex' in window)) {
    class ContentIndex {
      add() { return Promise.resolve(); }
      delete() { return Promise.resolve(); }
      getAll() { return Promise.resolve([]); }
      getDescriptions() { return Promise.resolve([]); }
    }
    try { Object.defineProperty(window, 'ContentIndex', { configurable: true, value: ContentIndex }); } catch (e) {}
  }

  // TODO(engine-parity): window.ContactsManager
  if (typeof window !== 'undefined' && !('ContactsManager' in window)) {
    class ContactsManager {
      select() { return Promise.resolve([]); }
      getProperties() { return Promise.resolve({}); }
    }
    try { Object.defineProperty(window, 'ContactsManager', { configurable: true, value: ContactsManager }); } catch (e) {}
  }

  // TODO(engine-parity): NetworkInformation.prototype.downlinkMax
  if (typeof window !== 'undefined' && window.NetworkInformation && window.NetworkInformation.prototype) {
    const niProto = window.NetworkInformation.prototype;
    if (!('downlinkMax' in niProto)) {
      hookGetter(niProto, 'downlinkMax', function () { return 10; });
    }
  }

  // --- Canvas 2D Noise Injection ---
  if (CFG.canvasNoise && typeof CanvasRenderingContext2D !== 'undefined') {
    // TODO(engine-parity): CanvasRenderingContext2D.prototype.getImageData
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    hookMethod(CanvasRenderingContext2D.prototype, 'getImageData', function getImageData(sx, sy, sw, sh) {
      const imageData = origGetImageData.apply(this, arguments);
      if (imageData && imageData.data) {
        const data = imageData.data;
        const seed = (CFG.seeds.canvas ^ (Number(sx) * 73856093) ^ (Number(sy) * 19349663) ^ (Number(sw) * 83492791) ^ (Number(sh) * 42345677)) >>> 0;
        const rng = mulberry32(seed);
        for (let i = 0; i < data.length; i += 4) {
          const n0 = Math.floor(rng() * 5) - 2;
          const n1 = Math.floor(rng() * 5) - 2;
          const n2 = Math.floor(rng() * 5) - 2;
          data[i] = Math.min(255, Math.max(0, data[i] + n0));
          data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n1));
          data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n2));
        }
      }
      return imageData;
    });

    if (typeof HTMLCanvasElement !== 'undefined') {
      // TODO(engine-parity): HTMLCanvasElement.prototype.toDataURL
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      hookMethod(HTMLCanvasElement.prototype, 'toDataURL', function toDataURL() {
        try {
          if (typeof document !== 'undefined' && document.createElement && this.width > 0 && this.height > 0) {
            const temp = document.createElement('canvas');
            temp.width = this.width;
            temp.height = this.height;
            const tCtx = temp.getContext('2d');
            if (tCtx && tCtx.drawImage) {
              tCtx.drawImage(this, 0, 0);
              const img = tCtx.getImageData(0, 0, temp.width, temp.height);
              tCtx.putImageData(img, 0, 0);
              return origToDataURL.apply(temp, arguments);
            }
          }
        } catch (e) {}
        return origToDataURL.apply(this, arguments);
      });

      // TODO(engine-parity): HTMLCanvasElement.prototype.toBlob
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      hookMethod(HTMLCanvasElement.prototype, 'toBlob', function toBlob(callback) {
        try {
          if (typeof document !== 'undefined' && document.createElement && this.width > 0 && this.height > 0) {
            const temp = document.createElement('canvas');
            temp.width = this.width;
            temp.height = this.height;
            const tCtx = temp.getContext('2d');
            if (tCtx && tCtx.drawImage) {
              tCtx.drawImage(this, 0, 0);
              const img = tCtx.getImageData(0, 0, temp.width, temp.height);
              tCtx.putImageData(img, 0, 0);
              return origToBlob.apply(temp, arguments);
            }
          }
        } catch (e) {}
        return origToBlob.apply(this, arguments);
      });
    }
  }

  // --- WebGL / WebGL2 Noise & Vendor Spoofing ---
  if (CFG.webglNoise) {
    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;

    if (typeof WebGLRenderingContext !== 'undefined') {
      // TODO(engine-parity): WebGLRenderingContext.prototype.getParameter
      const origGetParam = WebGLRenderingContext.prototype.getParameter;
      hookMethod(WebGLRenderingContext.prototype, 'getParameter', function getParameter(param) {
        if (param === UNMASKED_VENDOR_WEBGL) return CFG.webglVendor;
        if (param === UNMASKED_RENDERER_WEBGL) return CFG.webglRenderer;
        return origGetParam.apply(this, arguments);
      });

      // TODO(engine-parity): WebGLRenderingContext.prototype.readPixels
      const origReadPixels = WebGLRenderingContext.prototype.readPixels;
      hookMethod(WebGLRenderingContext.prototype, 'readPixels', function readPixels(x, y, w, h, format, type, pixels) {
        origReadPixels.apply(this, arguments);
        if (pixels && pixels.length) {
          const seed = (CFG.seeds.webgl ^ (Number(x) * 73856093) ^ (Number(y) * 19349663) ^ (Number(w) * 83492791) ^ (Number(h) * 42345677)) >>> 0;
          const rng = mulberry32(seed);
          for (let i = 0; i < pixels.length; i += 4) {
            const n0 = Math.floor(rng() * 5) - 2;
            const n1 = Math.floor(rng() * 5) - 2;
            const n2 = Math.floor(rng() * 5) - 2;
            pixels[i] = Math.min(255, Math.max(0, pixels[i] + n0));
            pixels[i + 1] = Math.min(255, Math.max(0, pixels[i + 1] + n1));
            pixels[i + 2] = Math.min(255, Math.max(0, pixels[i + 2] + n2));
          }
        }
      });
    }

    if (typeof WebGL2RenderingContext !== 'undefined') {
      // TODO(engine-parity): WebGL2RenderingContext.prototype.getParameter
      const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
      hookMethod(WebGL2RenderingContext.prototype, 'getParameter', function getParameter(param) {
        if (param === UNMASKED_VENDOR_WEBGL) return CFG.webglVendor;
        if (param === UNMASKED_RENDERER_WEBGL) return CFG.webglRenderer;
        return origGetParam2.apply(this, arguments);
      });

      // TODO(engine-parity): WebGL2RenderingContext.prototype.readPixels
      const origReadPixels2 = WebGL2RenderingContext.prototype.readPixels;
      hookMethod(WebGL2RenderingContext.prototype, 'readPixels', function readPixels(x, y, w, h, format, type, pixels) {
        origReadPixels2.apply(this, arguments);
        if (pixels && pixels.length) {
          const seed = (CFG.seeds.webgl ^ (Number(x) * 73856093) ^ (Number(y) * 19349663) ^ (Number(w) * 83492791) ^ (Number(h) * 42345677)) >>> 0;
          const rng = mulberry32(seed);
          for (let i = 0; i < pixels.length; i += 4) {
            const n0 = Math.floor(rng() * 5) - 2;
            const n1 = Math.floor(rng() * 5) - 2;
            const n2 = Math.floor(rng() * 5) - 2;
            pixels[i] = Math.min(255, Math.max(0, pixels[i] + n0));
            pixels[i + 1] = Math.min(255, Math.max(0, pixels[i + 1] + n1));
            pixels[i + 2] = Math.min(255, Math.max(0, pixels[i + 2] + n2));
          }
        }
      });
    }
  }

  // --- Audio Spoofing ---
  if (CFG.audioNoise) {
    if (typeof AudioBuffer !== 'undefined') {
      // TODO(engine-parity): AudioBuffer.prototype.getChannelData
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      hookMethod(AudioBuffer.prototype, 'getChannelData', function getChannelData(channel) {
        const data = origGetChannelData.apply(this, arguments);
        if (data && data.length) {
          const ch = Number(channel) || 0;
          const seed = (CFG.seeds.audio ^ (ch * 10007)) >>> 0;
          const rng = mulberry32(seed);
          for (let i = 0; i < data.length; i += 10) {
            const noise = (rng() * 0.0002) - 0.0001;
            data[i] = Math.max(-1, Math.min(1, data[i] + noise));
          }
        }
        return data;
      });

      // TODO(engine-parity): AudioBuffer.prototype.copyFromChannel
      const origCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
      if (origCopyFromChannel) {
        hookMethod(AudioBuffer.prototype, 'copyFromChannel', function copyFromChannel(destination, channelNumber, startInChannel) {
          origCopyFromChannel.apply(this, arguments);
          if (destination && destination.length) {
            const ch = Number(channelNumber) || 0;
            const seed = (CFG.seeds.audio ^ (ch * 10007)) >>> 0;
            const rng = mulberry32(seed);
            for (let i = 0; i < destination.length; i += 10) {
              const noise = (rng() * 0.0002) - 0.0001;
              destination[i] = Math.max(-1, Math.min(1, destination[i] + noise));
            }
          }
        });
      }
    }

    if (typeof AnalyserNode !== 'undefined') {
      // TODO(engine-parity): AnalyserNode.prototype.getFloatFrequencyData
      const origGetFloatFreq = AnalyserNode.prototype.getFloatFrequencyData;
      if (origGetFloatFreq) {
        hookMethod(AnalyserNode.prototype, 'getFloatFrequencyData', function getFloatFrequencyData(array) {
          origGetFloatFreq.apply(this, arguments);
          if (array && array.length) {
            const rng = mulberry32(CFG.seeds.audio);
            for (let i = 0; i < array.length; i += 5) {
              const noise = (rng() * 0.0002) - 0.0001;
              array[i] = array[i] + noise;
            }
          }
        });
      }
    }
  }

  // --- DOMRect / ClientRects Noise ---
  if (CFG.rectsNoise) {
    function applyRectJitter(rect) {
      if (!rect) return rect;
      const seed = (CFG.seeds.rects ^ Math.round((rect.width || 0) * 100) ^ Math.round((rect.height || 0) * 100) ^ Math.round((rect.x || rect.left || 0) * 100) ^ Math.round((rect.y || rect.top || 0) * 100)) >>> 0;
      const rng = mulberry32(seed);
      const dx = (rng() * 0.0002) - 0.0001;
      const dy = (rng() * 0.0002) - 0.0001;
      const dw = (rng() * 0.0002) - 0.0001;
      const dh = (rng() * 0.0002) - 0.0001;
      const x = (rect.x !== undefined ? rect.x : rect.left) + dx;
      const y = (rect.y !== undefined ? rect.y : rect.top) + dy;
      const width = rect.width + dw;
      const height = rect.height + dh;
      if (typeof DOMRect !== 'undefined') {
        return new DOMRect(x, y, width, height);
      }
      return {
        x: x,
        y: y,
        width: width,
        height: height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        toJSON: function() { return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }; }
      };
    }

    function wrapRectList(rectList) {
      if (!rectList || rectList.length === 0) return rectList;
      return new Proxy(rectList, {
        get(target, prop) {
          if (prop === 'item') {
            return makeNative(function item(index) {
              const r = target.item ? target.item(index) : target[index];
              return applyRectJitter(r);
            }, 'item', 1);
          }
          if (typeof prop === 'string' && !isNaN(Number(prop))) {
            const idx = Number(prop);
            const r = target[idx];
            return applyRectJitter(r);
          }
          const val = Reflect.get(target, prop);
          if (typeof val === 'function') {
            return val.bind(target);
          }
          return val;
        }
      });
    }

    if (typeof Element !== 'undefined') {
      // TODO(engine-parity): Element.prototype.getBoundingClientRect
      const origElemGetBoundingClientRect = Element.prototype.getBoundingClientRect;
      if (origElemGetBoundingClientRect) {
        hookMethod(Element.prototype, 'getBoundingClientRect', function getBoundingClientRect() {
          const rect = origElemGetBoundingClientRect.apply(this, arguments);
          return applyRectJitter(rect);
        });
      }

      // TODO(engine-parity): Element.prototype.getClientRects
      const origElemGetClientRects = Element.prototype.getClientRects;
      if (origElemGetClientRects) {
        hookMethod(Element.prototype, 'getClientRects', function getClientRects() {
          const rectList = origElemGetClientRects.apply(this, arguments);
          return wrapRectList(rectList);
        });
      }
    }

    if (typeof Range !== 'undefined') {
      // TODO(engine-parity): Range.prototype.getBoundingClientRect
      const origRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
      if (origRangeGetBoundingClientRect) {
        hookMethod(Range.prototype, 'getBoundingClientRect', function getBoundingClientRect() {
          const rect = origRangeGetBoundingClientRect.apply(this, arguments);
          return applyRectJitter(rect);
        });
      }

      // TODO(engine-parity): Range.prototype.getClientRects
      const origRangeGetClientRects = Range.prototype.getClientRects;
      if (origRangeGetClientRects) {
        hookMethod(Range.prototype, 'getClientRects', function getClientRects() {
          const rectList = origRangeGetClientRects.apply(this, arguments);
          return wrapRectList(rectList);
        });
      }
    }
  }

  // --- Peripherals & Voices ---
  // TODO(engine-parity): speechSynthesis.getVoices
  if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
    const voices = CFG.voices || [];
    hookMethod(window.speechSynthesis, 'getVoices', function getVoices() {
      return voices.map(function(v) {
        const obj = {
          default: v.default,
          lang: v.lang,
          localService: v.localService,
          name: v.name,
          voiceURI: v.voiceURI,
        };
        if (typeof SpeechSynthesisVoice !== 'undefined') {
          Object.setPrototypeOf(obj, SpeechSynthesisVoice.prototype);
        }
        return obj;
      });
    });
  }

  // TODO(engine-parity): navigator.mediaDevices.enumerateDevices
  if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    const devices = CFG.mediaDevices || [];
    hookMethod(navigator.mediaDevices, 'enumerateDevices', function enumerateDevices() {
      return Promise.resolve(devices.map(function(d) {
        const obj = {
          deviceId: d.deviceId,
          kind: d.kind,
          label: d.label,
          groupId: d.groupId,
          toJSON: function() { return { deviceId: d.deviceId, kind: d.kind, label: d.label, groupId: d.groupId }; }
        };
        if (typeof MediaDeviceInfo !== 'undefined') {
          Object.setPrototypeOf(obj, MediaDeviceInfo.prototype);
        }
        return obj;
      }));
    });
  }

  // TODO(engine-parity): navigator.getBattery
  if (typeof navigator !== 'undefined') {
    hookMethod(navigator, 'getBattery', function getBattery() {
      const isMob = isMobile;
      const batteryManager = {
        charging: !isMob,
        chargingTime: isMob ? Infinity : 0,
        dischargingTime: isMob ? 12000 : Infinity,
        level: isMob ? 0.85 : 1.0,
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null,
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return true; },
      };
      if (typeof BatteryManager !== 'undefined') {
        Object.setPrototypeOf(batteryManager, BatteryManager.prototype);
      }
      return Promise.resolve(batteryManager);
    });
  }
})();`;
}

export async function applyStealth(wsEndpoint: string, opts: StealthOptions): Promise<() => void> {
  // CDP script injection is broken in this kernel (addScriptToEvaluateOnNewDocument is
  // accepted but never runs; addScriptToEvaluateOnLoad fails deserialization). The stealth
  // layer is therefore delivered as a per-profile MV3 extension (MAIN world, document_start)
  // loaded via --load-extension. Nothing to do at CDP time.
  void wsEndpoint;
  void opts;
  return () => {};
}

export function writeStealthExtension(dir: string, opts: StealthOptions): string {
  const manifest = {
    manifest_version: 3,
    name: 'Stealth Layer',
    version: '1.0.0',
    description: 'Hardware and Client Hints consistency layer',
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['stealth.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: true,
      },
    ],
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'stealth.js'), buildStealthScript(opts), 'utf8');
  return dir;
}
