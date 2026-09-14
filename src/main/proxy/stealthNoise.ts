import * as crypto from 'crypto';

export interface SubSeeds {
  canvas: number;
  webgl: number;
  audio: number;
  rects: number;
}

export interface SensorProfile {
  gravity: { x: number; y: number; z: number };
  jitterAmplitude: number;
  orientation: {
    type: 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';
    angle: number;
  };
  rotationCapability: boolean;
}

/**
 * Derive deterministic 32-bit unsigned integer sub-seeds from a master profile seed
 * and surface domain tags using SHA-256.
 */
export function deriveSubSeeds(masterSeed: number = 12345): SubSeeds {
  const surfaces = ['canvas', 'webgl', 'audio', 'rects'] as const;
  const result: Record<string, number> = {};

  for (const surface of surfaces) {
    const hash = crypto
      .createHash('sha256')
      .update(`${masterSeed}:seed_${surface}`)
      .digest();
    result[surface] = hash.readUInt32LE(0);
  }

  return result as unknown as SubSeeds;
}

export interface SyntheticVoice {
  default: boolean;
  lang: string;
  localService: boolean;
  name: string;
  voiceURI: string;
}

/**
 * Get realistic SpeechSynthesis voice pool coherent with operating system and locale.
 */
export function getSyntheticVoicePool(
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios' = 'windows',
  locale: string = 'en-US'
): SyntheticVoice[] {
  const normalizedLocale = locale.toLowerCase();

  if (platform === 'windows') {
    const voices: SyntheticVoice[] = [];

    // Locale-specific Windows voice
    if (normalizedLocale.startsWith('ru')) {
      voices.push(
        {
          default: true,
          lang: 'ru-RU',
          localService: true,
          name: 'Microsoft Irina - Russian (Russia)',
          voiceURI: 'Microsoft Irina - Russian (Russia)',
        },
        {
          default: false,
          lang: 'ru-RU',
          localService: false,
          name: 'Google русский',
          voiceURI: 'Google русский',
        }
      );
    } else if (normalizedLocale.startsWith('de')) {
      voices.push(
        {
          default: true,
          lang: 'de-DE',
          localService: true,
          name: 'Microsoft Hedda - German (Germany)',
          voiceURI: 'Microsoft Hedda - German (Germany)',
        },
        {
          default: false,
          lang: 'de-DE',
          localService: false,
          name: 'Google Deutsch',
          voiceURI: 'Google Deutsch',
        }
      );
    } else if (normalizedLocale.startsWith('fr')) {
      voices.push(
        {
          default: true,
          lang: 'fr-FR',
          localService: true,
          name: 'Microsoft Hortense - French (France)',
          voiceURI: 'Microsoft Hortense - French (France)',
        },
        {
          default: false,
          lang: 'fr-FR',
          localService: false,
          name: 'Google français',
          voiceURI: 'Google français',
        }
      );
    } else if (normalizedLocale.startsWith('es')) {
      voices.push(
        {
          default: true,
          lang: 'es-ES',
          localService: true,
          name: 'Microsoft Helena - Spanish (Spain)',
          voiceURI: 'Microsoft Helena - Spanish (Spain)',
        },
        {
          default: false,
          lang: 'es-ES',
          localService: false,
          name: 'Google español',
          voiceURI: 'Google español',
        }
      );
    }

    // Standard Windows English voices
    const isEnDefault = voices.length === 0;
    voices.push(
      {
        default: isEnDefault,
        lang: 'en-US',
        localService: true,
        name: 'Microsoft David - English (United States)',
        voiceURI: 'Microsoft David - English (United States)',
      },
      {
        default: false,
        lang: 'en-US',
        localService: true,
        name: 'Microsoft Zira - English (United States)',
        voiceURI: 'Microsoft Zira - English (United States)',
      },
      {
        default: false,
        lang: 'en-US',
        localService: true,
        name: 'Microsoft Mark - English (United States)',
        voiceURI: 'Microsoft Mark - English (United States)',
      },
      {
        default: false,
        lang: 'en-US',
        localService: false,
        name: 'Google US English',
        voiceURI: 'Google US English',
      }
    );

    return voices;
  }

  if (platform === 'macos') {
    const voices: SyntheticVoice[] = [];
    if (normalizedLocale.startsWith('ru')) {
      voices.push(
        {
          default: true,
          lang: 'ru-RU',
          localService: true,
          name: 'Milena',
          voiceURI: 'Milena',
        },
        {
          default: false,
          lang: 'ru-RU',
          localService: true,
          name: 'Yuri',
          voiceURI: 'Yuri',
        }
      );
    } else if (normalizedLocale.startsWith('de')) {
      voices.push(
        {
          default: true,
          lang: 'de-DE',
          localService: true,
          name: 'Anna',
          voiceURI: 'Anna',
        },
        {
          default: false,
          lang: 'de-DE',
          localService: true,
          name: 'Markus',
          voiceURI: 'Markus',
        }
      );
    } else if (normalizedLocale.startsWith('fr')) {
      voices.push(
        {
          default: true,
          lang: 'fr-FR',
          localService: true,
          name: 'Thomas',
          voiceURI: 'Thomas',
        },
        {
          default: false,
          lang: 'fr-FR',
          localService: true,
          name: 'Amelie',
          voiceURI: 'Amelie',
        }
      );
    } else if (normalizedLocale.startsWith('es')) {
      voices.push(
        {
          default: true,
          lang: 'es-ES',
          localService: true,
          name: 'Monica',
          voiceURI: 'Monica',
        },
        {
          default: false,
          lang: 'es-ES',
          localService: true,
          name: 'Jorge',
          voiceURI: 'Jorge',
        }
      );
    }

    const isEnDefault = voices.length === 0;
    voices.push(
      {
        default: isEnDefault,
        lang: 'en-US',
        localService: true,
        name: 'Samantha',
        voiceURI: 'Samantha',
      },
      {
        default: false,
        lang: 'en-US',
        localService: true,
        name: 'Alex',
        voiceURI: 'Alex',
      },
      {
        default: false,
        lang: 'en-US',
        localService: true,
        name: 'Fred',
        voiceURI: 'Fred',
      },
      {
        default: false,
        lang: 'en-US',
        localService: true,
        name: 'Victoria',
        voiceURI: 'Victoria',
      },
      {
        default: false,
        lang: 'en-US',
        localService: false,
        name: 'Google US English',
        voiceURI: 'Google US English',
      }
    );
    return voices;
  }

  // Fallback mobile / linux voice pool
  return [
    {
      default: true,
      lang: 'en-US',
      localService: true,
      name: 'Samantha',
      voiceURI: 'Samantha',
    },
    {
      default: false,
      lang: 'en-US',
      localService: false,
      name: 'Google US English',
      voiceURI: 'Google US English',
    },
  ];
}

