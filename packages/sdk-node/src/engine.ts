import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

// Pinned kernel source and digests.
//
// MIRROR of `src/main/util/kernelAcquire.ts`. The SDK is a published package and
// cannot import from the application's source tree, so the values are duplicated
// deliberately — and a test asserts they match the main-process table, so the two
// cannot drift. They are EXTERNAL and must be re-pinned together when the upstream
// fingerprint-chromium version changes.
export const PINNED_KERNEL_VERSION = '148.0.7778.215';
export const KERNEL_REPO = 'adryfish/fingerprint-chromium';
export const KERNEL_RELEASE_TAG = PINNED_KERNEL_VERSION;
export const KERNEL_DOWNLOAD_BASE = `https://github.com/${KERNEL_REPO}/releases/download/${KERNEL_RELEASE_TAG}`;

export interface KernelAssetInfo {
  asset: string;
  sha256: string;
  size?: number;
  executableSubpath: string;
  archiveType: 'zip' | 'appimage' | 'dmg';
}

export const PINNED_KERNEL_ASSETS: Record<string, KernelAssetInfo> = {
  win32: {
    asset: `ungoogled-chromium_${PINNED_KERNEL_VERSION}-1.1_windows_x64.zip`,
    sha256: '9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579',
    size: 189767686,
    executableSubpath: path.join(`ungoogled-chromium_${PINNED_KERNEL_VERSION}-1.1_windows_x64`, 'chrome.exe'),
    archiveType: 'zip',
  },
  linux: {
    asset: `ungoogled-chromium-${PINNED_KERNEL_VERSION}-1-x86_64.AppImage`,
    sha256: 'a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0',
    size: 188811768,
    executableSubpath: `ungoogled-chromium-${PINNED_KERNEL_VERSION}-1-x86_64.AppImage`,
    archiveType: 'appimage',
  },
  darwin: {
    asset: `ungoogled-chromium_${PINNED_KERNEL_VERSION}-1.1_macos.dmg`,
    sha256: 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679',
    size: 140187500,
    executableSubpath: path.join('Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    archiveType: 'dmg',
  },
};

export class EngineAcquireError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'EngineAcquireError';
    this.code = code;
  }
}

export interface EnsureEngineOptions {
  platform?: NodeJS.Platform;
  targetDir?: string;
  expectedDigests?: Record<string, KernelAssetInfo>;
  fetchFn?: typeof fetch;
  onProgress?: (progress: { received: number; total: number }) => void;
  force?: boolean;
}

export function getDefaultEngineDir(): string {
  const envDir = process.env.ANTIDETECT_DATA_DIR;
  if (envDir && envDir.length > 0) {
    return path.join(envDir, 'chromium');
  }
  return path.join(os.homedir(), '.antidetect', 'chromium');
}

/**
 * Extract a zip file using system tar or unzip.
 */
function extractZipArchive(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // Use system tar which handles zip files on modern Windows (bsdtar) and Unix
    const child = spawn('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'pipe' });
    child.on('error', (err) => {
      reject(new EngineAcquireError(`Failed to extract zip archive via tar: ${err.message}`, 'ERR_EXTRACTION_FAILED'));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new EngineAcquireError(`Extraction failed with exit code ${code}`, 'ERR_EXTRACTION_FAILED'));
      }
    });
  });
}

/**
 * Ensure platform-correct patched Chromium engine binary is present and verified.
 * Idempotent: caches downloaded and verified engine, subsequent calls return immediately.
 */
