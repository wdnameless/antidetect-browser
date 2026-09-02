import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import {
  CAMOUFOX_ENGINE_REMOVED,
  UnsupportedEngineError,
  isDeniedEngine,
  assertEngineSupported,
  sanitizeProfileEngine,
  denyCamoufoxBundleDownload,
  engineDenialMiddleware,
  guardRpcEngineCall,
} from '../../src/main/services/browser-engine-denial';

describe('Browser Engine Denial Layer', () => {
  describe('assertEngineSupported and isDeniedEngine', () => {
    it('detects camoufox and firefox variants as denied engines', () => {
      expect(isDeniedEngine('camoufox')).toBe(true);
      expect(isDeniedEngine('Camoufox')).toBe(true);
      expect(isDeniedEngine('CAMOUFOX')).toBe(true);
      expect(isDeniedEngine('camoufox-browser')).toBe(true);
      expect(isDeniedEngine('firefox')).toBe(true);
      expect(isDeniedEngine('Firefox')).toBe(true);

      expect(isDeniedEngine('chromium')).toBe(false);
      expect(isDeniedEngine('chrome')).toBe(false);
      expect(isDeniedEngine(undefined)).toBe(false);
      expect(isDeniedEngine(null)).toBe(false);
    });

    it('throws UnsupportedEngineError with CAMOUFOX_ENGINE_REMOVED code and 422 status', () => {
      expect(() => {
        assertEngineSupported('camoufox');
      }).toThrowError(UnsupportedEngineError);

      try {
        assertEngineSupported('camoufox');
      } catch (err: unknown) {
        const error = err as UnsupportedEngineError;
        expect(error.code).toBe(CAMOUFOX_ENGINE_REMOVED);
        expect(error.statusCode).toBe(422);
        expect(error.engine).toBe('camoufox');
        expect(error.message).toContain('permanently removed');
      }

      // firefox
      expect(() => {
        assertEngineSupported('firefox');
      }).toThrowError(UnsupportedEngineError);

      // chromium passes with no throw
      expect(() => {
        assertEngineSupported('chromium');
      }).not.toThrow();

      expect(() => {
        assertEngineSupported(undefined);
      }).not.toThrow();
    });
  });

  describe('sanitizeProfileEngine', () => {
    it('rejects profile creation/update when mode is "reject"', () => {
      expect(() => {
        sanitizeProfileEngine({
          id: 'p-1',
          name: 'My Camoufox Profile',
          browser_type: 'camoufox',
        });
      }).toThrowError(UnsupportedEngineError);

      expect(() => {
        sanitizeProfileEngine({
          id: 'p-2',
          engine: 'firefox',
        });
      }).toThrowError(UnsupportedEngineError);

      // Chromium allowed
      const validProfile = {
        id: 'p-3',
        browser_type: 'chromium',
      };
      expect(sanitizeProfileEngine(validProfile)).toEqual(validProfile);
    });

    it('migrates profile engine to chromium when mode is "migrate"', () => {
      const profile = {
        id: 'p-4',
        name: 'Legacy Profile',
        browser_type: 'camoufox',
        engine: 'camoufox',
      };

      const migrated = sanitizeProfileEngine(profile, { mode: 'migrate', fallbackEngine: 'chromium' });
      expect(migrated.browser_type).toBe('chromium');
      expect(migrated.engine).toBe('chromium');
    });
  });

  describe('denyCamoufoxBundleDownload', () => {
    it('blocks download requests for camoufox / firefox bundles', () => {
      expect(() => {
        denyCamoufoxBundleDownload('https://github.com/release/camoufox-win64.zip');
      }).toThrowError(UnsupportedEngineError);

      expect(() => {
        denyCamoufoxBundleDownload('camoufox-linux.tar.gz');
      }).toThrowError(UnsupportedEngineError);

      expect(() => {
        denyCamoufoxBundleDownload('https://example.com/firefox-browser-bundle.zip');
      }).toThrowError(UnsupportedEngineError);

      // Chromium bundles allowed
      expect(() => {
        denyCamoufoxBundleDownload('https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/chrome-win.zip');
      }).not.toThrow();
    });
  });

  describe('engineDenialMiddleware', () => {
    it('returns HTTP 422 JSON response when request contains denied engine', () => {
      let statusCalledWith = 0;
      let jsonPayload: unknown = null;
      let nextCalled = false;

      const mockReq = {
        body: { browser_type: 'camoufox' },
        query: {},
        headers: {},
      } as unknown as Request;

      const mockRes = {
        status: (code: number) => {
          statusCalledWith = code;
          return {
            json: (payload: unknown) => {
              jsonPayload = payload;
            },
          };
        },
      } as unknown as Response;

      const mockNext = () => {
        nextCalled = true;
      };

      engineDenialMiddleware(mockReq, mockRes, mockNext);

      expect(statusCalledWith).toBe(422);
      expect(jsonPayload).toEqual({
        code: CAMOUFOX_ENGINE_REMOVED,
        statusCode: 422,
        error: expect.stringContaining('permanently removed'),
        engine: 'camoufox',
      });
      expect(nextCalled).toBe(false);
    });

    it('passes control to next middleware when request uses supported engine or none', () => {
      let nextCalled = false;
      const mockReq = {
        body: { browser_type: 'chromium' },
        query: {},
        headers: {},
      } as unknown as Request;

      const mockRes = {} as unknown as Response;
      const mockNext = () => {
        nextCalled = true;
      };

      engineDenialMiddleware(mockReq, mockRes, mockNext);
      expect(nextCalled).toBe(true);
    });
  });

  describe('guardRpcEngineCall', () => {
    it('guards RPC/IPC invocations and rejects calls with denied engine', async () => {
      const launchMock = async (params: { profileId: string; browser_type: string }) => {
        return { success: true, profileId: params.profileId };
      };

      const guardedLaunch = guardRpcEngineCall(launchMock);

      // Denied call
      await expect(
        guardedLaunch({ profileId: 'p-100', browser_type: 'camoufox' })
      ).rejects.toThrowError(UnsupportedEngineError);

      // Permitted call
      const result = await guardedLaunch({ profileId: 'p-101', browser_type: 'chromium' });
      expect(result).toEqual({ success: true, profileId: 'p-101' });
    });
  });
});
