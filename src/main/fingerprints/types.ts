export type CatalogPlatform = 'windows' | 'macos' | 'linux';

export type MacChipFamily = 'M1' | 'M2' | 'M3' | 'M4' | 'Intel';

export type FontClass = 'win10-standard' | 'win11-modern' | 'macos-modern' | 'macos-intel' | 'linux-freetype';

export interface CoherenceConstraints {
  platform: CatalogPlatform;
  platformArch: 'x86' | 'arm';
  bitness: '64' | '32';
  mobile: false;
  direct3dFeatureLevel?: string;
}

export interface FamilyCitation {
  source: string;
  date: string;
  notes: string;
}

export interface AudioSignatureConstraints {
  sampleRate: number;
  channelCount: number;
  dynamicsCompressorThreshold?: number;
}

export interface FingerprintCatalogFamily {
  id: string;
  platform: CatalogPlatform;
  chip?: MacChipFamily;
  osVersion: string;
  browserVersion: string;
  coherenceConstraints: CoherenceConstraints;
  fontsClass: FontClass;
  fontInventory?: string[];
  localePool: string[];
  audioSignature?: AudioSignatureConstraints;
  gpu: {
    vendor: string;
    renderer: string;
  };
  gpuRenderer?: string;
  cpu: {
    arch: string;
    coresMin: number;
    coresMax: number;
  };
  screen: {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    devicePixelRatios: number[];
  };
  weight: number;
  citation: FamilyCitation;
}

export interface CoherenceViolation {
  fieldPair: [string, string];
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: CoherenceViolation[];
}