export interface SyntheticMediaDevice {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  groupId: string;
}

/**
 * Generate synthetic MediaDeviceInfo objects deterministically from seed.
 */
export function getSyntheticMediaDevices(
  masterSeed: number = 12345,
  mobile: boolean = false
): SyntheticMediaDevice[] {
  const hash = (tag: string) =>
    crypto
      .createHash('sha256')
      .update(`${masterSeed}:${tag}`)
      .digest('hex');

  const groupAudio = hash('group_audio');
  const groupVideo = hash('group_video');

  const devices: SyntheticMediaDevice[] = [
    {
      deviceId: hash('dev_audio_in'),
      kind: 'audioinput',
      label: '',
      groupId: groupAudio,
    },
    {
      deviceId: hash('dev_audio_out'),
      kind: 'audiooutput',
      label: '',
      groupId: groupAudio,
    },
    {
      deviceId: hash('dev_video_in_0'),
      kind: 'videoinput',
      label: '',
      groupId: groupVideo,
    },
  ];

  if (mobile) {
    devices.push({
      deviceId: hash('dev_video_in_1'),
      kind: 'videoinput',
      label: '',
      groupId: groupVideo,
    });
  }

  return devices;
}

/**
 * Returns default font inventory pool for a logical platform.
 */
export function getPlatformFontPool(platform: string): string[] {
  switch (platform) {
    case 'macos':
    case 'ios':
      return [
        'Arial', 'Arial Hebrew', 'Avenir', 'Avenir Next', 'Courier', 'Courier New',
        'Geneva', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Lucida Grande', 'Menlo',
        'Monaco', 'Noteworthy', 'Optima', 'Palatino', 'PingFang SC', 'PingFang TC',
        'SF Pro', 'SF Pro Display', 'SF Pro Text', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana'
      ];
    case 'linux':
    case 'android':
      return [
        'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans',
        'Liberation Serif', 'Liberation Mono', 'Roboto', 'Noto Sans'
      ];
    case 'windows':
    default:
      return [
        'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New',
        'Georgia', 'Impact', 'Lucida Console', 'Microsoft Sans Serif', 'Segoe UI',
        'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol', 'Segoe UI Variable',
        'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'
      ];
  }
}

/**
 * Resolve sensor configuration deterministically from profile seed.
 * Returns null for non-mobile profiles.
 */
export function resolveSensorConfig(opts: {
  mobile?: boolean;
  seed?: number;
  logicalPlatform?: string;
}): SensorProfile | null {
  if (!opts || !opts.mobile) {
    return null;
  }

  const masterSeed = opts.seed ?? 12345;
  const hash = (tag: string) =>
    crypto
      .createHash('sha256')
      .update(`${masterSeed}:${tag}`)
      .digest();

  const jitterBuf = hash('sensor_jitter');
  // Handheld jitter amplitude in range [0.02, 0.08] m/s^2
  const jitterAmplitude = 0.02 + (jitterBuf.readUInt32LE(0) % 600) / 10000;

  const orientBuf = hash('sensor_orientation');
  const orientPick = orientBuf.readUInt8(0) % 2; // Default mobile orientation is usually portrait-primary (0 deg) or occasionally landscape-primary (90 deg)
  const isPortrait = orientPick === 0;

  const orientation = isPortrait
    ? { type: 'portrait-primary' as const, angle: 0 }
    : { type: 'landscape-primary' as const, angle: 90 };

  // Gravity: on flat surface or slightly tilted handheld.
  // Standard gravity is 9.80665 m/s^2.
  // Slight tilt derived deterministically:
  const gravBuf = hash('sensor_gravity');
  const tiltX = ((gravBuf.readInt16LE(0) % 100) / 1000); // [-0.1, 0.1]
  const tiltY = ((gravBuf.readInt16LE(2) % 100) / 1000); // [-0.1, 0.1]
  const gz = isPortrait ? 9.8 : 9.8;
  const gx = isPortrait ? tiltX : 9.8;
  const gy = isPortrait ? (tiltY + (opts.logicalPlatform === 'ios' ? 0.2 : 0.1)) : tiltY;

  return {
    gravity: { x: Number(tiltX.toFixed(4)), y: Number(gy.toFixed(4)), z: Number(gz.toFixed(4)) },
    jitterAmplitude: Number(jitterAmplitude.toFixed(4)),
    orientation,
    rotationCapability: true,
  };
}
