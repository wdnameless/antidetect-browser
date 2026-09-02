import { describe, it, expect, beforeEach } from 'vitest';
import { ChromiumBaselineService, ChromiumProfileConfig, ProcessHandle } from '../../src/main/services/chromium-baseline-service';

describe('Chromium Baseline Service & Launch Matrix (remove-camoufox-engine 4.1 / establish-parity 4.1)', () => {
  let service: ChromiumBaselineService;

  beforeEach(() => {
    service = new ChromiumBaselineService();
  });

  it('creates profile with Chromium engine defaults and launch arguments', () => {
    const config: ChromiumProfileConfig = {
      id: 'prof-baseline-001',
      name: 'Default Chromium Profile',
      engine: 'chromium',
      userDataDir: 'D:/tmp/test-profile-001',
      headless: false,
      disableSandbox: false,
    };

    const args = service.generateLaunchArgs(config);

    expect(args).toContain('--user-data-dir=D:/tmp/test-profile-001');
    expect(args).toContain('--remote-debugging-port=0');
    expect(args).toContain('--no-first-run');
    expect(args).toContain('--no-default-browser-check');
    expect(args).toContain('--persist-session-cookies');
    expect(args).not.toContain('--no-sandbox');
    expect(args).not.toContain('--headless=new');
  });

  it('handles sandbox options and headless flag correctly', () => {
    const config: ChromiumProfileConfig = {
      id: 'prof-baseline-sandbox',
      name: 'Sandbox Disabled Profile',
      engine: 'chromium',
      userDataDir: 'D:/tmp/test-profile-sandbox',
      headless: true,
      disableSandbox: true,
    };

    const args = service.generateLaunchArgs(config);

    expect(args).toContain('--headless=new');
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-setuid-sandbox');
  });

  it('integrates HTTP and SOCKS5 proxy configuration into launch flags', () => {
    const httpConfig: ChromiumProfileConfig = {
      id: 'prof-http-proxy',
      name: 'HTTP Proxy Profile',
      engine: 'chromium',
      userDataDir: 'D:/tmp/test-profile-http',
      proxy: {
        type: 'http',
        host: '10.0.0.10',
        port: 8080,
      },
    };

    const httpArgs = service.generateLaunchArgs(httpConfig);
    expect(httpArgs).toContain('--proxy-server=http://10.0.0.10:8080');

    const socksConfig: ChromiumProfileConfig = {
      id: 'prof-socks-proxy',
      name: 'SOCKS5 Proxy Profile',
      engine: 'chromium',
      userDataDir: 'D:/tmp/test-profile-socks',
      proxy: {
        type: 'socks5',
        host: 'proxy.internal',
        port: 1080,
      },
    };

    const socksArgs = service.generateLaunchArgs(socksConfig);
    expect(socksArgs).toContain('--proxy-server=socks5://proxy.internal:1080');
  });

  it('applies screen override parameters and window sizing', () => {
    const config: ChromiumProfileConfig = {
      id: 'prof-screen',
      name: 'Screen Override Profile',
      engine: 'chromium',
      userDataDir: 'D:/tmp/test-profile-screen',
      screenOverride: {
        width: 1920,
        height: 1080,
        scaleFactor: 1.25,
      },
    };

    const args = service.generateLaunchArgs(config);

    expect(args).toContain('--window-size=1920,1080');
    expect(args).toContain('--window-position=0,0');
    expect(args).toContain('--force-device-scale-factor=1.25');
  });

  it('tracks full lifecycle transitions: launching -> running -> stopping -> stopped', async () => {
    let mockKilled = false;
    const mockProc: ProcessHandle = {
      pid: 54321,
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: () => {
        mockKilled = true;
        mockProc.killed = true;
        mockProc.exitCode = 0;
        return true;
      },
    };

    const config: ChromiumProfileConfig = {
      id: 'prof-lifecycle',
      name: 'Lifecycle Profile',
      engine: 'chromium',
      userDataDir: 'D:/tmp/test-profile-lifecycle',
    };

    expect(service.getState('prof-lifecycle')).toBe('stopped');

    const launchPromise = service.launchProfile(config, () => mockProc);
    const result = await launchPromise;

    expect(result.profileId).toBe('prof-lifecycle');
    expect(result.pid).toBe(54321);
    expect(result.state).toBe('running');
    expect(service.getState('prof-lifecycle')).toBe('running');
    expect(result.wsEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/prof-lifecycle$/);

    // Stop profile
    const stopped = await service.stopProfile('prof-lifecycle');
    expect(stopped).toBe(true);
    expect(mockKilled).toBe(true);
    expect(service.getState('prof-lifecycle')).toBe('stopped');
  });

  it('prevents double-launching an already running profile', async () => {
    const config: ChromiumProfileConfig = {
      id: 'prof-double',
      name: 'Double Launch Profile',
      engine: 'chromium',
      userDataDir: 'D:/tmp/test-profile-double',
    };

    await service.launchProfile(config);
    expect(service.getState('prof-double')).toBe('running');

    await expect(service.launchProfile(config)).rejects.toThrow(/already in state running/);
  });
});