export async function ensureEngine(opts: EnsureEngineOptions = {}): Promise<{ executable: string; kernelDir: string }> {
  const platform = opts.platform ?? process.platform;
  const assets = opts.expectedDigests ?? PINNED_KERNEL_ASSETS;
  const assetInfo = assets[platform];

  if (!assetInfo) {
    throw new EngineAcquireError(
      `Unsupported platform: ${platform}. Supported: ${Object.keys(assets).join(', ')}`,
      'ERR_UNSUPPORTED_PLATFORM'
    );
  }

  const baseDir = opts.targetDir ?? getDefaultEngineDir();
  const kernelDir = path.join(baseDir, PINNED_KERNEL_VERSION);
  const executable = path.join(kernelDir, assetInfo.executableSubpath);

  // Fast path: if executable exists and not forced, return cached
  if (!opts.force && fs.existsSync(executable)) {
    return { executable, kernelDir };
  }

  fs.mkdirSync(kernelDir, { recursive: true });

  const downloadUrl = `${KERNEL_DOWNLOAD_BASE}/${assetInfo.asset}`;
  const tmpDownloadPath = path.join(kernelDir, `${assetInfo.asset}.tmp.${Date.now()}`);

  const customFetch = opts.fetchFn ?? fetch;

  try {
    const response = await customFetch(downloadUrl);
    if (!response.ok) {
      throw new EngineAcquireError(
        `Failed to download engine from ${downloadUrl}: ${response.status} ${response.statusText}`,
        'ERR_DOWNLOAD_FAILED'
      );
    }

    const totalLength = Number(response.headers.get('content-length')) || assetInfo.size || 0;
    let receivedLength = 0;

    const hasher = crypto.createHash('sha256');
    const fileStream = fs.createWriteStream(tmpDownloadPath);

    const body = response.body;
    if (body && typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
      const reader = (body as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          hasher.update(value);
          fileStream.write(Buffer.from(value));
          receivedLength += value.length;
          opts.onProgress?.({ received: receivedLength, total: totalLength });
        }
      }
      await new Promise<void>((res, rej) => {
        fileStream.end((err?: Error | null) => (err ? rej(err) : res()));
      });
    } else if (body && typeof (body as any).on === 'function') {
      const nodeStream = body as any;
      await new Promise<void>((res, rej) => {
        nodeStream.on('data', (chunk: Buffer) => {
          hasher.update(chunk);
          fileStream.write(chunk);
          receivedLength += chunk.length;
          opts.onProgress?.({ received: receivedLength, total: totalLength });
        });
        nodeStream.on('error', (err: unknown) => rej(err));
        nodeStream.on('end', () => {
          fileStream.end((err?: Error | null) => (err ? rej(err) : res()));
        });
      });
    } else {
      const arrayBuffer = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      hasher.update(buf);
      await fs.promises.writeFile(tmpDownloadPath, buf);
      opts.onProgress?.({ received: buf.length, total: buf.length });
    }

    const actualSha256 = hasher.digest('hex');
    const expectedSha256 = assetInfo.sha256;

    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      try {
        fs.unlinkSync(tmpDownloadPath);
      } catch {
        // ignore
      }
      throw new EngineAcquireError(
        `Engine digest mismatch for ${assetInfo.asset}: expected ${expectedSha256}, got ${actualSha256}`,
        'ERR_DIGEST_MISMATCH'
      );
    }

    // Extraction / preparation
    if (assetInfo.archiveType === 'zip') {
      await extractZipArchive(tmpDownloadPath, kernelDir);
    } else if (assetInfo.archiveType === 'appimage') {
      if (platform === 'linux') {
        fs.mkdirSync(path.dirname(executable), { recursive: true });
        fs.copyFileSync(tmpDownloadPath, executable);
        try {
          fs.chmodSync(executable, 0o755);
        } catch {
          // ignore
        }
      } else {
        throw new EngineAcquireError(
          `AppImage extraction for ${platform} is not supported on host OS ${process.platform}`,
          'ERR_UNSUPPORTED_HOST_EXTRACTION'
        );
      }
    } else if (assetInfo.archiveType === 'dmg') {
      throw new EngineAcquireError(
        'macOS DMG extraction requires manual mount or hdiutil workflow',
        'ERR_UNSUPPORTED_HOST_EXTRACTION'
      );
    } else {
      throw new EngineAcquireError(`Unsupported archive type: ${assetInfo.archiveType}`, 'ERR_UNSUPPORTED_ARCHIVE');
    }

    // Clean up temporary download file
    try {
      fs.unlinkSync(tmpDownloadPath);
    } catch {
      // ignore
    }

    if (!fs.existsSync(executable)) {
      throw new EngineAcquireError(
        `Engine extracted successfully but executable not found at expected path: ${executable}`,
        'ERR_EXECUTABLE_NOT_FOUND'
      );
    }

    return { executable, kernelDir };
  } catch (err) {
    if (fs.existsSync(tmpDownloadPath)) {
      try {
        fs.unlinkSync(tmpDownloadPath);
      } catch {
        // ignore
      }
    }
    if (err instanceof EngineAcquireError) {
      throw err;
    }
    throw new EngineAcquireError(
      `Failed to acquire engine: ${err instanceof Error ? err.message : String(err)}`,
      'ERR_ACQUIRE_FAILED'
    );
  }
}
