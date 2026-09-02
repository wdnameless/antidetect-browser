import type {
  FingerprintCatalogFamily,
  AudioSignatureSpec,
  ScreenProfileSpec,
} from './types';
import { crc32 } from './derivation';

/**
 * Common font inventories based on public OS typography documentation.
 */
export const WIN_MODERN_FONTS = [
  'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New',
  'Georgia', 'Impact', 'Lucida Console', 'Microsoft Sans Serif', 'Segoe UI',
  'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol', 'Segoe UI Variable',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'MS Gothic', 'Yu Gothic'
];

export const WIN_ARM_FONTS = [
  'Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New',
  'Georgia', 'Microsoft Sans Serif', 'Segoe UI', 'Segoe UI Emoji',
  'Segoe UI Variable', 'Tahoma', 'Times New Roman', 'Verdana'
];

export const MAC_MODERN_FONTS = [
  'Arial', 'Arial Hebrew', 'Avenir', 'Avenir Next', 'Courier', 'Courier New',
  'Geneva', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Lucida Grande', 'Menlo',
  'Monaco', 'Noteworthy', 'Optima', 'Palatino', 'PingFang SC', 'PingFang TC',
  'SF Pro', 'SF Pro Display', 'SF Pro Text', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana'
];

export const MAC_INTEL_FONTS = [
  'Arial', 'Avenir', 'Courier New', 'Geneva', 'Georgia', 'Helvetica',
  'Helvetica Neue', 'Lucida Grande', 'Menlo', 'Monaco', 'Palatino',
  'PingFang SC', 'Times New Roman', 'Trebuchet MS', 'Verdana'
];

/**
 * Common standard Audio Signatures
 */
export const AUDIO_SIGNATURE_WIN: AudioSignatureSpec = {
  sampleRate: 48000,
  channelCount: 2,
  oscillatorLatencyMs: 10,
  noiseOffset: 0.00012,
  dynamicsCompressorParams: {
    threshold: -24,
    knee: 30,
    ratio: 12,
    attack: 0.003,
    release: 0.25,
  },
};

export const AUDIO_SIGNATURE_MAC: AudioSignatureSpec = {
  sampleRate: 44100,
  channelCount: 2,
  oscillatorLatencyMs: 8,
  noiseOffset: 0.00008,
  dynamicsCompressorParams: {
    threshold: -24,
    knee: 30,
    ratio: 12,
    attack: 0.003,
    release: 0.25,
  },
};

/**
 * Upgrades / migrates a catalog family record to ensure extended fields exist:
 * gpuRenderer, audioSignature, fontInventory, screenProfile, scaleFactor.
 * Preserves existing properties byte-stable.
 */
export function migrateFamilyRecord(family: FingerprintCatalogFamily): FingerprintCatalogFamily {
  const isMac = family.coherenceConstraints.platform === 'macos';
  const defaultRenderer = family.gpuRenderer || family.gpu.renderer;
  const defaultScaleFactor = family.scaleFactor ?? family.screen.dpr;

  const defaultAudio: AudioSignatureSpec =
    family.audioSignature || (isMac ? { ...AUDIO_SIGNATURE_MAC } : { ...AUDIO_SIGNATURE_WIN });

  let defaultFonts: string[] = family.fontInventory ? [...family.fontInventory] : [];
  if (defaultFonts.length === 0) {
    if (isMac) {
      defaultFonts = family.fontsClass === 'macos-intel' ? [...MAC_INTEL_FONTS] : [...MAC_MODERN_FONTS];
    } else {
      defaultFonts = family.fontsClass === 'win11-arm' ? [...WIN_ARM_FONTS] : [...WIN_MODERN_FONTS];
    }
  }

  const primaryRes = family.screen.resolutions[0] || { width: 1920, height: 1080 };
  const defaultScreenProfile: ScreenProfileSpec = family.screenProfile || {
    width: primaryRes.width,
    height: primaryRes.height,
    availWidth: primaryRes.width,
    availHeight: isMac ? primaryRes.height - 25 : primaryRes.height - 40,
    colorDepth: family.screen.colorDepth,
    pixelDepth: family.screen.colorDepth,
    scaleFactor: defaultScaleFactor,
    isRetina: isMac && defaultScaleFactor >= 2,
  };

  return {
    ...family,
    gpuRenderer: defaultRenderer,
    audioSignature: defaultAudio,
    fontInventory: defaultFonts,
    screenProfile: defaultScreenProfile,
    scaleFactor: defaultScaleFactor,
  };
}

/**
 * Migration versioning using CRC32 checksum over the canonical JSON representation.
 */
export function computeCatalogChecksum(families: FingerprintCatalogFamily[]): string {
  // Sort by ID to ensure order independence
  const canonicalList = [...families].sort((a, b) => a.id.localeCompare(b.id));
  const raw = JSON.stringify(canonicalList);
  return crc32(raw).toString(16).padStart(8, '0');
}

export function serializeFamilyWithCrc32(family: FingerprintCatalogFamily): {
  data: FingerprintCatalogFamily;
  crc32: number;
} {
  const migrated = migrateFamilyRecord(family);
  const raw = JSON.stringify(migrated);
  const checksum = crc32(raw);
  return {
    data: migrated,
    crc32: checksum,
  };
}

export function deserializeFamilyWithCrc32(payload: {
  data: FingerprintCatalogFamily;
  crc32: number;
}): FingerprintCatalogFamily {
  const raw = JSON.stringify(payload.data);
  const checksum = crc32(raw);
  if (checksum !== payload.crc32) {
    throw new Error(`CRC32 mismatch on family ${payload.data.id}: expected ${payload.crc32}, got ${checksum}`);
  }
  return payload.data;
}
