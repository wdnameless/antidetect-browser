import { describe, it, expect } from 'vitest';
import * as vm from 'vm';
import {
  buildStealthScript,
  StealthOptions,
  resolveWebGpuConfig,
} from '../../../src/main/proxy/stealthInjection';

function createGpuSandbox(opts: StealthOptions, withGpu: boolean, withWebAuthn: boolean) {
  const scriptContent = buildStealthScript(opts);

  class MockGPUAdapterInfo {}
  class MockGPUAdapter {}
  class MockPublicKeyCredential {
    static isUserVerifyingPlatformAuthenticatorAvailable() {
      return Promise.resolve(true);
    }
  }

  const navigatorObj: Record<string, unknown> = {};
  if (withGpu) {
    navigatorObj.gpu = {
      requestAdapter() {
        return Promise.resolve(null);
      },
    };
  }

  const sandbox: Record<string, unknown> = {
    window: {},
    navigator: navigatorObj,
  };
  if (withGpu) {
    sandbox.GPUAdapterInfo = MockGPUAdapterInfo;
    sandbox.GPUAdapter = MockGPUAdapter;
  }
  if (withWebAuthn) {
    sandbox.PublicKeyCredential = MockPublicKeyCredential;
  }

  const context = vm.createContext(sandbox);
  vm.runInContext(scriptContent, context);
  return { context, sandbox, scriptContent };
}

describe('Engine surfaces JS-interim (WebGPU + WebAuthn)', () => {
  it('WebGPU hook carries the engine-parity marker', () => {
    const script = buildStealthScript({
      mobile: false,
      logicalPlatform: 'windows',
      seed: 42,
    });
    expect(script).toMatch(/\/\/\s*TODO\(engine-parity: webgpu-dawn\)/);
    expect(script).toMatch(/\/\/\s*TODO\(engine-parity: webauthn\)/);
  });

  it('requestAdapter resolves the profile family GPU, never the host', async () => {
    const { sandbox } = createGpuSandbox(
      {
        mobile: false,
        logicalPlatform: 'windows',
        seed: 1,
        webgpu: { vendor: 'nvidia', architecture: 'ampere', device: 'RTX 4060' },
      },
      true,
      true
    );

    const gpu = (sandbox.navigator as { gpu: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = (await gpu.requestAdapter()) as {
      requestAdapterInfo(): Promise<{ vendor: string; architecture: string; device: string }>;
    };
    const info = await adapter.requestAdapterInfo();
    expect(info.vendor).toBe('nvidia');
    expect(info.architecture).toBe('ampere');
    expect(info.device).toBe('RTX 4060');
  });

  it('disabled WebGPU families resolve undefined like real Linux Chrome', async () => {
    const { sandbox } = createGpuSandbox(
      {
        mobile: false,
        logicalPlatform: 'linux',
        seed: 2,
        webgpu: { disabled: true },
      },
      true,
      false
    );

    const gpu = (sandbox.navigator as { gpu: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = await gpu.requestAdapter();
    expect(adapter).toBeUndefined();
  });

  it('resolveWebGpuConfig derives adapter info from the WebGL renderer when no explicit config', () => {
    const cfg = resolveWebGpuConfig({
      mobile: false,
      logicalPlatform: 'windows',
      seed: 3,
      webglRenderer: 'NVIDIA GeForce RTX 4060/PCIe/SSE2',
    });
    expect(cfg).not.toBeNull();
    expect(cfg?.disabled).toBe(false);
    expect(cfg?.device).toMatch(/4060|nvidia|rtx/i);
    expect(cfg?.vendor).toBe('nvidia');
  });

  it('WebAuthn availability answers per family matrix', async () => {
    const macosM = createGpuSandbox(
      {
        mobile: false,
        logicalPlatform: 'macos',
        seed: 4,
        webauthnPlatformAuthenticator: true,
      },
      true,
      true
    );
    const pkcMac = macosM.sandbox.PublicKeyCredential as {
      isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean>;
    };
    expect(await pkcMac.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(true);

    const legacyWin = createGpuSandbox(
      {
        mobile: false,
        logicalPlatform: 'windows',
        seed: 5,
        webauthnPlatformAuthenticator: false,
      },
      true,
      true
    );
    const pkcWin = legacyWin.sandbox.PublicKeyCredential as {
      isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean>;
    };
    expect(await pkcWin.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(false);
  });

  it('hooked requestAdapter presents native toString', async () => {
    const { sandbox } = createGpuSandbox(
      {
        mobile: false,
        logicalPlatform: 'windows',
        seed: 6,
        webgpu: { vendor: 'nvidia', architecture: 'ampere', device: 'RTX 4060' },
      },
      true,
      true
    );

    const gpu = sandbox.navigator as { gpu: { requestAdapter: () => unknown } };
    const str = (gpu.gpu.requestAdapter as unknown as { toString(): string }).toString();
    expect(str).toContain('requestAdapter');
    expect(str).toContain('[native code]');
  });
});