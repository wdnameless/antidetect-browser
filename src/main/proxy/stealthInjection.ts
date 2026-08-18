// Stealth layer injected into every page document.
// Fixes the two top weaknesses found in the audit:
//  1. Headless trace: window.chrome.runtime/webstore missing, Notification.permission 'denied',
//     permissions.query(notifications) 'denied', userAgentData brands missing "Google Chrome".
//  2. Client Hints: navigator.userAgentData was null / kernel-derived (reduced brands).
// The kernel stays Windows; mobile consistency (platform, plugins, memory, sensors) is
// applied here at the JS layer, like GoLogin/Octo do.
//
// NOTE: the kernel's Page.addScriptToEvaluateOnNewDocument is accepted but never executed
// (kernel bug), so injection happens through a per-profile MV3 extension with a MAIN-world
// content script at document_start (--load-extension), which the kernel supports.
import * as fs from 'fs';
import * as path from 'path';

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
}

const CHROME_VERSION = '148.0.7778.215';
const BRANDS = [
  { brand: 'Chromium', version: '148' },
  { brand: 'Google Chrome', version: '148' },
  { brand: 'Not.A.Brand', version: '24' },
];
const FULL_VERSION_LIST = [
  { brand: 'Chromium', version: CHROME_VERSION },
  { brand: 'Google Chrome', version: CHROME_VERSION },
  { brand: 'Not.A.Brand', version: '24.0.0.0' },
];

function uaPlatform(p: LogicalPlatform): string {
  switch (p) {
    case 'android': return 'Android';
    case 'ios': return 'iOS';
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    default: return 'Windows';
  }
}

function navPlatform(p: LogicalPlatform): string {
  switch (p) {
    case 'android': return 'Linux armv8l';
    case 'ios': return 'iPhone';
    case 'macos': return 'MacIntel';
    case 'linux': return 'Linux x86_64';
    default: return 'Win32';
  }
}

function architecture(p: LogicalPlatform): string {
  return p === 'macos' || p === 'android' || p === 'ios' ? 'arm' : 'x86';
}

function defaultPlatformVersion(p: LogicalPlatform): string {
  switch (p) {
    case 'android': return '14.0.0';
    case 'ios': return '17.5.0';
    case 'macos': return '15.2.0';
    case 'linux': return '6.1.0';
    default: return '15.0.0';
  }
}

