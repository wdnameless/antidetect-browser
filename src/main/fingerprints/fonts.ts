import type { StealthOptions } from '../proxy/stealthInjection';
import {
  WIN_MODERN_FONTS,
  WIN_ARM_FONTS,
  MAC_MODERN_FONTS,
  MAC_INTEL_FONTS,
} from './migration';
import { LINUX_FREETYPE_FONTS } from './linuxFamilies';
import { FORBIDDEN_FONTS_BY_PLATFORM } from './validator';
import { EXTENDED_FINGERPRINT_CATALOG } from './catalog';
import { selectFamilyBySeed } from './derivation';

export interface ResolvedFontConfig {
  inventory: string[];
  hiddenHostFonts: string[];
  fallbackFace: string;
}

/**
 * Maps logical platform to standard fallback font face.
 */
function getFallbackFace(platform: string): string {
  switch (platform) {
    case 'macos':
    case 'ios':
      return 'Helvetica';
    case 'linux':
    case 'android':
      return 'DejaVu Sans';
    case 'windows':
    default:
      return 'Arial';
  }
}

/**
 * Fallback font inventory per platform if family has no fontInventory.
 */
function getDefaultInventoryForPlatform(platform: string, arch?: string): string[] {
  switch (platform) {
    case 'macos':
      return arch === 'x86' || arch === 'x86_64' ? [...MAC_INTEL_FONTS] : [...MAC_MODERN_FONTS];
    case 'ios':
      return [
        'Arial', 'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue',
        'SF Pro', 'SF Pro Display', 'SF Pro Text', 'Times New Roman', 'Trebuchet MS', 'Verdana'
      ];
    case 'android':
      return [
        'Roboto', 'Droid Sans', 'Droid Serif', 'Noto Sans', 'Noto Serif', 'Roboto Mono'
      ];
    case 'linux':
      return [...LINUX_FREETYPE_FONTS];
    case 'windows':
    default:
      return arch === 'arm' || arch === 'arm64' ? [...WIN_ARM_FONTS] : [...WIN_MODERN_FONTS];
  }
}

/**
 * Determine hiddenHostFonts: fonts that the host platform has (or could have)
 * but are forbidden/incoherent on the target platform.
 *
 * Sourced from FORBIDDEN_FONTS_BY_PLATFORM in src/main/fingerprints/validator.ts,
 * plus cross-platform host font defaults.
 */
function getHiddenHostFonts(platform: string): string[] {
  const forbidden = FORBIDDEN_FONTS_BY_PLATFORM[platform] || [];
  const hidden = new Set<string>(forbidden);

  if (platform === 'macos' || platform === 'ios') {
    // Hidden on macOS/iOS: Windows host fonts
    for (const f of ['Segoe UI', 'Segoe UI Emoji', 'Segoe UI Variable', 'Segoe UI Symbol', 'Segoe UI Historic', 'Calibri', 'Cambria', 'Consolas', 'MS Gothic', 'Yu Gothic']) {
      hidden.add(f);
    }
  } else if (platform === 'windows') {
    // Hidden on Windows: Apple/macOS fonts
    for (const f of ['SF Pro', 'SF Pro Display', 'SF Pro Text', 'PingFang SC', 'PingFang TC', 'Menlo', 'Monaco', 'Lucida Grande', 'Geneva', 'Optima', 'Avenir', 'Avenir Next', 'Apple Color Emoji']) {
      hidden.add(f);
    }
  } else if (platform === 'linux' || platform === 'android') {
    // Hidden on Linux/Android: Segoe UI and SF Pro family
    for (const f of ['Segoe UI', 'Segoe UI Emoji', 'Segoe UI Variable', 'Calibri', 'Consolas', 'SF Pro', 'SF Pro Display', 'SF Pro Text', 'Menlo', 'PingFang SC']) {
      hidden.add(f);
    }
  }

  return Array.from(hidden);
}

/**
 * Resolves font inventory, hidden host fonts, and fallback font face based on StealthOptions.
 *
 * Contract:
 * resolveFontConfig(opts: StealthOptions): { inventory: string[]; hiddenHostFonts: string[]; fallbackFace: string }
 */
export function resolveFontConfig(opts: StealthOptions): ResolvedFontConfig {
  const platform = opts.logicalPlatform || 'windows';
  const fallbackFace = getFallbackFace(platform);

  let inventory: string[] = [];

  // 1. If explicit fontList is provided on opts, respect it
  if (Array.isArray(opts.fontList) && opts.fontList.length > 0) {
    inventory = [...opts.fontList];
  } else if (opts.seed) {
    // 2. Derive family from seed if possible
    try {
      const catalog = EXTENDED_FINGERPRINT_CATALOG.filter(
        (f) => f.coherenceConstraints.platform === platform || (!['windows', 'macos', 'linux'].includes(platform) && f.coherenceConstraints.mobile === opts.mobile)
      );
      const chosenCatalog = catalog.length > 0 ? catalog : EXTENDED_FINGERPRINT_CATALOG;
      const family = selectFamilyBySeed(opts.seed, chosenCatalog);
      if (family && family.fontInventory && family.fontInventory.length > 0) {
        inventory = [...family.fontInventory];
      }
    } catch {
      // Fallback
    }
  }

  // 3. Fallback per platform if still empty
  if (inventory.length === 0) {
    inventory = getDefaultInventoryForPlatform(platform, opts.architecture);
  }

  // Ensure unique list
  inventory = Array.from(new Set(inventory));

  // Determine hidden host fonts
  const hiddenHostFonts = getHiddenHostFonts(platform);

  return {
    inventory,
    hiddenHostFonts,
    fallbackFace,
  };
}
