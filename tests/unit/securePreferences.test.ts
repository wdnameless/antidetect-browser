import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { injectExtensionIntoSecurePreferences } from '../../src/main/extensions/securePreferences';

describe('SecurePreferences Extension Injector', () => {
  it('should create and sign secure preferences for extension', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secpref-test-'));
    const defaultDir = path.join(tmpDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });

    // Write dummy Local State with seed
    fs.writeFileSync(path.join(tmpDir, 'Local State'), JSON.stringify({
      protection: {
        mac_seed: 'test-seed-12345'
      }
    }));

    const extDir = path.join(tmpDir, 'dummy-ext');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Test',
      version: '1.0'
    }));

    injectExtensionIntoSecurePreferences(tmpDir, 'Default', 'abcdefghijklmnopabcdefghijklmnop', extDir, { name: 'Test', version: '1.0' });

    const secPrefPath = path.join(defaultDir, 'Secure Preferences');
    expect(fs.existsSync(secPrefPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(secPrefPath, 'utf8'));
    expect(content.extensions?.settings).toBeDefined();
    expect(content.protection?.macs).toBeDefined();
    expect(content.protection?.super_mac).toBeDefined();
  });
});
