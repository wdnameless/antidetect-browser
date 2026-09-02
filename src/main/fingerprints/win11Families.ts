import type { FingerprintCatalogFamily } from './types';
import {
  WIN_MODERN_FONTS,
  WIN_ARM_FONTS,
  AUDIO_SIGNATURE_WIN,
} from './migration';

/**
 * Windows 11 refresh families reflecting 2026 documented market distribution:
 * - NVIDIA RTX 4070 / RTX 4060 Ti modern gaming & workstation
 * - Intel Core Ultra (Meteor Lake / Arrow Lake) Arc Graphics
 * - AMD Radeon RX 7800 XT (RDNA3)
 * - Qualcomm Snapdragon X Elite (Adreno X1-85) ARM64 Copilot+ PC
 *
 * Grounded in Steam Hardware Survey (2026), Microsoft Surface specifications, and Qualcomm technical specs.
 * NO scraped personal telemetry.
 */
export const WINDOWS_11_REFRESH_FAMILIES: FingerprintCatalogFamily[] = [
  // 1. NVIDIA GeForce RTX 4070 (Desktop / Laptop)
  {
    id: 'win11-rtx-4070-mainstream',
    displayName: 'Desktop Gaming / NVIDIA GeForce RTX 4070 (Core i7-14700K / Ryzen 7 7800X3D)',
    weight: 0.28,
    gpu: {
      vendor: 'Google Inc. (NVIDIA)',
      renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      webgpuAdapter: 'NVIDIA GeForce RTX 4070',
      limitsClass: 'high-end',
    },
    gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    cpu: { coresMin: 8, coresMax: 20, arch: 'x64' },
    ramGB: [16, 32, 64],
    screen: {
      resolutions: [{ width: 2560, height: 1440 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }],
      dpr: 1.0,
      colorDepth: 24,
    },
    screenProfile: {
      width: 2560,
      height: 1440,
      availWidth: 2560,
      availHeight: 1400,
      colorDepth: 24,
      pixelDepth: 24,
      scaleFactor: 1.0,
      isRetina: false,
    },
    scaleFactor: 1.0,
    audioSignature: {
      ...AUDIO_SIGNATURE_WIN,
      sampleRate: 48000,
    },
    fontInventory: [...WIN_MODERN_FONTS],
    platformVersionRange: ['10.0.22631', '10.0.26100'],
    fontsClass: 'win11-modern',
    localePool: ['en-US', 'de-DE', 'en-GB', 'fr-FR', 'ja-JP', 'ru-RU', 'zh-CN'],
    coherenceConstraints: {
      mobile: false,
      platform: 'windows',
      platformArch: 'x86',
      bitness: '64',
      direct3dFeatureLevel: '12_2',
    },
    uaProfile: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      platformVersion: '15.0.0', // Win11 UA-CH platformVersion >= 15.0.0
      architecture: 'x86',
      bitness: '64',
      brands: [
        { brand: 'Chromium', version: '128' },
        { brand: 'Not;A=Brand', version: '24' },
        { brand: 'Google Chrome', version: '128' },
      ],
    },
    citation: {
      source: 'Steam Hardware Survey / TechPowerUp GPU Database',
      date: '2026-08',
      notes: 'Most popular 1440p mainstream gaming GPU on Windows 11 (AD104 Ada Lovelace architecture)',
    },
  },

  // 2. Intel Core Ultra 7 / Intel Arc Graphics (Meteor Lake)
  {
    id: 'win11-intel-arc-ultra7',
    displayName: 'Modern Ultrabook / Intel Core Ultra 7 155H / Intel Arc Graphics',
    weight: 0.26,
    gpu: {
      vendor: 'Google Inc. (Intel)',
      renderer: 'ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      webgpuAdapter: 'Intel(R) Arc(TM) Graphics',
      limitsClass: 'mid-range',
    },
    gpuRenderer: 'ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    cpu: { coresMin: 14, coresMax: 16, arch: 'x64' },
    ramGB: [16, 32],
    screen: {
      resolutions: [{ width: 1920, height: 1200 }, { width: 2880, height: 1800 }, { width: 1920, height: 1080 }],
      dpr: 1.25,
      colorDepth: 24,
    },
    screenProfile: {
      width: 1920,
      height: 1200,
      availWidth: 1920,
      availHeight: 1160,
      colorDepth: 24,
      pixelDepth: 24,
      scaleFactor: 1.25,
      isRetina: false,
    },
    scaleFactor: 1.25,
    audioSignature: {
      ...AUDIO_SIGNATURE_WIN,
      sampleRate: 48000,
    },
    fontInventory: [...WIN_MODERN_FONTS],
    platformVersionRange: ['10.0.22631', '10.0.26100'],
    fontsClass: 'win11-modern',
    localePool: ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'ja-JP'],
    coherenceConstraints: {
      mobile: false,
      platform: 'windows',
      platformArch: 'x86',
      bitness: '64',
      direct3dFeatureLevel: '12_1',
    },
    uaProfile: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      brands: [
        { brand: 'Chromium', version: '128' },
        { brand: 'Not;A=Brand', version: '24' },
        { brand: 'Google Chrome', version: '128' },
      ],
    },
    citation: {
      source: 'Intel Ark Product Specifications / Microsoft OEM hardware matrix',
      date: '2026-08',
      notes: 'Mainstream premium Windows 11 Evo/Copilot laptops with Intel Arc integrated Xe-LPG architecture',
    },
  },

  // 3. AMD Radeon RX 7800 XT (Desktop RDNA3)
  {
    id: 'win11-amd-radeon-7800xt',
    displayName: 'Desktop Enthusiast / AMD Radeon RX 7800 XT (Ryzen 7 7700X / 7800X3D)',
    weight: 0.24,
    gpu: {
      vendor: 'Google Inc. (AMD)',
      renderer: 'ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      webgpuAdapter: 'AMD Radeon RX 7800 XT',
      limitsClass: 'high-end',
    },
    gpuRenderer: 'ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    cpu: { coresMin: 8, coresMax: 16, arch: 'x64' },
    ramGB: [32, 64],
    screen: {
      resolutions: [{ width: 2560, height: 1440 }, { width: 3840, height: 2160 }],
      dpr: 1.0,
      colorDepth: 24,
    },
    screenProfile: {
      width: 2560,
      height: 1440,
      availWidth: 2560,
      availHeight: 1400,
      colorDepth: 24,
      pixelDepth: 24,
      scaleFactor: 1.0,
      isRetina: false,
    },
    scaleFactor: 1.0,
    audioSignature: {
      ...AUDIO_SIGNATURE_WIN,
      sampleRate: 48000,
    },
    fontInventory: [...WIN_MODERN_FONTS],
    platformVersionRange: ['10.0.22631', '10.0.26100'],
    fontsClass: 'win11-modern',
    localePool: ['en-US', 'de-DE', 'en-GB', 'pl-PL', 'sv-SE', 'fr-FR', 'pt-BR'],
    coherenceConstraints: {
      mobile: false,
      platform: 'windows',
      platformArch: 'x86',
      bitness: '64',
      direct3dFeatureLevel: '12_2',
    },
    uaProfile: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      brands: [
        { brand: 'Chromium', version: '128' },
        { brand: 'Not;A=Brand', version: '24' },
        { brand: 'Google Chrome', version: '128' },
      ],
    },
    citation: {
      source: 'Steam Hardware Survey / AMD Product Specs',
      date: '2026-08',
      notes: 'Enthusiast 1440p/4K Windows 11 desktop gaming configuration (Navi 32 RDNA3)',
    },
  },

  // 4. Qualcomm Snapdragon X Elite / Adreno X1-85 (ARM64 Windows 11 Copilot+ PC)
  {
    id: 'win11-snapdragon-x-elite',
    displayName: 'Copilot+ PC / Qualcomm Snapdragon X Elite (Adreno X1-85 GPU)',
    weight: 0.22,
    gpu: {
      vendor: 'Google Inc. (Qualcomm)',
      renderer: 'ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
      webgpuAdapter: 'Qualcomm(R) Adreno(TM) X1-85 GPU',
      limitsClass: 'integrated',
    },
    gpuRenderer: 'ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
    cpu: { coresMin: 12, coresMax: 12, arch: 'arm64' },
    ramGB: [16, 32],
    screen: {
      resolutions: [{ width: 2880, height: 1920 }, { width: 2304, height: 1536 }],
      dpr: 1.5,
      colorDepth: 24,
    },
    screenProfile: {
      width: 2880,
      height: 1920,
      availWidth: 2880,
      availHeight: 1872,
      colorDepth: 24,
      pixelDepth: 24,
      scaleFactor: 1.5,
      isRetina: false,
    },
    scaleFactor: 1.5,
    audioSignature: {
      ...AUDIO_SIGNATURE_WIN,
      sampleRate: 48000,
    },
    fontInventory: [...WIN_ARM_FONTS],
    platformVersionRange: ['10.0.26100'], // Windows 11 24H2 build
    fontsClass: 'win11-arm',
    localePool: ['en-US', 'en-GB', 'de-DE', 'ja-JP', 'fr-FR', 'es-ES'],
    coherenceConstraints: {
      mobile: false,
      platform: 'windows',
      platformArch: 'arm',
      bitness: '64',
      direct3dFeatureLevel: '12_1',
    },
    uaProfile: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      platformVersion: '15.0.0',
      architecture: 'arm',
      bitness: '64',
      brands: [
        { brand: 'Chromium', version: '128' },
        { brand: 'Not;A=Brand', version: '24' },
        { brand: 'Google Chrome', version: '128' },
      ],
    },
    citation: {
      source: 'Microsoft Surface Laptop 7th Edition Tech Specs / Qualcomm Snapdragon X Series Documentation',
      date: '2026-08',
      notes: 'New generation Windows on ARM Copilot+ PC (Oryon 12-core CPU + Adreno X1-85 GPU)',
    },
  },
];
