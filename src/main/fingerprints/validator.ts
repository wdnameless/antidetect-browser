import {
  FingerprintCatalogFamily,
  ValidationResult,
  CoherenceViolation,
} from './types';

/**
 * Known WebGL vendor prefixes and keywords.
 */
const APPLE_GPU_REGEX = /Apple\s+(M\d+|A\d+)/i;
const NVIDIA_GPU_REGEX = /NVIDIA|GeForce|RTX|GTX|Quadro/i;
const AMD_GPU_REGEX = /AMD|Radeon/i;
const INTEL_GPU_REGEX = /Intel|Iris|UHD|HD Graphics/i;

/**
 * Cross-property coherence validator covering UA, UA-CH, platform, WebGL, screen, fonts, and audio.
 * CI-executable, rejects planted incoherence with named field pairs.
 */
export function validateFamilyCoherence(family: FingerprintCatalogFamily): ValidationResult {
  const violations: CoherenceViolation[] = [];

  const addViolation = (fieldPair: [string, string], message: string) => {
    violations.push({ fieldPair, message });
  };

  const { platform, platformArch } = family.coherenceConstraints;
  const renderer = family.gpuRenderer || family.gpu.renderer;
  const vendor = family.gpu.vendor;

  // 1. WebGL Renderer <-> Platform
  if (platform === 'macos') {
    if (APPLE_GPU_REGEX.test(renderer)) {
      if (platformArch !== 'arm' || family.cpu.arch !== 'arm64') {
        addViolation(
          ['gpuRenderer', 'platformArch'],
          `Apple Silicon GPU '${renderer}' requires arm64/arm platformArch, found cpu.arch='${family.cpu.arch}' and platformArch='${platformArch}'`
        );
      }
    } else if (INTEL_GPU_REGEX.test(renderer) || AMD_GPU_REGEX.test(renderer)) {
      if (platformArch !== 'x86' || family.cpu.arch !== 'x64') {
        addViolation(
          ['gpuRenderer', 'platformArch'],
          `Intel/AMD macOS GPU '${renderer}' requires x64/x86 platformArch, found cpu.arch='${family.cpu.arch}' and platformArch='${platformArch}'`
        );
      }
    } else {
      addViolation(
        ['gpuRenderer', 'platform'],
        `Unexpected macOS GPU renderer '${renderer}'. Must be Apple M-series or Intel/AMD Mac spec.`
      );
    }

    if (NVIDIA_GPU_REGEX.test(renderer)) {
      addViolation(
        ['gpuRenderer', 'platform'],
        `NVIDIA GPU '${renderer}' is not coherent on modern macOS (no macOS drivers for RTX/GTX).`
      );
    }
  } else if (platform === 'windows') {
    if (APPLE_GPU_REGEX.test(renderer)) {
      addViolation(
        ['gpuRenderer', 'platform'],
        `Apple Silicon GPU '${renderer}' cannot run on Windows platform.`
      );
    }
    if (family.chip && family.chip.startsWith('M')) {
      addViolation(
        ['chip', 'platform'],
        `Apple chip '${family.chip}' cannot be paired with Windows platform.`
      );
    }
  }

  // 2. UA & UA-CH coherence
  if (family.uaProfile) {
    const { userAgent, platformVersion: chPlatformVersion, architecture: chArch, bitness: chBitness } = family.uaProfile;

    if (platform === 'macos') {
      if (!userAgent.includes('Macintosh') || !userAgent.includes('Mac OS X')) {
        addViolation(
          ['uaProfile.userAgent', 'platform'],
          `macOS family userAgent must contain 'Macintosh; Intel Mac OS X' (Chromium standard format even on ARM), found '${userAgent}'`
        );
      }
      if (chArch && chArch !== 'arm' && chArch !== 'x86') {
        addViolation(
          ['uaProfile.architecture', 'platformArch'],
          `Invalid UA-CH architecture '${chArch}' for macOS family.`
        );
      }
      if (chArch && chArch !== platformArch) {
        addViolation(
          ['uaProfile.architecture', 'platformArch'],
          `UA-CH architecture '${chArch}' does not match platformArch '${platformArch}'`
        );
      }
    } else if (platform === 'windows') {
      if (!userAgent.includes('Windows NT')) {
        addViolation(
          ['uaProfile.userAgent', 'platform'],
          `Windows family userAgent must contain 'Windows NT', found '${userAgent}'`
        );
      }
      if (chArch && chArch !== platformArch) {
        addViolation(
          ['uaProfile.architecture', 'platformArch'],
          `UA-CH architecture '${chArch}' does not match platformArch '${platformArch}'`
        );
      }
    }

    if (chBitness && chBitness !== family.coherenceConstraints.bitness) {
      addViolation(
        ['uaProfile.bitness', 'coherenceConstraints.bitness'],
        `UA-CH bitness '${chBitness}' does not match constraint bitness '${family.coherenceConstraints.bitness}'`
      );
    }
  }

  // 3. Screen & Scale factor
  const dpr = family.scaleFactor ?? family.screen.dpr;
  if (family.scaleFactor !== undefined && family.scaleFactor !== family.screen.dpr) {
    addViolation(
      ['scaleFactor', 'screen.dpr'],
      `scaleFactor (${family.scaleFactor}) must equal screen.dpr (${family.screen.dpr})`
    );
  }

  if (family.screenProfile) {
    const sp = family.screenProfile;
    if (sp.scaleFactor !== dpr) {
      addViolation(
        ['screenProfile.scaleFactor', 'screen.dpr'],
        `screenProfile.scaleFactor (${sp.scaleFactor}) does not match dpr (${dpr})`
      );
    }
    if (platform === 'macos' && sp.isRetina && dpr < 2) {
      addViolation(
        ['screenProfile.isRetina', 'screen.dpr'],
        `Retina screenProfile requires scaleFactor >= 2, found ${dpr}`
      );
    }
  }

  // 4. Fonts coherence
  const fonts = family.fontInventory ?? [];
  if (platform === 'macos') {
    if (family.fontsClass !== 'macos-modern' && family.fontsClass !== 'macos-intel') {
      addViolation(
        ['fontsClass', 'platform'],
        `macOS family must use 'macos-modern' or 'macos-intel' font class, found '${family.fontsClass}'`
      );
    }
    // Windows system fonts must NOT be in macOS inventory
    const forbiddenWinFonts = ['Segoe UI', 'Calibri', 'Consolas', 'MS Gothic', 'Tahoma'];
    for (const wf of forbiddenWinFonts) {
      if (fonts.includes(wf)) {
        addViolation(
          ['fontInventory', 'platform'],
          `Windows system font '${wf}' must not be in macOS font inventory.`
        );
      }
    }
    // macOS required fonts
    if (fonts.length > 0) {
      const macCoreFonts = ['SF Pro', 'Helvetica Neue', 'Menlo', 'Monaco', 'PingFang SC'];
      const hasMacFont = macCoreFonts.some(f => fonts.includes(f));
      if (!hasMacFont) {
        addViolation(
          ['fontInventory', 'platform'],
          `macOS font inventory missing standard macOS typography (e.g. Menlo, Helvetica Neue, Monaco).`
        );
      }
    }
  } else if (platform === 'windows') {
    if (family.fontsClass.startsWith('macos-')) {
      addViolation(
        ['fontsClass', 'platform'],
        `Windows family cannot have macOS font class '${family.fontsClass}'`
      );
    }
    // Apple-only fonts must NOT be in Windows inventory
    const forbiddenMacFonts = ['SF Pro', 'SF Pro Text', 'Menlo', 'Monaco', 'PingFang SC', 'Apple Color Emoji'];
    for (const mf of forbiddenMacFonts) {
      if (fonts.includes(mf)) {
        addViolation(
          ['fontInventory', 'platform'],
          `Apple font '${mf}' must not be in Windows font inventory.`
        );
      }
    }
  }

  // 5. Audio signature coherence
  if (family.audioSignature) {
    const audio = family.audioSignature;
    if (audio.channelCount !== 2 && audio.channelCount !== 6) {
      addViolation(
        ['audioSignature.channelCount', 'platform'],
        `Invalid audio channelCount ${audio.channelCount}, expected 2 or 6`
      );
    }
    if (platform === 'macos' && audio.sampleRate !== 44100 && audio.sampleRate !== 48000) {
      addViolation(
        ['audioSignature.sampleRate', 'platform'],
        `macOS standard sampleRate is 44100 or 48000 Hz, found ${audio.sampleRate}`
      );
    }
  }

  // 6. CPU & Memory limits
  if (family.chip && platform === 'macos') {
    // Apple Silicon core sanity
    if (family.chip === 'M1' && (family.cpu.coresMin < 8 || family.cpu.coresMax > 8)) {
      addViolation(['cpu.coresMin', 'chip'], `Apple M1 standard is 8 cores, found ${family.cpu.coresMin}-${family.cpu.coresMax}`);
    }
    if (family.chip === 'M2' && (family.cpu.coresMin < 8 || family.cpu.coresMax > 8)) {
      addViolation(['cpu.coresMin', 'chip'], `Apple M2 standard is 8 cores, found ${family.cpu.coresMin}-${family.cpu.coresMax}`);
    }
    if (family.chip === 'M3' && (family.cpu.coresMin < 8 || family.cpu.coresMax > 8)) {
      addViolation(['cpu.coresMin', 'chip'], `Apple M3 standard is 8 cores, found ${family.cpu.coresMin}-${family.cpu.coresMax}`);
    }
    if (family.chip === 'M4' && (family.cpu.coresMin < 10 || family.cpu.coresMax > 10)) {
      addViolation(['cpu.coresMin', 'chip'], `Apple M4 standard is 10 cores, found ${family.cpu.coresMin}-${family.cpu.coresMax}`);
    }
  }

  // 7. Provenance / Citation Check
  if (!family.citation || !family.citation.source || !family.citation.date || !family.citation.notes) {
    addViolation(
      ['citation', 'id'],
      `Family '${family.id}' missing required citation fields (source, date, notes).`
    );
  } else {
    // Provenance must NOT reference harvested or scraped personal telemetry
    const forbiddenCitationTerms = ['telemetry-harvested', 'scraped-user-data', 'creepjs-live-scrape', 'botnet-dump'];
    for (const term of forbiddenCitationTerms) {
      if (family.citation.source.toLowerCase().includes(term) || family.citation.notes.toLowerCase().includes(term)) {
        addViolation(
          ['citation.source', 'citation.notes'],
          `Provenance source forbids harvested/scraped telemetry: found '${term}'`
        );
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Validate an entire catalog of families.
 * Returns map of family ID to violations, and overall pass/fail boolean.
 */
export function validateCatalogCoherence(catalog: FingerprintCatalogFamily[]): {
  valid: boolean;
  familyCount: number;
  results: Record<string, ValidationResult>;
} {
  const results: Record<string, ValidationResult> = {};
  let valid = true;

  for (const family of catalog) {
    const res = validateFamilyCoherence(family);
    results[family.id] = res;
    if (!res.valid) {
      valid = false;
    }
  }

  return {
    valid,
    familyCount: catalog.length,
    results,
  };
}

export interface CatalogValidationReport {
  valid: boolean;
  totalFamilies: number;
  violationsCount: number;
  incoherentFamilyIds: string[];
  details: Record<string, CoherenceViolation[]>;
}

export function validateAllFamilies(catalog: FingerprintCatalogFamily[]): CatalogValidationReport {
  const res = validateCatalogCoherence(catalog);
  const incoherentIds = Object.entries(res.results)
    .filter(([_, r]) => !r.valid)
    .map(([id]) => id);
  const totalViolations = Object.values(res.results).reduce((acc, r) => acc + r.violations.length, 0);
  const details: Record<string, CoherenceViolation[]> = {};
  for (const [id, r] of Object.entries(res.results)) {
    if (!r.valid) {
      details[id] = r.violations;
    }
  }
  return {
    valid: res.valid,
    totalFamilies: catalog.length,
    violationsCount: totalViolations,
    incoherentFamilyIds: incoherentIds,
    details,
  };
}

export interface HostTellDefinition {
  id: string;
  name: string;
  mitigation: 'mask' | 'exclude';
  rationale: string;
}

export const MACOS_WINDOWS_HOST_TELLS: HostTellDefinition[] = [
  {
    id: 'tell-coretext-subpixel-rendering',
    name: 'CoreText Font Subpixel & Antialiasing Difference',
    mitigation: 'mask',
    rationale: 'Mac subpixel anti-aliasing differs from DirectWrite ClearType; masked via Canvas/DOMRect seeded noise injection.',
  },
  {
    id: 'tell-speech-synthesis-voices',
    name: 'Windows SAPI Voices Leaking on macOS Profile',
    mitigation: 'exclude',
    rationale: 'Exclude all Microsoft/David/Zira voices and synthesize authentic macOS VoiceList (Samantha, Karen, Daniel, etc.).',
  },
  {
    id: 'tell-webgl-angle-direct3d-leak',
    name: 'Direct3D / DirectX Strings in WebGL Renderer',
    mitigation: 'mask',
    rationale: 'Native ANGLE on macOS runs Metal; rewrite UNMASKED_RENDERER_WEBGL to Metal ANGLE format without D3D artifacts.',
  },
  {
    id: 'tell-mediadevices-driver-naming',
    name: 'Windows Audio Driver Device Labels (Realtek/High Definition Audio)',
    mitigation: 'exclude',
    rationale: 'Exclude Windows audio endpoint strings and substitute standard CoreAudio device names (Built-in Microphone / Output).',
  },
  {
    id: 'tell-platform-and-oscpu-inconsistency',
    name: 'navigator.platform and navigator.oscpu mismatch',
    mitigation: 'mask',
    rationale: 'Enforce navigator.platform as MacIntel and strip navigator.oscpu to match authentic modern Chromium on macOS.',
  },
  {
    id: 'tell-keyboard-shortcut-modifier-keys',
    name: 'KeyboardEvent Modifier Tells (Meta vs Control)',
    mitigation: 'mask',
    rationale: 'Map modifier states so Command key behaves as primary accelerator while running on Windows host.',
  },
];
