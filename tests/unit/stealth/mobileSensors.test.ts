import { describe, it, expect } from 'vitest';
import * as vm from 'vm';
import {
  buildStealthScript,
  StealthOptions,
} from '../../../src/main/proxy/stealthInjection';
import {
  resolveSensorConfig,
  SensorProfile,
} from '../../../src/main/proxy/stealthNoise';

function createSensorSandbox(opts: StealthOptions) {
  const scriptContent = buildStealthScript(opts);

  class MockEventTarget {
    private _events: Record<string, Function[]> = {};
    addEventListener(type: string, listener: Function) {
      if (!this._events[type]) this._events[type] = [];
      this._events[type].push(listener);
    }
    removeEventListener(type: string, listener: Function) {
      if (this._events[type]) {
        const idx = this._events[type].indexOf(listener);
        if (idx >= 0) this._events[type].splice(idx, 1);
      }
    }
    dispatchEvent(event: { type: string }) {
      const list = this._events[event.type];
      if (list) {
        for (const fn of list) fn.call(this, event);
      }
      return true;
    }
  }

  class MockScreen {}
  class MockNavigator {
    permissions = {
      query: (desc: { name: string }) => Promise.resolve({ state: 'prompt', onchange: null }),
    };
  }
  class MockDeviceMotionEvent {}
  class MockDeviceOrientationEvent {}

  const sandbox: Record<string, unknown> = {
    EventTarget: MockEventTarget,
    Screen: MockScreen,
    Navigator: MockNavigator,
    navigator: new MockNavigator(),
    DeviceMotionEvent: MockDeviceMotionEvent,
    DeviceOrientationEvent: MockDeviceOrientationEvent,
    setInterval: () => 1,
    clearInterval: () => {},
    performance: { now: () => 1000 },
    Date: { now: () => 1000000 },
  };
  // In a browser window === globalThis === the global object. Model that faithfully:
  // the vm sandbox IS the global, so alias window to it instead of creating a
  // separate object that would silently swallow `globalThis.X = ...` writes.
  Object.assign(sandbox, {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  sandbox.window = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(scriptContent, context);
  return { context, sandbox, scriptContent };
}

describe('Mobile Sensors (Defect A3)', () => {
  describe('resolveSensorConfig', () => {
    it('returns null for non-mobile profiles', () => {
      const desktopCfg = resolveSensorConfig({
        mobile: false,
        seed: 42,
        logicalPlatform: 'windows',
      });
      expect(desktopCfg).toBeNull();
    });

    it('returns a deterministic SensorProfile for phone-claiming profiles', () => {
      const p1 = resolveSensorConfig({
        mobile: true,
        seed: 12345,
        logicalPlatform: 'android',
      });
      const p2 = resolveSensorConfig({
        mobile: true,
        seed: 12345,
        logicalPlatform: 'android',
      });
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect(p1).toEqual(p2);
    });

    it('two different seeds produce diverging sensor configurations', () => {
      const p1 = resolveSensorConfig({
        mobile: true,
        seed: 11111,
        logicalPlatform: 'android',
      });
      const p2 = resolveSensorConfig({
        mobile: true,
        seed: 99999,
        logicalPlatform: 'android',
      });
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect(p1?.jitterAmplitude).not.toEqual(p2?.jitterAmplitude);
    });

    it('profile includes gravity, jitterAmplitude, orientation, and rotationCapability', () => {
      const profile = resolveSensorConfig({
        mobile: true,
        seed: 54321,
        logicalPlatform: 'ios',
      });
      expect(profile).toBeDefined();
      expect(profile!.gravity).toHaveProperty('x');
      expect(profile!.gravity).toHaveProperty('y');
      expect(profile!.gravity).toHaveProperty('z');
      expect(profile!.gravity.z).toBeCloseTo(9.8, 1);
      expect(profile!.jitterAmplitude).toBeGreaterThan(0);
      expect(['portrait-primary', 'landscape-primary']).toContain(profile!.orientation.type);
      expect(profile!.rotationCapability).toBe(true);
    });
  });

  describe('Injection and Stealth Script behavior', () => {
    it('does not emit sensor config or hooks for desktop profiles', () => {
      const { scriptContent, sandbox } = createSensorSandbox({
        mobile: false,
        logicalPlatform: 'windows',
        seed: 42,
      });

      // Desktop script should not have sensors in cfg
      expect(scriptContent).not.toMatch(/"sensors":\s*\{/);

      // Accelerometer should NOT be injected
      expect(sandbox.Accelerometer).toBeUndefined();
      expect(sandbox.Gyroscope).toBeUndefined();
    });

    it('emits sensors and hooks for mobile profiles with parity markers', async () => {
      const opts: StealthOptions = {
        mobile: true,
        logicalPlatform: 'android',
        seed: 42,
      };
      const { scriptContent, sandbox, context } = createSensorSandbox(opts);

      // Parity markers
      expect(scriptContent).toMatch(/\/\/\s*TODO\(engine-parity:\s*sensors\)/);

      // DeviceMotionEvent & DeviceOrientationEvent requestPermission
      const dme = sandbox.DeviceMotionEvent as { requestPermission?: () => Promise<string> };
      expect(typeof dme.requestPermission).toBe('function');
      const permResult = await dme.requestPermission!();
      expect(permResult).toBe('granted');

      // Sensor constructors exist
      expect(typeof sandbox.Accelerometer).toBe('function');
      expect(typeof sandbox.GravitySensor).toBe('function');
      expect(typeof sandbox.LinearAccelerationSensor).toBe('function');
      expect(typeof sandbox.Gyroscope).toBe('function');
      expect(typeof sandbox.Magnetometer).toBe('function');

      // Sensor instance start and stop
      const AccelClass = sandbox.Accelerometer as any;
      const sensor = new AccelClass();
      expect(sensor.activated).toBe(false);
      sensor.start();
      expect(sensor.activated).toBe(true);
      sensor.stop();
      expect(sensor.activated).toBe(false);

      // navigator.permissions.query answers sensor permissions
      const nav = sandbox.navigator as { permissions: { query: (d: { name: string }) => Promise<{ state: string }> } };
      const res = await nav.permissions.query({ name: 'accelerometer' });
      expect(res.state).toBe('granted');

      const gyroRes = await nav.permissions.query({ name: 'gyroscope' });
      expect(gyroRes.state).toBe('granted');
    });

    it('screen.orientation matches the sensor profile orientation', () => {
      const opts: StealthOptions = {
        mobile: true,
        logicalPlatform: 'android',
        seed: 42,
      };
      const sensorCfg = resolveSensorConfig(opts);
      expect(sensorCfg).not.toBeNull();

      const { sandbox } = createSensorSandbox(opts);
      const screenProto = (sandbox.Screen as { prototype: { orientation: { type: string; angle: number } } }).prototype;
      expect(screenProto.orientation.type).toBe(sensorCfg!.orientation.type);
      expect(screenProto.orientation.angle).toBe(sensorCfg!.orientation.angle);
    });
  });
});
