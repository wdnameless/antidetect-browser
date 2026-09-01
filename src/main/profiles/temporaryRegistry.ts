import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../config';
import type { LaunchConfig, ProxyInput } from './profileManager';

export interface TemporaryProfileDescriptor {
  id: string;
  name?: string;
  temporary: true;
  userDataDir: string;
  createdAt: number;
  headless?: boolean;
  browserType?: 'chromium' | 'firefox' | string;
  proxy?: ProxyInput | Record<string, unknown>;
  fingerprint?: Record<string, unknown>;
  startUrls?: string[];
  start_urls?: string[];
  launchConfig?: Partial<LaunchConfig>;
}

export interface CreateTemporaryProfileInput {
  name?: string;
  headless?: boolean;
  browser_type?: 'chromium' | 'firefox' | string;
  proxy?: ProxyInput | Record<string, unknown>;
  fingerprint?: Record<string, unknown>;
  startUrls?: string[];
  start_urls?: string[];
  launchConfig?: Partial<LaunchConfig>;
  [key: string]: unknown;
}

export const TEMPORARY_PROFILES_DIRNAME = '.temporary_profiles';

/**
 * Returns root directory where all ephemeral profile dirs live.
 */
export function getTemporaryProfilesRoot(rootDir: string = DATA_DIR): string {
  return path.resolve(rootDir, TEMPORARY_PROFILES_DIRNAME);
}

/**
 * Ensures targetPath is strictly contained inside <rootDir>/.temporary_profiles/<uuid>
 * and cannot escape via traversal (e.g. `../`) or touch persistent dirs (`profiles/`, `preserved_browser_data/`).
 *
 * If throwOnError is true (or when invalid traversal/escape occurs), throws Error.
 * Otherwise returns boolean validity.
 */
export function assertPathContainment(
  targetPath: string,
  rootDir: string = DATA_DIR,
  throwOnError: boolean = false
): boolean {
  if (!targetPath || typeof targetPath !== 'string') {
    if (throwOnError) throw new Error('Invalid path: targetPath must be a non-empty string');
    return false;
  }

  const normalizedTarget = path.resolve(targetPath);
  const tempRoot = getTemporaryProfilesRoot(rootDir);

  // Must start with tempRoot + path.sep
  const tempRootWithSep = tempRoot.endsWith(path.sep) ? tempRoot : tempRoot + path.sep;
  if (!normalizedTarget.startsWith(tempRootWithSep) && normalizedTarget !== tempRoot) {
    if (throwOnError) {
      throw new Error(`Path traversal or escape detected: target ${normalizedTarget} is outside ${tempRoot}`);
    }
    return false;
  }

  // Relative path from tempRoot must not contain '..' and must match a direct child or subpath
  const relative = path.relative(tempRoot, normalizedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    if (throwOnError) {
      throw new Error(`Path traversal or escape detected: relative path ${relative} ascends root`);
    }
    return false;
  }

  // Prevent targets that include forbidden directory segment names
  const segments = relative.split(/[/\\]+/).filter(Boolean);
  const forbiddenSegments = ['profiles', 'preserved_browser_data', 'antidetect.db', 'extensions'];
  for (const seg of segments) {
    if (forbiddenSegments.includes(seg.toLowerCase())) {
      if (throwOnError) {
        throw new Error(`Target path touches forbidden persistent directory segment: ${seg}`);
      }
      return false;
    }
  }

  return true;
}

export class DisposableProfileRegistry {
  private static instance: DisposableProfileRegistry | null = null;
  private registry: Map<string, TemporaryProfileDescriptor> = new Map();

  public static getInstance(): DisposableProfileRegistry {
    if (!DisposableProfileRegistry.instance) {
      DisposableProfileRegistry.instance = new DisposableProfileRegistry();
    }
    return DisposableProfileRegistry.instance;
  }

  public createTemporaryProfile(
    input: CreateTemporaryProfileInput = {},
    rootDir: string = DATA_DIR
  ): TemporaryProfileDescriptor {
    const id = randomUUID();
    const tempRoot = getTemporaryProfilesRoot(rootDir);
    const userDataDir = path.join(tempRoot, id);

    if (!assertPathContainment(userDataDir, rootDir)) {
      throw new Error(`Path containment violation for temporary profile directory: ${userDataDir}`);
    }

    // Ensure parent .temporary_profiles dir exists with restrictive mode if possible
    try {
      fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
      fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    } catch {
      // Best effort directory creation
    }

    const startUrls = input.startUrls || input.start_urls;
    const descriptor: TemporaryProfileDescriptor = {
      id,
      name: input.name || `Temp-${id.slice(0, 8)}`,
      temporary: true,
      userDataDir,
      createdAt: Date.now(),
      headless: Boolean(input.headless),
      browserType: input.browser_type || 'chromium',
      proxy: input.proxy,
      fingerprint: input.fingerprint,
      startUrls,
      start_urls: startUrls,
      launchConfig: input.launchConfig,
    };

    this.registry.set(id, descriptor);
    return descriptor;
  }

