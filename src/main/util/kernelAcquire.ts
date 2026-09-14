// Pinned browser kernel assets and SHA256 digests.
// NOTE: These digests are external and pinned for upstream release 148.0.7778.215.
// They MUST be re-pinned when the upstream fingerprint-chromium version changes.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import { CHROMIUM_DIR } from '../config';

export const PINNED_KERNEL_VERSION = '148.0.7778.215';
export const UPSTREAM_RELEASE_BASE_URL = `https://github.com/adryfish/fingerprint-chromium/releases/download/${PINNED_KERNEL_VERSION}`;

export interface KernelAssetInfo {
  asset: string;
  size: number;
  sha256: string;
  archiveType: 'zip' | 'appimage' | 'tar.xz' | 'dmg';
  executableSubpath: string;
}

export const PINNED_PLATFORM_ASSETS: Record<string, KernelAssetInfo> = {
  win32: {
    asset: `ungoogled-chromium_${PINNED_KERNEL_VERSION}-1.1_windows_x64.zip`,
    size: 189767686,
    sha256: '9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579',
    archiveType: 'zip',
    executableSubpath: path.join(`ungoogled-chromium_${PINNED_KERNEL_VERSION}-1.1_windows_x64`, 'chrome.exe'),
  },
  linux: {
    asset: `ungoogled-chromium-${PINNED_KERNEL_VERSION}-1-x86_64.AppImage`,
    size: 188811768,
    sha256: 'a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0',
    archiveType: 'appimage',
    executableSubpath: `ungoogled-chromium-${PINNED_KERNEL_VERSION}-1-x86_64.AppImage`,
  },
  darwin: {
    asset: `ungoogled-chromium_${PINNED_KERNEL_VERSION}-1.1_macos.dmg`,
    size: 140187500,
    sha256: 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679',
    archiveType: 'dmg',
    executableSubpath: path.join('Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  },
};

export class KernelAcquireError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'KernelAcquireError';
  }
}

export interface EnsureKernelOptions {
  onProgress?: (p: { received: number; total: number }) => void;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  platform?: NodeJS.Platform;
  targetDir?: string;
  expectedDigests?: Record<string, KernelAssetInfo>;
}

export function getPlatformAsset(
  platform: NodeJS.Platform = process.platform,
  assets: Record<string, KernelAssetInfo> = PINNED_PLATFORM_ASSETS
): KernelAssetInfo {
  const assetInfo = assets[platform];
  if (!assetInfo) {
    throw new KernelAcquireError(`Unsupported platform for kernel acquisition: ${platform}`, 'ERR_UNSUPPORTED_PLATFORM');
  }
  return assetInfo;
}

export function getKernelDirectory(overrideDir?: string): string {
  return overrideDir ?? path.join(CHROMIUM_DIR, 'fingerprint-chromium');
}

/**
 * Ensures the browser kernel is present, downloaded, verified, and extracted.
 * Fails closed on hash mismatch, network failure, or truncation.
 */
