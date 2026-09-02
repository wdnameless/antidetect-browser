import { describe, it, expect } from 'vitest';
import { ChromiumBaselineService, ChromiumFingerprintConfig } from '../../src/main/services/chromium-baseline-service';

describe('Chromium Baseline Fingerprint Features (establish-parity 4.2)', () => {
  const service = new ChromiumBaselineService();

  it('generates launch arguments for platform, brand, hardware concurrency, timezone, and language', () => {
    const config = {
      id: 'prof-fp-flags',
      name: 'Fingerprint Flags Profile',
      engine: 'chromium' as const,
      userDataDir: 'D:/tmp/test-fp-flags',
      fingerprint: {
        seed: 987654,
        platform: 'windows' as const,
        platformVersion: '10.0.0',
        brand: 'Google Chrome',
        brandVersion: '148.0.7778.215',
        hardwareConcurrency: 16,
        timezone: 'America/New_York',
        lang: 'en-US,en;q=0.9',
      },
    };

    const args = service.generateLaunchArgs(config);

    expect(args).toContain('--fingerprint=987654');
    expect(args).toContain('--fingerprint-platform=windows');
    expect(args).toContain('--fingerprint-platform-version=10.0.0');
    expect(args).toContain('--fingerprint-brand=Google Chrome');
    expect(args).toContain('--fingerprint-brand-version=148.0.7778.215');
    expect(args).toContain('--fingerprint-hardware-concurrency=16');
    expect(args).toContain('--timezone=America/New_York');
    expect(args).toContain('--lang=en-US,en;q=0.9');
    expect(args).toContain('--accept-lang=en-US,en;q=0.9');
  });

  it('configures WebRTC leak prevention modes correctly in launch flags', () => {
    // Mode: disabled
    const disabledArgs = service.generateLaunchArgs({
      id: 'prof-webrtc-dis',
      name: 'WebRTC Disabled',
      engine: 'chromium',
      userDataDir: 'D:/tmp/webrtc-dis',
      fingerprint: {
        seed: 123,
        webrtcMode: 'disabled',
      },
    });
    expect(disabledArgs).toContain('--disable-webrtc');
    expect(disabledArgs).toContain('--webrtc-ip-handling-policy=disable_non_proxied_udp');

    // Mode: public_only
    const publicArgs = service.generateLaunchArgs({
      id: 'prof-webrtc-pub',
      name: 'WebRTC Public Only',
      engine: 'chromium',
      userDataDir: 'D:/tmp/webrtc-pub',
      fingerprint: {
        seed: 123,
        webrtcMode: 'public_only',
      },
    });
    expect(publicArgs).toContain('--webrtc-ip-handling-policy=default_public_interface_only');
    expect(publicArgs).not.toContain('--disable-webrtc');

    // Mode: fake
    const fakeArgs = service.generateLaunchArgs({
      id: 'prof-webrtc-fake',
      name: 'WebRTC Fake Devices',
      engine: 'chromium',
      userDataDir: 'D:/tmp/webrtc-fake',
      fingerprint: {
        seed: 123,
        webrtcMode: 'fake',
      },
    });
    expect(fakeArgs).toContain('--use-fake-device-for-media-stream');
    expect(fakeArgs).toContain('--use-fake-ui-for-media-stream');
  });

  it('generates stealth script with Client Hints parity matching Chrome 148', () => {
    const fpConfig: ChromiumFingerprintConfig = {
      seed: 4567,
      hardwareConcurrency: 12,
      deviceMemory: 16,
      maxTouchPoints: 0,
      clientHints: {
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        mobile: false,
      },
    };

    const script = service.generateFingerprintScript(fpConfig);

    expect(script).toContain('navigator.userAgentData');
    expect(script).toContain('Google Chrome');
    expect(script).toContain('getHighEntropyValues');
    expect(script).toContain('HARDWARE_CONCURRENCY = 12');
    expect(script).toContain('DEVICE_MEMORY = 16');
  });

  it('includes Canvas noise injection and WebGL vendor spoofing in stealth script', () => {
    const fpConfig: ChromiumFingerprintConfig = {
      seed: 8888,
      canvasNoise: true,
      webglNoise: true,
      audioNoise: true,
    };

    const script = service.generateFingerprintScript(fpConfig);

    // Canvas checks
    expect(script).toContain('CANVAS_NOISE = true');
    expect(script).toContain('CanvasRenderingContext2D.prototype.getImageData');
    expect(script).toContain('HTMLCanvasElement.prototype.toDataURL');

    // WebGL checks
    expect(script).toContain('WEBGL_NOISE = true');
    expect(script).toContain('UNMASKED_VENDOR_WEBGL');
    expect(script).toContain('ANGLE (NVIDIA');

    // Audio Context spoofing
    expect(script).toContain('AUDIO_NOISE = true');
    expect(script).toContain('AudioBuffer.prototype.getChannelData');
  });
});