  public getTemporaryProfile(id: string): TemporaryProfileDescriptor | undefined {
    if (!id) return undefined;
    return this.registry.get(id);
  }

  public isTemporaryProfile(id: string): boolean {
    if (!id) return false;
    return this.registry.has(id);
  }

  public listTemporaryProfiles(): TemporaryProfileDescriptor[] {
    return Array.from(this.registry.values());
  }

  public unregisterTemporaryProfile(id: string): boolean {
    return this.registry.delete(id);
  }

  public clear(): void {
    this.registry.clear();
  }
}

/**
 * Singleton convenience methods
 */
export const disposableRegistry = DisposableProfileRegistry.getInstance();

export function createTemporaryProfile(
  input: CreateTemporaryProfileInput = {},
  rootDir?: string
): TemporaryProfileDescriptor {
  return disposableRegistry.createTemporaryProfile(input, rootDir);
}

export function getTemporaryProfile(id: string): TemporaryProfileDescriptor | undefined {
  return disposableRegistry.getTemporaryProfile(id);
}

export function isTemporaryProfile(id: string): boolean {
  return disposableRegistry.isTemporaryProfile(id);
}

export function listTemporaryProfiles(): TemporaryProfileDescriptor[] {
  return disposableRegistry.listTemporaryProfiles();
}

export function unregisterTemporaryProfile(id: string): boolean {
  return disposableRegistry.unregisterTemporaryProfile(id);
}

/**
 * Deletes a temporary directory asynchronously with exponential backoff / retry
 * to handle Windows file locks (EBUSY / EPERM / ENOTEMPTY).
 */
export async function cleanTemporaryDirectory(
  dirPath: string,
  maxWaitMs: number = 3000,
  rootDir?: string
): Promise<boolean> {
  if (!dirPath || typeof dirPath !== 'string') {
    return false;
  }

  // If rootDir is not explicitly passed, infer from dirPath parent if possible, or fallback to DATA_DIR
  const targetRoot = rootDir || path.resolve(dirPath, '..', '..');
  const effectiveRoot = assertPathContainment(dirPath, targetRoot) ? targetRoot : DATA_DIR;

  if (!assertPathContainment(dirPath, effectiveRoot)) {
    console.error(`[temporaryRegistry] Refusing to clean unsafe path outside temporary root: ${dirPath}`);
    return false;
  }

  if (!fs.existsSync(dirPath)) {
    return true;
  }

  const startTime = Date.now();
  let delay = 50;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      return !fs.existsSync(dirPath);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        return true;
      }
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 400);
    }
  }

  // Final attempt
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
    return !fs.existsSync(dirPath);
  } catch (err) {
    console.warn(`[temporaryRegistry] Failed to delete temporary dir ${dirPath} after ${maxWaitMs}ms:`, err);
    return false;
  }
}

/**
 * Synchronous variant of directory removal for shutdown hooks / signal traps.
 */
export function cleanTemporaryDirectorySync(
  dirPath: string,
  rootDir: string = DATA_DIR
): boolean {
  if (!dirPath || !assertPathContainment(dirPath, rootDir)) {
    return false;
  }
  if (!fs.existsSync(dirPath)) {
    return true;
  }
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function startupPurgeSweep(
  rootDir: string = DATA_DIR
): Promise<{ purged: string[]; errors: string[] }> {
  const resolved = path.resolve(rootDir);
  const tempRoot = resolved.endsWith(TEMPORARY_PROFILES_DIRNAME)
    ? resolved
    : getTemporaryProfilesRoot(rootDir);
  const baseRootDir = resolved.endsWith(TEMPORARY_PROFILES_DIRNAME)
    ? path.resolve(resolved, '..')
    : rootDir;
  const purged: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(tempRoot)) {
    return { purged, errors };
  }

  try {
    const entries = fs.readdirSync(tempRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const targetDir = path.join(tempRoot, entry.name);

      if (!assertPathContainment(targetDir, baseRootDir)) {
        errors.push(`Skipping unsafe path: ${targetDir}`);
        continue;
      }

      const ok = await cleanTemporaryDirectory(targetDir, 3000, baseRootDir);
      if (ok) {
        purged.push(targetDir);
      } else {
        errors.push(`Failed to purge orphaned directory: ${targetDir}`);
      }
    }
  } catch (err) {
    errors.push(`Startup sweep error: ${(err as Error).message}`);
  }

  return { purged, errors };
}

/**
 * Shutdown cleanup: kills any active temporary browser sessions and deletes their dirs.
 */
export async function shutdownCleanup(rootDir: string = DATA_DIR): Promise<void> {
  const active = disposableRegistry.listTemporaryProfiles();
  for (const descriptor of active) {
    try {
      cleanTemporaryDirectorySync(descriptor.userDataDir, rootDir);
      disposableRegistry.unregisterTemporaryProfile(descriptor.id);
    } catch {
      // Best effort on shutdown
    }
  }
}
