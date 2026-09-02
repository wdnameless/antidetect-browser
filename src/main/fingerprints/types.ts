export type WindowsFamilyArch = 'x64' | 'arm64' | 'x86';
export type CatalogPlatform = 'windows' | 'macos' | 'linux';
export type AppleChipFamily = 'M1' | 'M2' | 'M3' | 'M4' | 'Intel';

export interface WindowsGpuSpec {
  vendor: string;
  renderer: string;
  webgpuAdapter?: string;
  limitsClass: 'high-end' | 'mid-range' | 'integrated' | 'budget';
}

export interface WindowsCpuSpec {
  coresMin: number;
  coresMax: number;
  arch: WindowsFamilyArch;
}

export interface WindowsScreenSpec {
  resolutions: Array<{ width: number; height: number }>;
  dpr: number;
  colorDepth: number;
}

export interface AudioSignatureSpec {
  sampleRate: number;
  channelCount: number;
  oscillatorLatencyMs?: number;
  noiseOffset?: number;
  dynamicsCompressorParams?: {
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
  };
}

export interface ScreenProfileSpec {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  scaleFactor: number;
  isRetina: boolean;
}

export interface UaProfileSpec {
  userAgent: string;
  platformVersion: string;
  architecture: 'x86' | 'arm';
  bitness: '64' | '32';
  brands: Array<{ brand: string; version: string }>;
  fullVersionList?: Array<{ brand: string; version: string }>;
}

export interface MacHostTellPolicy {
  tell: string;
  strategy: 'mask' | 'exclude' | 'shim';
  rationale: string;
}

export type FontClass =
  | 'win11-modern'
  | 'win10-legacy'
  | 'win11-arm'
  | 'macos-modern'
  | 'macos-intel';

export interface FingerprintCatalogFamily {
  id: string;
  displayName: string;
  weight: number;
  gpu: WindowsGpuSpec;
  cpu: WindowsCpuSpec;
  ramGB: number[];
  screen: WindowsScreenSpec;
  platformVersionRange: string[]; // e.g. ["10.0.19045", "10.0.22631", "10.0.26100", "14.4.1", "15.2"]
  fontsClass: FontClass;
  localePool: string[];
  coherenceConstraints: {
    mobile: false;
    platform: CatalogPlatform;
    platformArch: 'x86' | 'arm';
    bitness: '64' | '32';
    direct3dFeatureLevel?: string;
    metalSupport?: boolean;
  };
  citation: {
    source: string; // e.g. "Steam Hardware Survey / Apple Developer Specs"
    date: string;   // e.g. "2026-08"
    notes: string;
  };

  // --- Extended fields (v2 migration) ---
  gpuRenderer?: string;
  audioSignature?: AudioSignatureSpec;
  fontInventory?: string[];
  screenProfile?: ScreenProfileSpec;
  scaleFactor?: number;

  // macOS specific metadata
  os?: CatalogPlatform;
  chip?: AppleChipFamily;
  uaProfile?: UaProfileSpec;
  hostTellsPolicy?: MacHostTellPolicy[];
}

export interface HardwareVector {
  familyId: string;
  displayName: string;
  cpuCores: number;
  ramGB: number;
  gpuVendor: string;
  gpuRenderer: string;
  webgpuAdapter?: string;
  screenResolution: { width: number; height: number };
  devicePixelRatio: number;
  colorDepth: number;
  platformVersion: string;
  architecture: string;
  bitness: string;
  fontClass: FontClass;
  locale: string;

  // Extended fields
  platform?: CatalogPlatform;
  navigatorPlatform?: string;
  chip?: AppleChipFamily;
  audioSignature?: AudioSignatureSpec;
  fontInventory?: string[];
  screenProfile?: ScreenProfileSpec;
  scaleFactor?: number;
  uaProfile?: UaProfileSpec;
}

export interface SubSeeds {
  canvas: number;
  webgl: number;
  audio: number;
  domrect: number;
  voices: number;
  devices: number;
  platform: number;
  screen: number;
}

export interface CoherenceViolation {
  fieldPair: [string, string];
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: CoherenceViolation[];
}
