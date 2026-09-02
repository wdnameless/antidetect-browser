import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface AuthenticodeResult {
  verified: boolean;
  signer?: string;
  timestamp?: string;
  error?: string;
  warning?: string;
  skipped?: boolean;
}

/**
 * Check if running on Windows platform.
 */
export function isWindowsPlatform(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if signtool.exe is available in PATH or Windows SDK paths.
 */
export function findSignTool(): string | null {
  if (!isWindowsPlatform()) {
    return null;
  }

  // First check where.exe signtool
  try {
    const out = execSync('where.exe signtool.exe', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
    const lines = out.split(/\r?\n/);
    if (lines.length > 0 && lines[0] && fs.existsSync(lines[0])) {
      return lines[0];
    }
  } catch {
    // Continue checking standard paths
  }

  // Check typical Windows SDK paths
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const sdkRoot = path.join(programFilesX86, 'Windows Kits', '10', 'bin');
  if (fs.existsSync(sdkRoot)) {
    try {
      const versions = fs.readdirSync(sdkRoot);
      // Look for latest x64 signtool
      for (const ver of versions.reverse()) {
        const candidate = path.join(sdkRoot, ver, 'x64', 'signtool.exe');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Verify Authenticode signature for a PE (.exe, .dll) file.
 * If signtool is missing or non-Windows, emits a graceful explicit warning rather than hard crash.
 */
export function verifyAuthenticode(filePath: string): AuthenticodeResult {
  if (!fs.existsSync(filePath)) {
    return {
      verified: false,
      error: `File not found: ${filePath}`,
    };
  }

  if (!isWindowsPlatform()) {
    return {
      verified: true,
      skipped: true,
      warning: `Authenticode check skipped: platform is '${process.platform}', not Windows (win32).`,
    };
  }

  const signtoolPath = findSignTool();
  if (!signtoolPath) {
    return {
      verified: true,
      skipped: true,
      warning: `signtool.exe not found on system. Authenticode signature verification was bypassed with warning. Install Windows SDK to enforce Authenticode verification.`,
    };
  }

  try {
    // Run signtool verify /pa /v <filePath>
    // /pa uses Default Authenticode Policy
    const out = execSync(`"${signtoolPath}" verify /pa /v "${filePath}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');

    return {
      verified: true,
      signer: out.includes('Issued to:') ? out.split('Issued to:')[1].split('\n')[0].trim() : undefined,
    };
  } catch (err: unknown) {
    const errorOutput = (err as { stdout?: Buffer; stderr?: Buffer }).stdout?.toString('utf8') ||
      (err as { stdout?: Buffer; stderr?: Buffer }).stderr?.toString('utf8') ||
      (err as Error).message;

    return {
      verified: false,
      error: `Authenticode verification failed for ${path.basename(filePath)}: ${errorOutput.trim()}`,
    };
  }
}
