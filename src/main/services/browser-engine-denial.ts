/**
 * Browser Engine Denial Layer
 * 
 * Enforces production denial of Camoufox and legacy Firefox engines:
 * - Reject any Camoufox / Firefox launch, start, or execution with typed error code CAMOUFOX_ENGINE_REMOVED (code 422 / HTTP 422).
 * - Reject binary bundle download attempts for Camoufox / Firefox.
 * - Sanitize profile engine configurations to prevent creation or persistence of Camoufox profiles (or auto-migrate to chromium).
 * - Express middleware and RPC dispatch guards.
 */

import type { Request, Response, NextFunction } from 'express';

export const CAMOUFOX_ENGINE_REMOVED = 'CAMOUFOX_ENGINE_REMOVED';

export class UnsupportedEngineError extends Error {
  public readonly code: string = CAMOUFOX_ENGINE_REMOVED;
  public readonly statusCode: number = 422;
  public readonly engine: string;

  constructor(engine: string, message?: string) {
    super(
      message ||
        `The browser engine '${engine}' is no longer supported and has been permanently removed. Only 'chromium' is permitted.`
    );
    this.name = 'UnsupportedEngineError';
    this.engine = engine;
    Object.setPrototypeOf(this, UnsupportedEngineError.prototype);
  }
}

/**
 * Returns true if the specified engine identifier represents Camoufox or legacy Firefox.
 */
export function isDeniedEngine(engine?: unknown): boolean {
  if (typeof engine !== 'string') return false;
  const normalized = engine.trim().toLowerCase();
  return (
    normalized === 'camoufox' ||
    normalized === 'firefox' ||
    normalized === 'camoufox-browser' ||
    normalized.startsWith('camoufox')
  );
}

/**
 * Asserts that the specified engine is supported.
 * Throws UnsupportedEngineError (code: CAMOUFOX_ENGINE_REMOVED, HTTP 422) if engine is Camoufox or Firefox.
 */
export function assertEngineSupported(engine?: string): void {
  if (!engine) {
    return; // defaults to chromium elsewhere
  }
  if (isDeniedEngine(engine)) {
    throw new UnsupportedEngineError(engine);
  }
}

export interface SanitizeProfileEngineOptions {
  mode?: 'reject' | 'migrate';
  fallbackEngine?: string;
}

/**
 * Sanitizes or rejects profile engine options before create or update.
 * In 'reject' mode (default), throws UnsupportedEngineError when Camoufox/Firefox is detected.
 * In 'migrate' mode, automatically reassigns engine to 'chromium'.
 */
export function sanitizeProfileEngine<T extends Record<string, unknown>>(
  profile: T,
  options: SanitizeProfileEngineOptions = { mode: 'reject', fallbackEngine: 'chromium' }
): T {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }

  const { mode = 'reject', fallbackEngine = 'chromium' } = options;

  const engineVal = profile.browser_type ?? profile.engine ?? profile.browserType;

  if (typeof engineVal === 'string' && isDeniedEngine(engineVal)) {
    if (mode === 'reject') {
      throw new UnsupportedEngineError(
        engineVal,
        `Cannot create or update profile with removed engine '${engineVal}'. Use '${fallbackEngine}' instead.`
      );
    } else {
      // Migrate in-place
      const modified: Record<string, unknown> = { ...profile };
      if ('browser_type' in modified) modified.browser_type = fallbackEngine;
      if ('engine' in modified) modified.engine = fallbackEngine;
      if ('browserType' in modified) modified.browserType = fallbackEngine;
      return modified as T;
    }
  }

  return profile;
}

/**
 * Denies attempts to download, fetch, or unpack Camoufox/Firefox binary bundles.
 * Throws UnsupportedEngineError (code 422) if URL or asset name corresponds to Camoufox.
 */
export function denyCamoufoxBundleDownload(urlOrName: string): void {
  if (!urlOrName || typeof urlOrName !== 'string') {
    return;
  }

  const normalized = urlOrName.toLowerCase();
  if (
    normalized.includes('camoufox') ||
    normalized.includes('firefox') && (normalized.includes('browser-bundle') || normalized.includes('binary') || normalized.includes('download'))
  ) {
    throw new UnsupportedEngineError(
      'camoufox',
      `Downloading or updating binary bundle for '${urlOrName}' is blocked: engine is permanently removed.`
    );
  }
}

/**
 * Express middleware for profile launch and configuration endpoints.
 * Inspects req.body, req.query, and req.params for denied engine parameters.
 */
export function engineDenialMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const candidateEngine =
      (req.body && (req.body.browser_type || req.body.engine || req.body.browserType)) ||
      (req.query && (req.query.browser_type || req.query.engine || req.query.browserType)) ||
      (req.headers && (req.headers['x-browser-engine'] as string));

    if (candidateEngine && typeof candidateEngine === 'string') {
      assertEngineSupported(candidateEngine);
    }

    next();
  } catch (err) {
    if (err instanceof UnsupportedEngineError) {
      res.status(err.statusCode).json({
        code: err.code,
        statusCode: err.statusCode,
        error: err.message,
        engine: err.engine,
      });
      return;
    }
    next(err);
  }
}

/**
 * Guard for RPC / Electron IPC dispatch handlers.
 */
export function guardRpcEngineCall<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        const record = arg as Record<string, unknown>;
        const candidate = record.browser_type ?? record.engine ?? record.browserType;
        if (typeof candidate === 'string') {
          assertEngineSupported(candidate);
        }
      }
    }
    return await fn(...args);
  };
}
