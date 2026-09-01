import * as crypto from 'crypto';

export interface SubSeeds {
  canvas: number;
  webgl: number;
  audio: number;
  rects: number;
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

  // Fallback macOS / mobile voice pool
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
