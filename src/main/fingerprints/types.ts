export type WindowsFamilyArch = 'x64' | 'arm64' | 'x86';

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

export type FontClass = 'win11-modern' | 'win10-legacy' | 'win11-arm';

export interface FingerprintCatalogFamily {
  id: string;
  displayName: string;
  weight: number;
  gpu: WindowsGpuSpec;
  cpu: WindowsCpuSpec;
  ramGB: number[];
  screen: WindowsScreenSpec;
  platformVersionRange: string[]; // e.g. ["10.0.19045", "10.0.22631", "10.0.26100"]
  fontsClass: FontClass;
  localePool: string[];
  coherenceConstraints: {
    mobile: false;
    platform: 'windows';
    platformArch: 'x86' | 'arm';
    bitness: '64' | '32';
    direct3dFeatureLevel?: string;
  };
  citation: {
    source: string; // e.g. "Steam Hardware Survey / StatCounter Windows Market Share"
    date: string;   // e.g. "2026-08"
    notes: string;
  };
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
