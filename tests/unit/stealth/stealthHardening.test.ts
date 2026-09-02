import { describe, it, expect } from 'vitest';
import * as vm from 'vm';
import { buildStealthScript, StealthOptions } from '../../../src/main/proxy/stealthInjection';
import { deriveSubSeeds, getSyntheticVoicePool, getSyntheticMediaDevices } from '../../../src/main/proxy/stealthNoise';

function createMockBrowserContext(opts: StealthOptions) {
  const scriptContent = buildStealthScript(opts);

  // Define realistic mock classes and prototypes
  class MockDOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
    right: number;
    bottom: number;

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.left = x;
      this.right = x + width;
      this.bottom = y + height;
    }

    toJSON() {
      return {
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        top: this.top,
        left: this.left,
        right: this.right,
        bottom: this.bottom,
      };
    }
  }

  class MockDOMRectList {
    private _rects: MockDOMRect[];
    length: number;

    constructor(rects: MockDOMRect[] = []) {
      this._rects = rects;
      this.length = rects.length;
      for (let i = 0; i < rects.length; i++) {
        (this as unknown as Record<number, MockDOMRect>)[i] = rects[i];
      }
    }

    item(index: number) {
      return this._rects[index] ?? null;
    }
  }

  class MockElement {
    getBoundingClientRect() {
      return new MockDOMRect(10, 20, 100, 50);
    }

    getClientRects() {
      return new MockDOMRectList([
        new MockDOMRect(10, 20, 100, 50),
        new MockDOMRect(110, 20, 80, 50),
      ]);
    }
  }

  class MockRange {
    getBoundingClientRect() {
      return new MockDOMRect(5, 15, 60, 30);
    }

    getClientRects() {
      return new MockDOMRectList([new MockDOMRect(5, 15, 60, 30)]);
    }
  }

  class MockCanvasRenderingContext2D {
    canvas: MockHTMLCanvasElement | null = null;

    getImageData(sx: number, sy: number, sw: number, sh: number) {
      const length = sw * sh * 4;
      const data = new Uint8ClampedArray(length);
      for (let i = 0; i < length; i += 4) {
        data[i] = 128; // R
        data[i + 1] = 128; // G
        data[i + 2] = 128; // B
        data[i + 3] = 255; // A
      }
      return {
        data,
        width: sw,
        height: sh,
      };
    }

    putImageData(imageData: unknown, dx: number, dy: number) {
      void imageData;
      void dx;
      void dy;
    }

    drawImage(img: unknown, dx: number, dy: number) {
      void img;
      void dx;
      void dy;
    }
  }

  class MockHTMLCanvasElement {
    width = 100;
    height = 100;
    private _ctx = new MockCanvasRenderingContext2D();

    constructor() {
      this._ctx.canvas = this;
    }

    getContext(type: string) {
      if (type === '2d') return this._ctx;
      return null;
    }

    toDataURL(type = 'image/png') {
      const ctx = this._ctx;
      const img = ctx.getImageData(0, 0, this.width, this.height);
      let sum = 0;
      for (let i = 0; i < img.data.length; i++) {
        sum = (sum + img.data[i]) & 0xffffff;
      }
      return `data:${type};base64,mock_${sum}_${img.data[0]}_${img.data[1]}_${img.data[2]}`;
    }

    toBlob(callback: (blob: unknown) => void, type = 'image/png') {
      const url = this.toDataURL(type);
      callback({ size: url.length, type });
    }
  }

  class MockWebGLRenderingContext {
    getParameter(param: number) {
      return `param_${param}`;
    }

    readPixels(
      x: number,
      y: number,
      width: number,
      height: number,
      format: number,
      type: number,
      pixels: Uint8Array | Uint8ClampedArray
    ) {
      void x;
      void y;
      void width;
      void height;
      void format;
      void type;
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 100;
        pixels[i + 1] = 100;
        pixels[i + 2] = 100;
        pixels[i + 3] = 255;
      }
    }
  }

  class MockWebGL2RenderingContext extends MockWebGLRenderingContext {}

  class MockAudioBuffer {
    numberOfChannels = 2;
    length = 100;
    sampleRate = 44100;
    private _channelData: Float32Array[];

    constructor() {
      this._channelData = [new Float32Array(100), new Float32Array(100)];
      for (let i = 0; i < 100; i++) {
        this._channelData[0][i] = 0.5;
        this._channelData[1][i] = 0.5;
      }
    }

    getChannelData(channel: number) {
      return this._channelData[channel] || this._channelData[0];
    }

    copyFromChannel(destination: Float32Array, channelNumber: number) {
      const src = this._channelData[channelNumber] || this._channelData[0];
      const count = Math.min(destination.length, src.length);
      destination.set(src.subarray(0, count));
    }
  }

  class MockAnalyserNode {
    getFloatFrequencyData(array: Float32Array) {
      for (let i = 0; i < array.length; i++) {
        array[i] = -50.0;
      }
    }
  }

  class MockNotification {
    static permission = 'denied';
  }

  class MockScreen {
    orientation = { type: 'landscape-primary', angle: 0 };
  }

  class MockSpeechSynthesisVoice {}
  class MockMediaDeviceInfo {}
  class MockBatteryManager {}

  const mockDocument = {
    createElement(tag: string) {
      if (tag === 'canvas') return new MockHTMLCanvasElement();
      return {};
    },
  };

  const mockNavigator: Record<string, unknown> = {
    userAgent: 'Mozilla/5.0 ...',
    permissions: {
      query: (desc: { name: string }) =>
        Promise.resolve({ state: 'denied', name: desc.name }),
    },
    mediaDevices: {
      enumerateDevices: () => Promise.resolve([]),
    },
    getBattery: () => Promise.resolve(null),
  };

  const mockWindow: Record<string, unknown> = {
    chrome: {},
    speechSynthesis: {
      getVoices: () => [],
    },
  };

  const sandbox: Record<string, unknown> = {
    window: mockWindow,
    document: mockDocument,
    Screen: MockScreen,
    Notification: MockNotification,
    Element: MockElement,
    Range: MockRange,
    DOMRect: MockDOMRect,
    DOMRectList: MockDOMRectList,
    HTMLCanvasElement: MockHTMLCanvasElement,
    CanvasRenderingContext2D: MockCanvasRenderingContext2D,
    WebGLRenderingContext: MockWebGLRenderingContext,
    WebGL2RenderingContext: MockWebGL2RenderingContext,
    AudioBuffer: MockAudioBuffer,
    AnalyserNode: MockAnalyserNode,
    SpeechSynthesisVoice: MockSpeechSynthesisVoice,
    MediaDeviceInfo: MockMediaDeviceInfo,
    BatteryManager: MockBatteryManager,
  };
  class MockNavigator {}
  const mockNavigatorInstance = new MockNavigator();
  Object.assign(mockNavigatorInstance, mockNavigator);
  sandbox.Navigator = MockNavigator;
  sandbox.navigator = mockNavigatorInstance;

  const context = vm.createContext(sandbox);
  vm.runInContext(scriptContent, context);

  return { context, sandbox, scriptContent };
}

