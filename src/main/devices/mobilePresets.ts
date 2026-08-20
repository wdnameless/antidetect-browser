// Mobile device preset pool for the "Мобильный профиль v2" phase.
// Each profile with an Android device derives a deterministic "phone" from its
// fingerprint seed: one profile = one consistent device across restarts.
// Realistic models: Pixel 6-9, Samsung S22-S25, Xiaomi 13-15, OnePlus 11-13,
// Nothing, OPPO, realme, HONOR, vivo — Android 12-16, Adreno/Mali/Xclipse GPUs.

export interface MobilePreset {
  id: string;
  name: string;
  /** Model string as it appears in the User-Agent. */
  model: string;
  androidVersion: string;
  /** Build ID used in the User-Agent. */
  build: string;
  screen: { width: number; height: number; deviceScaleFactor: number };
  gpu: string;
  hardwareConcurrency: number;
}

export const MOBILE_PRESETS: MobilePreset[] = [
  { id: 'pixel_6', name: 'Pixel 6', model: 'Pixel 6', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 730', hardwareConcurrency: 8 },
  { id: 'pixel_6a', name: 'Pixel 6a', model: 'Pixel 6a', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Mali-G78', hardwareConcurrency: 8 },
  { id: 'pixel_7', name: 'Pixel 7', model: 'Pixel 7', androidVersion: '13', build: 'TQ3A.230805.001', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 730', hardwareConcurrency: 8 },
  { id: 'pixel_7a', name: 'Pixel 7a', model: 'Pixel 7a', androidVersion: '13', build: 'TQ3A.230805.001', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Mali-G78', hardwareConcurrency: 8 },
  { id: 'pixel_8', name: 'Pixel 8', model: 'Pixel 8', androidVersion: '14', build: 'AP1A.240505.005', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 740', hardwareConcurrency: 8 },
  { id: 'pixel_8a', name: 'Pixel 8a', model: 'Pixel 8a', androidVersion: '14', build: 'AP1A.240505.005', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Mali-G715', hardwareConcurrency: 8 },
  { id: 'pixel_9', name: 'Pixel 9', model: 'Pixel 9', androidVersion: '14', build: 'AP2A.240805.005', screen: { width: 412, height: 892, deviceScaleFactor: 2.625 }, gpu: 'Adreno 750', hardwareConcurrency: 8 },
  { id: 'pixel_9_pro', name: 'Pixel 9 Pro', model: 'Pixel 9 Pro', androidVersion: '14', build: 'AP2A.240805.005', screen: { width: 412, height: 892, deviceScaleFactor: 2.625 }, gpu: 'Adreno 750', hardwareConcurrency: 8 },
  { id: 's22', name: 'Galaxy S22', model: 'SM-S901B', androidVersion: '12', build: 'SP1A.210812.016', screen: { width: 421, height: 912, deviceScaleFactor: 2.625 }, gpu: 'Xclipse 920', hardwareConcurrency: 8 },
  { id: 's22_ultra', name: 'Galaxy S22 Ultra', model: 'SM-S908B', androidVersion: '12', build: 'SP1A.210812.016', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 730', hardwareConcurrency: 8 },
  { id: 's23', name: 'Galaxy S23', model: 'SM-S911B', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 421, height: 912, deviceScaleFactor: 2.625 }, gpu: 'Adreno 740', hardwareConcurrency: 8 },
  { id: 's23_ultra', name: 'Galaxy S23 Ultra', model: 'SM-S918B', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 740', hardwareConcurrency: 8 },
  { id: 's24', name: 'Galaxy S24', model: 'SM-S921B', androidVersion: '14', build: 'UP1A.231005.007', screen: { width: 421, height: 912, deviceScaleFactor: 2.625 }, gpu: 'Xclipse 940', hardwareConcurrency: 8 },
  { id: 's24_ultra', name: 'Galaxy S24 Ultra', model: 'SM-S928B', androidVersion: '14', build: 'UP1A.231005.007', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 750', hardwareConcurrency: 8 },
  { id: 's25', name: 'Galaxy S25', model: 'SM-S931B', androidVersion: '15', build: 'BP1A.250405.007', screen: { width: 421, height: 912, deviceScaleFactor: 2.625 }, gpu: 'Adreno 830', hardwareConcurrency: 8 },
  { id: 's25_ultra', name: 'Galaxy S25 Ultra', model: 'SM-S938B', androidVersion: '15', build: 'BP1A.250405.007', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 830', hardwareConcurrency: 8 },
  { id: 'xiaomi_13', name: 'Xiaomi 13', model: '2211133C', androidVersion: '13', build: 'TKQ1.220829.002', screen: { width: 393, height: 873, deviceScaleFactor: 2.75 }, gpu: 'Adreno 740', hardwareConcurrency: 8 },
  { id: 'xiaomi_14', name: 'Xiaomi 14', model: '23127PN0CC', androidVersion: '14', build: 'UKQ1.230917.001', screen: { width: 400, height: 890, deviceScaleFactor: 3 }, gpu: 'Adreno 750', hardwareConcurrency: 8 },
  { id: 'xiaomi_15', name: 'Xiaomi 15', model: '24129PN74C', androidVersion: '15', build: 'V816.0.2.0.UNCCNXM', screen: { width: 400, height: 890, deviceScaleFactor: 3 }, gpu: 'Adreno 830', hardwareConcurrency: 8 },
  { id: 'oneplus_11', name: 'OnePlus 11', model: 'PHB110', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 524, height: 1169, deviceScaleFactor: 2.75 }, gpu: 'Adreno 740', hardwareConcurrency: 8 },
  { id: 'oneplus_12', name: 'OnePlus 12', model: 'PJD110', androidVersion: '14', build: 'UP1A.231005.007', screen: { width: 524, height: 1169, deviceScaleFactor: 2.75 }, gpu: 'Adreno 750', hardwareConcurrency: 8 },
  { id: 'oneplus_13', name: 'OnePlus 13', model: 'PJZ110', androidVersion: '15', build: 'BP1A.250405.007', screen: { width: 480, height: 1060, deviceScaleFactor: 2.75 }, gpu: 'Adreno 830', hardwareConcurrency: 8 },
  { id: 'nothing_2', name: 'Nothing Phone (2)', model: 'A065', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 730', hardwareConcurrency: 8 },
  { id: 'nothing_2a', name: 'Nothing Phone (2a)', model: 'A142', androidVersion: '14', build: 'AP1A.240505.005', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Mali-G715', hardwareConcurrency: 8 },
  { id: 'oppo_find_x6', name: 'OPPO Find X6', model: 'PGFM10', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 740', hardwareConcurrency: 8 },
  { id: 'oppo_find_x7', name: 'OPPO Find X7', model: 'PHZ110', androidVersion: '14', build: 'UP1A.231005.007', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 750', hardwareConcurrency: 8 },
  { id: 'realme_gt5', name: 'realme GT5', model: 'RMX3888', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 740', hardwareConcurrency: 8 },
  { id: 'honor_magic_6', name: 'HONOR Magic6', model: 'BVL-AN00', androidVersion: '14', build: 'UP1A.231005.007', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Adreno 750', hardwareConcurrency: 8 },
  { id: 'vivo_x90', name: 'vivo X90', model: 'V2241A', androidVersion: '13', build: 'TP1A.220624.014', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Mali-G715', hardwareConcurrency: 8 },
  { id: 'vivo_x100', name: 'vivo X100', model: 'V2308A', androidVersion: '14', build: 'UP1A.231005.007', screen: { width: 412, height: 915, deviceScaleFactor: 2.625 }, gpu: 'Mali-G720', hardwareConcurrency: 8 },
];

/** Deterministic selection from the pool by fingerprint seed (one profile = one "phone"). */
export function pickMobilePreset(seed: number): MobilePreset {
  let h = seed >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) & 0xffff;
  return MOBILE_PRESETS[h % MOBILE_PRESETS.length];
}

/** Build a realistic mobile Chrome UA for a preset. */
export function buildMobileUa(p: MobilePreset): string {
  return `Mozilla/5.0 (Linux; Android ${p.androidVersion}; ${p.model} Build/${p.build}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36`;
}