export async function ensureKernel(opts: EnsureKernelOptions = {}): Promise<{ executablePath: string; kernelDir: string }> {
  const platform = opts.platform ?? process.platform;
  const assets = opts.expectedDigests ?? PINNED_PLATFORM_ASSETS;
  const assetInfo = getPlatformAsset(platform, assets);
  const kernelDir = getKernelDirectory(opts.targetDir);
  const executablePath = path.join(kernelDir, assetInfo.executableSubpath);

  // If kernel is already present and executable exists, return early without downloading
  if (fs.existsSync(executablePath)) {
    return { executablePath, kernelDir };
  }

  const fetchImpl = opts.fetchFn ?? fetch;
  const downloadUrl = `${UPSTREAM_RELEASE_BASE_URL}/${assetInfo.asset}`;

  fs.mkdirSync(kernelDir, { recursive: true });

  const tmpDownloadPath = path.join(kernelDir, `.download-${Date.now()}-${assetInfo.asset}.tmp`);

  try {
    let res;
    try {
      res = await fetchImpl(downloadUrl, {
        signal: opts.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'antidetect-browser/kernelAcquire' },
      });
    } catch (netErr: unknown) {
      if (opts.signal?.aborted) {
        throw new KernelAcquireError('Kernel download aborted', 'ERR_ABORTED');
      }
      const message = netErr instanceof Error ? netErr.message : String(netErr);
      throw new KernelAcquireError(
        `Cannot acquire browser kernel: no network connection available (${message})`,
        'ERR_NO_NETWORK'
      );
    }

    if (!res.ok || !res.body) {
      throw new KernelAcquireError(`Kernel download failed with HTTP ${res.status}: ${res.statusText}`, 'ERR_HTTP');
    }

    const contentLengthHeader = res.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : assetInfo.size;

    const hash = crypto.createHash('sha256');
    const writeStream = fs.createWriteStream(tmpDownloadPath);

    let receivedBytes = 0;

    await new Promise<void>((resolve, reject) => {
      res.body.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        hash.update(chunk);
        opts.onProgress?.({ received: receivedBytes, total: totalBytes });
      });

      res.body.on('error', (err: Error) => {
        reject(new KernelAcquireError(`Kernel download interrupted: ${err.message}`, 'ERR_STREAM'));
      });

      writeStream.on('error', (err: Error) => {
        reject(new KernelAcquireError(`Failed to write kernel download: ${err.message}`, 'ERR_FS_WRITE'));
      });

      writeStream.on('finish', () => {
        resolve();
      });

      res.body.pipe(writeStream);
    });

    const actualSha256 = hash.digest('hex').toLowerCase();
    const expectedSha256 = assetInfo.sha256.toLowerCase();

    if (actualSha256 !== expectedSha256) {
      // Fail closed: Remove the corrupted payload immediately so nothing usable or broken remains
      try {
        fs.unlinkSync(tmpDownloadPath);
      } catch {
        // ignore unlink error
      }
      throw new KernelAcquireError(
        `Kernel digest mismatch for ${assetInfo.asset}: expected ${expectedSha256}, got ${actualSha256}`,
        'ERR_DIGEST_MISMATCH'
      );
    }

    // Verification succeeded: Extract or prepare binary
    if (assetInfo.archiveType === 'zip') {
      try {
        const zip = new AdmZip(tmpDownloadPath);
        zip.extractAllTo(kernelDir, true);
      } catch (extractErr: unknown) {
        const message = extractErr instanceof Error ? extractErr.message : String(extractErr);
        throw new KernelAcquireError(`Failed to extract kernel zip archive: ${message}`, 'ERR_EXTRACTION_FAILED');
      }
    } else if (assetInfo.archiveType === 'appimage') {
      // For AppImage on Linux, moving it to executable location and making it executable
      if (platform === 'linux') {
        const dest = executablePath;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(tmpDownloadPath, dest);
        try {
          fs.chmodSync(dest, 0o755);
        } catch {
          // ignore chmod errors if running on unsupported FS
        }
      } else {
        throw new KernelAcquireError(
          `AppImage extraction for ${platform} is not supported on host OS ${process.platform}`,
          'ERR_UNSUPPORTED_HOST_EXTRACTION'
        );
      }
    } else if (assetInfo.archiveType === 'dmg') {
      // macOS dmg requires hdiutil which only runs on darwin
      if (platform === 'darwin' && process.platform === 'darwin') {
        // native mount handling would go here on Darwin
        throw new KernelAcquireError('macOS DMG extraction requires manual mount or hdiutil workflow', 'ERR_UNSUPPORTED_HOST_EXTRACTION');
      } else {
        throw new KernelAcquireError(
          `macOS DMG extraction is not supported on host OS ${process.platform}`,
          'ERR_UNSUPPORTED_HOST_EXTRACTION'
        );
      }
    } else {
      throw new KernelAcquireError(`Unsupported archive type: ${assetInfo.archiveType}`, 'ERR_UNSUPPORTED_ARCHIVE');
    }

    // Clean up temporary download file after successful extraction
    try {
      fs.unlinkSync(tmpDownloadPath);
    } catch {
      // ignore
    }

    if (!fs.existsSync(executablePath)) {
      throw new KernelAcquireError(
        `Kernel extracted successfully but executable not found at expected path: ${executablePath}`,
        'ERR_EXECUTABLE_NOT_FOUND'
      );
    }

    return { executablePath, kernelDir };
  } catch (err) {
    // Fail closed: clean up tmp download file if it exists
    if (fs.existsSync(tmpDownloadPath)) {
      try {
        fs.unlinkSync(tmpDownloadPath);
      } catch {
        // ignore
      }
    }
    throw err;
  }
}