describe('Stealth Hardening & Noise Integration (Slice A)', () => {
  it('includes // TODO(engine-parity): comments on all hooked surfaces', () => {
    const script = buildStealthScript({
      mobile: false,
      logicalPlatform: 'windows',
      seed: 42,
    });

    const requiredSurfaces = [
      'Function.prototype.toString',
      'Navigator.prototype.userAgentData',
      'Navigator.prototype.platform',
      'CanvasRenderingContext2D.prototype.getImageData',
      'HTMLCanvasElement.prototype.toDataURL',
      'HTMLCanvasElement.prototype.toBlob',
      'WebGLRenderingContext.prototype.getParameter',
      'WebGLRenderingContext.prototype.readPixels',
      'WebGL2RenderingContext.prototype.getParameter',
      'WebGL2RenderingContext.prototype.readPixels',
      'AudioBuffer.prototype.getChannelData',
      'AudioBuffer.prototype.copyFromChannel',
      'AnalyserNode.prototype.getFloatFrequencyData',
      'Element.prototype.getBoundingClientRect',
      'Element.prototype.getClientRects',
      'Range.prototype.getBoundingClientRect',
      'Range.prototype.getClientRects',
      'speechSynthesis.getVoices',
      'navigator.mediaDevices.enumerateDevices',
      'navigator.getBattery',
    ];

    for (const surface of requiredSurfaces) {
      const regex = new RegExp(`//\\s*TODO\\(engine-parity\\):\\s*${surface.replace(/\./g, '\\.')}`);
      expect(script).toMatch(regex);
    }
  });

  describe('Function.prototype.toString interception', () => {
    it('returns native representation function name() { [native code] } for overrides', () => {
      const { context } = createMockBrowserContext({
        mobile: false,
        logicalPlatform: 'windows',
        seed: 12345,
      });

      const res = vm.runInContext(
        `(() => {
          const toStr = Function.prototype.toString;
          const getImageDataStr = CanvasRenderingContext2D.prototype.getImageData.toString();
          const toDataURLStr = HTMLCanvasElement.prototype.toDataURL.toString();
          const getParamStr = WebGLRenderingContext.prototype.getParameter.toString();
          const getVoicesStr = window.speechSynthesis.getVoices.toString();
          const toStringStr = Function.prototype.toString.toString();
          const toStringCallSelf = Function.prototype.toString.call(Function.prototype.toString);

          // Normal un-hooked user function
          function customUserFunc(a, b) { return a + b; }
          const customStr = customUserFunc.toString();

          return {
            getImageDataStr,
            toDataURLStr,
            getParamStr,
            getVoicesStr,
            toStringStr,
            toStringCallSelf,
            customStr,
          };
        })()`,
        context
      );

      expect(res.getImageDataStr).toBe('function getImageData() { [native code] }');
      expect(res.toDataURLStr).toBe('function toDataURL() { [native code] }');
      expect(res.getParamStr).toBe('function getParameter() { [native code] }');
      expect(res.getVoicesStr).toBe('function getVoices() { [native code] }');
      expect(res.toStringStr).toBe('function toString() { [native code] }');
      expect(res.toStringCallSelf).toBe('function toString() { [native code] }');
      expect(res.customStr).toContain('customUserFunc');
      expect(res.customStr).not.toContain('[native code]');
    });

    it('has correct property descriptor (writable: true, enumerable: false, configurable: true)', () => {
      const { context } = createMockBrowserContext({
        mobile: false,
        logicalPlatform: 'windows',
      });

      const desc = vm.runInContext(
        `Object.getOwnPropertyDescriptor(Function.prototype, 'toString')`,
        context
      );

      expect(desc.writable).toBe(true);
      expect(desc.enumerable).toBe(false);
      expect(desc.configurable).toBe(true);
    });
  });

  describe('Canvas 2D & WebGL Noise', () => {
    it('applies deterministic noise to Canvas 2D getImageData with same seed yielding identical results and different seeds diverging', () => {
      const ctx1 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 1001 });
      const ctx2 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 1001 });
      const ctx3 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 9999 });

      const runTest = (ctx: vm.Context) => {
        return vm.runInContext(
          `(() => {
            const ctx2d = new CanvasRenderingContext2D();
            const imgData = ctx2d.getImageData(0, 0, 10, 10);
            return Array.from(imgData.data);
          })()`,
          ctx
        );
      };

      const data1 = runTest(ctx1.context);
      const data2 = runTest(ctx2.context);
      const data3 = runTest(ctx3.context);

      // Same seed -> exact identical output
      expect(data1).toEqual(data2);
      // Different seed -> divergent output
      expect(data1).not.toEqual(data3);

      // Sub-perceptual bounds: initial is 128 for RGB, noise is ±2, Alpha remains 255
      for (let i = 0; i < data1.length; i += 4) {
        expect(data1[i]).toBeGreaterThanOrEqual(126);
        expect(data1[i]).toBeLessThanOrEqual(130);
        expect(data1[i + 1]).toBeGreaterThanOrEqual(126);
        expect(data1[i + 1]).toBeLessThanOrEqual(130);
        expect(data1[i + 2]).toBeGreaterThanOrEqual(126);
        expect(data1[i + 2]).toBeLessThanOrEqual(130);
        expect(data1[i + 3]).toBe(255); // Alpha channel untouched
      }
    });

    it('applies noise to HTMLCanvasElement toDataURL & toBlob', () => {
      const ctx1 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 1001 });
      const ctx2 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 1001 });
      const ctx3 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 9999 });

      const runToDataURL = (ctx: vm.Context) => {
        return vm.runInContext(
          `(() => {
            const canvas = document.createElement('canvas');
            return canvas.toDataURL();
          })()`,
          ctx
        );
      };

      const url1 = runToDataURL(ctx1.context);
      const url2 = runToDataURL(ctx2.context);
      const url3 = runToDataURL(ctx3.context);

      expect(url1).toBe(url2);
      expect(url1).not.toBe(url3);
    });

    it('spoofs WebGL vendor / renderer and applies subtle noise to readPixels', () => {
      const { context } = createMockBrowserContext({
        mobile: false,
        logicalPlatform: 'windows',
        seed: 7777,
        webglVendor: 'Custom Vendor Inc.',
        webglRenderer: 'Custom Renderer RTX',
      });

      const res = vm.runInContext(
        `(() => {
          const gl = new WebGLRenderingContext();
          const vendor = gl.getParameter(0x9245);
          const renderer = gl.getParameter(0x9246);

          const gl2 = new WebGL2RenderingContext();
          const vendor2 = gl2.getParameter(0x9245);
          const renderer2 = gl2.getParameter(0x9246);

          const pixels = new Uint8Array(16);
          gl.readPixels(0, 0, 2, 2, 0x1908, 0x1401, pixels);

          return {
            vendor,
            renderer,
            vendor2,
            renderer2,
            pixels: Array.from(pixels),
          };
        })()`,
        context
      );

      expect(res.vendor).toBe('Custom Vendor Inc.');
      expect(res.renderer).toBe('Custom Renderer RTX');
      expect(res.vendor2).toBe('Custom Vendor Inc.');
      expect(res.renderer2).toBe('Custom Renderer RTX');

      // Base was 100 for RGB, noise ±2
      for (let i = 0; i < res.pixels.length; i += 4) {
        expect(res.pixels[i]).toBeGreaterThanOrEqual(98);
        expect(res.pixels[i]).toBeLessThanOrEqual(102);
        expect(res.pixels[i + 1]).toBeGreaterThanOrEqual(98);
        expect(res.pixels[i + 1]).toBeLessThanOrEqual(102);
        expect(res.pixels[i + 2]).toBeGreaterThanOrEqual(98);
        expect(res.pixels[i + 2]).toBeLessThanOrEqual(102);
      }
    });
  });

  describe('Audio Buffer & Analyser Noise', () => {
    it('applies deterministic sub-audible noise (±0.0001) to AudioBuffer and AnalyserNode', () => {
      const ctx1 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 555 });
      const ctx2 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 555 });
      const ctx3 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 777 });

      const runAudioTest = (ctx: vm.Context) => {
        return vm.runInContext(
          `(() => {
            const buf = new AudioBuffer();
            const channel0 = Array.from(buf.getChannelData(0));

            const copyDest = new Float32Array(50);
            buf.copyFromChannel(copyDest, 1);

            const analyser = new AnalyserNode();
            const freqData = new Float32Array(50);
            analyser.getFloatFrequencyData(freqData);

            return {
              channel0,
              copyDest: Array.from(copyDest),
              freqData: Array.from(freqData),
            };
          })()`,
          ctx
        );
      };

      const res1 = runAudioTest(ctx1.context);
      const res2 = runAudioTest(ctx2.context);
      const res3 = runAudioTest(ctx3.context);

      // Determinism
      expect(res1).toEqual(res2);
      expect(res1.channel0).not.toEqual(res3.channel0);

      // Bounds: base was 0.5, jitter within ±0.0001
      for (let i = 0; i < res1.channel0.length; i++) {
        expect(Math.abs(res1.channel0[i] - 0.5)).toBeLessThanOrEqual(0.00010001);
      }

      // Analyser base was -50.0, jitter within ±0.0001
      for (let i = 0; i < res1.freqData.length; i++) {
        expect(Math.abs(res1.freqData[i] - -50.0)).toBeLessThanOrEqual(0.00010001);
      }
    });
  });

  describe('DOMRect & ClientRects Noise', () => {
    it('applies deterministic sub-pixel fraction dithering (±0.0001px) to getBoundingClientRect and getClientRects', () => {
      const ctx1 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 123 });
      const ctx2 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 123 });
      const ctx3 = createMockBrowserContext({ mobile: false, logicalPlatform: 'windows', seed: 456 });

      const runRectTest = (ctx: vm.Context) => {
        return vm.runInContext(
          `(() => {
            const elem = new Element();
            const elemRect = elem.getBoundingClientRect();
            const elemRects = elem.getClientRects();
            const elemRect0 = elemRects.item(0);

            const range = new Range();
            const rangeRect = range.getBoundingClientRect();
            const rangeRects = range.getClientRects();
            const rangeRect0 = rangeRects[0];

            return {
              elemRect: elemRect.toJSON ? elemRect.toJSON() : elemRect,
              elemRect0: elemRect0.toJSON ? elemRect0.toJSON() : elemRect0,
              rangeRect: rangeRect.toJSON ? rangeRect.toJSON() : rangeRect,
              rangeRect0: rangeRect0.toJSON ? rangeRect0.toJSON() : rangeRect0,
            };
          })()`,
          ctx
        );
      };

      const res1 = runRectTest(ctx1.context);
      const res2 = runRectTest(ctx2.context);
      const res3 = runRectTest(ctx3.context);

      expect(res1).toEqual(res2);
      expect(res1.elemRect).not.toEqual(res3.elemRect);

      // Base was x=10, y=20, width=100, height=50
      expect(Math.abs(res1.elemRect.x - 10)).toBeLessThanOrEqual(0.00010001);
      expect(Math.abs(res1.elemRect.y - 20)).toBeLessThanOrEqual(0.00010001);
      expect(Math.abs(res1.elemRect.width - 100)).toBeLessThanOrEqual(0.00010001);
      expect(Math.abs(res1.elemRect.height - 50)).toBeLessThanOrEqual(0.00010001);
    });
  });

  describe('Peripherals, Voices & Battery Coherence', () => {
    it('returns realistic Windows voice pool matching profile locale', () => {
      const { context: ctxUs } = createMockBrowserContext({
        mobile: false,
        logicalPlatform: 'windows',
        locale: 'en-US',
      });

      const voicesUs = vm.runInContext(
        `window.speechSynthesis.getVoices()`,
        ctxUs
      );

      expect(voicesUs.length).toBeGreaterThanOrEqual(3);
      expect(voicesUs.some((v: { name: string }) => v.name.includes('David'))).toBe(true);
      expect(voicesUs.some((v: { name: string }) => v.name.includes('Zira'))).toBe(true);
      expect(voicesUs.some((v: { name: string }) => v.name.includes('Mark'))).toBe(true);

      const { context: ctxRu } = createMockBrowserContext({
        mobile: false,
        logicalPlatform: 'windows',
        locale: 'ru-RU',
      });

      const voicesRu = vm.runInContext(
        `window.speechSynthesis.getVoices()`,
        ctxRu
      );

      expect(voicesRu.some((v: { name: string }) => v.name.includes('Irina'))).toBe(true);
    });

    it('returns deterministic virtual audio/video inputs with MediaDeviceInfo', async () => {
      const { context } = createMockBrowserContext({
        mobile: false,
        logicalPlatform: 'windows',
        seed: 8888,
      });

      const devices = await vm.runInContext(
        `navigator.mediaDevices.enumerateDevices()`,
        context
      );

      expect(devices.length).toBeGreaterThanOrEqual(3);
      expect(devices.some((d: { kind: string }) => d.kind === 'audioinput')).toBe(true);
      expect(devices.some((d: { kind: string }) => d.kind === 'audiooutput')).toBe(true);
      expect(devices.some((d: { kind: string }) => d.kind === 'videoinput')).toBe(true);

      for (const d of devices) {
        expect(d.deviceId).toBeDefined();
        expect(typeof d.deviceId).toBe('string');
        expect(d.deviceId.length).toBe(64); // SHA-256 hex string
      }
    });

    it('returns battery status coherent with desktop vs mobile', async () => {
      const { context: desktopCtx } = createMockBrowserContext({
        mobile: false,
        logicalPlatform: 'windows',
      });

      const desktopBattery = await vm.runInContext(
        `navigator.getBattery()`,
        desktopCtx
      );

      expect(desktopBattery.charging).toBe(true);
      expect(desktopBattery.level).toBe(1.0);
      expect(desktopBattery.chargingTime).toBe(0);

      const { context: mobileCtx } = createMockBrowserContext({
        mobile: true,
        logicalPlatform: 'android',
      });

      const mobileBattery = await vm.runInContext(
        `navigator.getBattery()`,
        mobileCtx
      );

      expect(mobileBattery.charging).toBe(false);
      expect(mobileBattery.level).toBeLessThan(1.0);
      expect(mobileBattery.chargingTime).toBe(Infinity);
    });
  });

  describe('Sub-seeds derivation helper', () => {
    it('produces distinct 32-bit unsigned integers from master seed', () => {
      const seeds1 = deriveSubSeeds(12345);
      const seeds2 = deriveSubSeeds(12345);
      const seeds3 = deriveSubSeeds(99999);

      expect(seeds1).toEqual(seeds2);
      expect(seeds1.canvas).not.toEqual(seeds3.canvas);
      expect(seeds1.webgl).not.toEqual(seeds3.webgl);
      expect(seeds1.audio).not.toEqual(seeds3.audio);
      expect(seeds1.rects).not.toEqual(seeds3.rects);

      expect(seeds1.canvas).toBeGreaterThanOrEqual(0);
      expect(seeds1.canvas).toBeLessThanOrEqual(0xffffffff);
    });
  });
});