export function buildStealthScript(opts: StealthOptions): string {
  const cfg = {
    mobile: opts.mobile,
    uaPlatform: uaPlatform(opts.logicalPlatform),
    navPlatform: navPlatform(opts.logicalPlatform),
    platformVersion: opts.platformVersion ?? defaultPlatformVersion(opts.logicalPlatform),
    architecture: architecture(opts.logicalPlatform),
    bitness: '64',
    model: opts.model ?? (opts.logicalPlatform === 'android' ? 'Pixel 8' : opts.logicalPlatform === 'ios' ? 'iPhone' : ''),
    brands: BRANDS,
    fullVersionList: FULL_VERSION_LIST,
    hardwareConcurrency: opts.hardwareConcurrency ?? null,
    deviceMemory: opts.deviceMemory ?? null,
    maxTouchPoints: opts.maxTouchPoints ?? null,
  };
  return `(() => {
  const CFG = ${JSON.stringify(cfg)};
  const isMobile = CFG.mobile;

  // --- Client Hints: full navigator.userAgentData (brands incl. Google Chrome) ---
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
    getHighEntropyValues: async function (hints) {
      const out = {
        brands: uaData.brands,
        mobile: uaData.mobile,
        platform: uaData.platform,
        platformVersion: uaData.platformVersion,
        architecture: uaData.architecture,
        bitness: uaData.bitness,
        wow64: uaData.wow64,
        model: uaData.model,
        fullVersionList: uaData.fullVersionList,
        formFactors: uaData.formFactors,
      };
      return out;
    },
    toJSON: function () {
      return { brands: uaData.brands, mobile: uaData.mobile, platform: uaData.platform };
    },
  };
  try {
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      configurable: true,
      enumerable: true,
      get: function () { return uaData; },
    });
  } catch (e) {}

  // --- Headless trace: window.chrome.runtime / webstore ---
  if (window.chrome) {
    if (!window.chrome.runtime) {
      const noop = function () {};
      // Arrow functions are not constructible: new chrome.runtime.sendMessage throws
      // TypeError, which is what real Chrome does (creepjs hasBadChromeRuntime).
      const noopArrow = () => {};
      const evt = { addListener: noop, removeListener: noop, hasListener: function () { return false; } };
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
    if (!window.chrome.webstore) {
      const noop = function () {};
      const noopArrow = () => {};
      const evt = { addListener: noop, removeListener: noop, hasListener: function () { return false; } };
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

  // --- Platform consistency (kernel reports Win32 even for mobile UAs) ---
  try {
    Object.defineProperty(Navigator.prototype, 'platform', {
      configurable: true,
      get: function () { return CFG.navPlatform; },
    });
  } catch (e) {}

  // --- webdriver: kernel already sets false natively; overriding it here would make the
  // getter non-native and trip lie detectors (creepjs webDriverIsOn). Do NOT touch it. ---

  // --- Hardware signals ---
  if (CFG.hardwareConcurrency !== null) {
    try {
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
        configurable: true,
        get: function () { return CFG.hardwareConcurrency; },
      });
    } catch (e) {}
  }
  if (isMobile) {
    // Real Android/iOS Chrome does not expose deviceMemory.
    try {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        configurable: true,
        get: function () { return undefined; },
      });
    } catch (e) {}
  } else if (CFG.deviceMemory !== null) {
    try {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        configurable: true,
        get: function () { return CFG.deviceMemory; },
      });
    } catch (e) {}
  }
  if (CFG.maxTouchPoints !== null) {
    try {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
        configurable: true,
        get: function () { return CFG.maxTouchPoints; },
      });
    } catch (e) {}
  }

  // --- Mobile-only consistency ---
  if (isMobile) {
    const empty = {
      length: 0,
      item: function () { return null; },
      namedItem: function () { return null; },
      [Symbol.iterator]: function* () {},
    };
    try {
      Object.defineProperty(Navigator.prototype, 'plugins', {
        configurable: true,
        get: function () { return empty; },
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, 'mimeTypes', {
        configurable: true,
        get: function () { return empty; },
      });
    } catch (e) {}
    try {
      Object.defineProperty(Screen.prototype, 'orientation', {
        configurable: true,
        get: function () { return { type: 'portrait-primary', angle: 0, onchange: null }; },
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, 'connection', {
        configurable: true,
        get: function () { return { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, onchange: null }; },
      });
    } catch (e) {}
  }

  // --- Notification permission: headless reports 'denied', real Chrome 'default' ---
  try {
    const realPerm = Object.getOwnPropertyDescriptor(Notification, 'permission');
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: function () {
        let v = 'default';
        try { v = realPerm && realPerm.get ? realPerm.get.call(Notification) : Notification.permission; } catch (e) {}
        return v === 'denied' ? 'default' : v;
      },
    });
  } catch (e) {}

  // --- permissions.query: headless returns 'denied' for notifications ---
  try {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (desc) {
      return origQuery(desc).then(function (status) {
        if (desc && desc.name === 'notifications' && status.state === 'denied') {
          try { Object.defineProperty(status, 'state', { get: function () { return 'prompt'; } }); } catch (e) {}
        }
        return status;
      });
    };
  } catch (e) {}

  // --- Chromium API presence (creepjs likeHeadless: noContentIndex / noDownlinkMax) ---
  try {
    if (!('ContentIndex' in window)) {
      class ContentIndex {
        add() { return Promise.resolve(); }
        delete() { return Promise.resolve(); }
        getAll() { return Promise.resolve([]); }
        getDescriptions() { return Promise.resolve([]); }
      }
      Object.defineProperty(window, 'ContentIndex', { configurable: true, value: ContentIndex });
    }
  } catch (e) {}
  try {
    if (!('ContactsManager' in window)) {
      class ContactsManager {
        select() { return Promise.resolve([]); }
        getProperties() { return Promise.resolve({}); }
      }
      Object.defineProperty(window, 'ContactsManager', { configurable: true, value: ContactsManager });
    }
  } catch (e) {}
  try {
    const niProto = window.NetworkInformation && window.NetworkInformation.prototype;
    if (niProto && !('downlinkMax' in niProto)) {
      Object.defineProperty(niProto, 'downlinkMax', {
        configurable: true,
        get: function () { return 10; },
      });
    }
  } catch (e) {}
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
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'stealth.js'), buildStealthScript(opts));
  return dir;
}
