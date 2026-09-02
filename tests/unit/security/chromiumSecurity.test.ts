import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import * as childProcess from 'child_process';

const mockSpawn = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return {
    ...actual,
    spawn: (...args: any[]) => mockSpawn(...args),
  };
});

import { startProfile, buildChromiumArgs } from '../../../src/main/launcher/chromium';
import {
  writeStealthExtension,
  type StealthOptions,
} from '../../../src/main/proxy/stealthInjection';
import {
  signStealthExtension,
  verifyStealthExtensionDirectory,
  getEphemeralStealthKeyPair,
  StealthExtensionVerificationError,
} from '../../../src/main/security/extensionVerifier';
import { StrictQuicRelayError } from '../../../src/main/proxy/transportPolicy';
import * as transportPolicyModule from '../../../src/main/proxy/transportPolicy';
import * as udpRelayModule from '../../../src/main/proxy/udpRelay';
import type { LaunchConfig } from '../../../src/main/profiles/profileManager';

describe('startProfile security and strictQuicRelay verification (Task 2.2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-chrom-'));
    mockSpawn.mockReset();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  });

  function createFakeProcess(dir: string) {
    const ee = new EventEmitter() as any;
    ee.pid = 43210;
    ee.unref = vi.fn();
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();

    fs.writeFileSync(
      path.join(dir, 'DevToolsActivePort'),
      '9222\n/devtools/browser/mock-token-1234\n',
      'utf8'
    );
    return ee;
  }

  it('verifies stealth extension and builds args successfully for valid extension', async () => {
    const stealthExtDir = path.join(tmpDir, 'stealth-ext');
    const opts: StealthOptions = { mobile: false, logicalPlatform: 'windows' };
    const keyPair = getEphemeralStealthKeyPair();

    writeStealthExtension(stealthExtDir, opts, { signingKey: keyPair });

    const cfg: LaunchConfig = {
      profileId: 'prof-valid',
      userDataDir: tmpDir,
      stealth: opts,
    };

    const args = await buildChromiumArgs(cfg);
    expect(args.some((a) => a.startsWith('--load-extension='))).toBe(true);
  });

  it('refuses launch when stealth extension is unsigned', async () => {
    const stealthExtDir = path.join(tmpDir, 'stealth-ext');
    const opts: StealthOptions = { mobile: false, logicalPlatform: 'windows' };

    fs.mkdirSync(stealthExtDir, { recursive: true });
    fs.writeFileSync(
      path.join(stealthExtDir, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'Stealth' }),
      'utf8'
    );
    fs.writeFileSync(path.join(stealthExtDir, 'stealth.js'), 'console.log("tampered")', 'utf8');

    const cfg: LaunchConfig = {
      profileId: 'prof-unsigned',
      userDataDir: tmpDir,
      stealth: opts,
    };

    await expect(startProfile(cfg)).rejects.toThrow(StealthExtensionVerificationError);
  });

  it('refuses launch when stealth extension has been tampered before startProfile', async () => {
    const stealthExtDir = path.join(tmpDir, 'stealth-ext');
    const opts: StealthOptions = { mobile: false, logicalPlatform: 'windows' };
    const keyPair = getEphemeralStealthKeyPair();

    writeStealthExtension(stealthExtDir, opts, { signingKey: keyPair });
    fs.writeFileSync(path.join(stealthExtDir, 'stealth.js'), '/* injected malicious code */', 'utf8');

    const cfg: LaunchConfig = {
      profileId: 'prof-tampered',
      userDataDir: tmpDir,
      stealth: opts,
    };

    await expect(startProfile(cfg)).rejects.toThrow(StealthExtensionVerificationError);
    await expect(startProfile(cfg)).rejects.toThrow(/remediation/i);
  });

  describe('strictQuicRelay policy', () => {
    it('aborts launch and throws StrictQuicRelayError when strictQuicRelay is true and UDP relay fails', async () => {
      vi.spyOn(transportPolicyModule, 'probeTransportTarget').mockResolvedValue({
        status: 'SOCKS5_FULL_PASS',
      });
      vi.spyOn(udpRelayModule, 'startUdpRelay').mockRejectedValue(new Error('UDP socket bind failed'));

      const cfg: LaunchConfig & { strictQuicRelay?: boolean } = {
        profileId: 'prof-strict-quic',
        userDataDir: tmpDir,
        proxyServer: 'socks5://127.0.0.1:1080',
        strictQuicRelay: true,
      };

      await expect(startProfile(cfg as LaunchConfig)).rejects.toThrow(StrictQuicRelayError);
    });

    it('falls back to --disable-quic without aborting when strictQuicRelay is false and UDP relay fails', async () => {
      vi.spyOn(transportPolicyModule, 'probeTransportTarget').mockResolvedValue({
        status: 'SOCKS5_FULL_PASS',
      });
      vi.spyOn(udpRelayModule, 'startUdpRelay').mockRejectedValue(new Error('UDP socket bind failed'));

      const cfg: LaunchConfig & { strictQuicRelay?: boolean } = {
        profileId: 'prof-lenient-quic',
        userDataDir: tmpDir,
        proxyServer: 'socks5://127.0.0.1:1080',
        strictQuicRelay: false,
      };

      mockSpawn.mockImplementation(() => createFakeProcess(tmpDir));

      const result = await startProfile(cfg as LaunchConfig);
      expect(result.pid).toBe(43210);
      const spawnedArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnedArgs.includes('--disable-quic')).toBe(true);
    });

    it('falls back to --disable-quic without aborting when strictQuicRelay is omitted (defaults to false)', async () => {
      vi.spyOn(transportPolicyModule, 'probeTransportTarget').mockResolvedValue({
        status: 'SOCKS5_FULL_PASS',
      });
      vi.spyOn(udpRelayModule, 'startUdpRelay').mockRejectedValue(new Error('UDP socket bind failed'));

      const cfg: LaunchConfig = {
        profileId: 'prof-default-quic',
        userDataDir: tmpDir,
        proxyServer: 'socks5://127.0.0.1:1080',
      };

      mockSpawn.mockImplementation(() => createFakeProcess(tmpDir));
      const result = await startProfile(cfg);
      expect(result.pid).toBe(43210);
      expect(mockSpawn).toHaveBeenCalled();
      const spawnedArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnedArgs.includes('--disable-quic')).toBe(true);
    });
  });
});
