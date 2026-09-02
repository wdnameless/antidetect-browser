import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  assertEngineAllowed,
  UnsupportedEngineError,
  CAMOUFOX_ENGINE_REMOVED,
  checkCamoufoxExecutablePath,
  verifyCleanEngineSurfaces,
} from '../../src/main/services/browser-engine-denial';
import { runCheckPackageHygiene } from '../../scripts/check-package-hygiene';
import { runCheckDocsClaims } from '../../scripts/check-docs-claims';
import { runCamoufoxAudit } from '../../scripts/camoufox-audit';

describe('Wave 4.2: Camoufox Engine Removal Verification', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camoufox-removal-verify-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Launcher and Engine Denial Verification', () => {
    it('rejects camoufox and firefox engine variants with typed UnsupportedEngineError', () => {
      expect(() => assertEngineAllowed('camoufox')).toThrow(UnsupportedEngineError);
      expect(() => assertEngineAllowed('firefox')).toThrow(UnsupportedEngineError);
      expect(() => assertEngineAllowed('Camoufox')).toThrow(UnsupportedEngineError);
      expect(() => assertEngineAllowed('FIREFOX')).toThrow(UnsupportedEngineError);

      try {
        assertEngineAllowed('camoufox');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UnsupportedEngineError);
        if (err instanceof UnsupportedEngineError) {
          expect(err.code).toBe(CAMOUFOX_ENGINE_REMOVED);
          expect(err.statusCode).toBe(422);
          expect(err.error).toBe('unsupported_engine');
        }
      }
    });

    it('allows valid engines (chromium, chrome, edge)', () => {
      expect(() => assertEngineAllowed('chromium')).not.toThrow();
      expect(() => assertEngineAllowed('chrome')).not.toThrow();
      expect(() => assertEngineAllowed('edge')).not.toThrow();
      expect(() => assertEngineAllowed(undefined)).not.toThrow();
    });

    it('rejects execution when path points to camoufox binaries', () => {
      const mockCamoufoxBin = path.join(tempDir, 'camoufox.exe');
      fs.writeFileSync(mockCamoufoxBin, 'mock binary');

      expect(() => checkCamoufoxExecutablePath(mockCamoufoxBin)).toThrow(UnsupportedEngineError);
      expect(() => checkCamoufoxExecutablePath('C:\\browser\\camoufox\\camoufox.exe')).toThrow(UnsupportedEngineError);
      expect(() => checkCamoufoxExecutablePath('/opt/camoufox/firefox')).toThrow(UnsupportedEngineError);
    });

    it('allows valid chromium execution paths', () => {
      const mockChromiumBin = path.join(tempDir, 'chrome.exe');
      fs.writeFileSync(mockChromiumBin, 'mock binary');

      expect(() => checkCamoufoxExecutablePath(mockChromiumBin)).not.toThrow();
      expect(() => checkCamoufoxExecutablePath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).not.toThrow();
    });
  });

  describe('Surface and Interface Hygiene Verification', () => {
    it('verifies clean surface inspection passes for repository code', () => {
      const scanResult = verifyCleanEngineSurfaces();
      expect(scanResult.clean).toBe(true);
      expect(scanResult.prohibitedSurfaceViolations).toHaveLength(0);
    });

    it('detects violations if prohibited engine routes or descriptors are present', () => {
      const dirtySurfaces = [
        { route: '/api/v1/camoufox/launch', engine: 'camoufox' },
        { route: '/api/v1/browser/launch', engine: 'chromium' },
      ];
      const result = verifyCleanEngineSurfaces(dirtySurfaces);
      expect(result.clean).toBe(false);
      expect(result.prohibitedSurfaceViolations).toContain('/api/v1/camoufox/launch');
    });
  });

  describe('Package, Docs, and Audit Verification Wrappers', () => {
    it('executes check-package-hygiene and produces valid JCS summary', async () => {
      const jsonPath = path.join(tempDir, 'package-hygiene.summary.jcs.json');
      const rawOutPath = path.join(tempDir, 'package-hygiene.raw.json');

      await runCheckPackageHygiene({ jsonPath, rawOutPath });

      expect(fs.existsSync(jsonPath)).toBe(true);
      const summary = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      expect(summary.schemaVersion).toBe('1');
      expect(summary.status).toBe('pass');
      expect(summary.failed).toBe(0);
      expect(summary.assertions.length).toBeGreaterThan(0);
    });

    it('executes check-docs-claims and produces valid JCS summary', async () => {
      const jsonPath = path.join(tempDir, 'docs-claims.summary.jcs.json');
      const rawOutPath = path.join(tempDir, 'docs-claims.raw.json');

      await runCheckDocsClaims({ jsonPath, rawOutPath });

      expect(fs.existsSync(jsonPath)).toBe(true);
      const summary = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      expect(summary.schemaVersion).toBe('1');
      expect(summary.status).toBe('pass');
      expect(summary.failed).toBe(0);
      expect(summary.assertions.length).toBeGreaterThan(0);
    });

    it('executes camoufox-audit and asserts complete removal state', async () => {
      const jsonPath = path.join(tempDir, 'camoufox-audit.summary.jcs.json');
      const rawOutPath = path.join(tempDir, 'camoufox-audit.raw.json');

      await runCamoufoxAudit({ jsonPath, rawOutPath });

      expect(fs.existsSync(jsonPath)).toBe(true);
      const summary = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      expect(summary.schemaVersion).toBe('1');
      expect(summary.status).toBe('pass');
      expect(summary.failed).toBe(0);
      expect(summary.assertions.length).toBeGreaterThan(0);
    });
  });
});
