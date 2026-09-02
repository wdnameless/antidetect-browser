import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  verifyAuthenticode,
  findSignTool,
  isWindowsPlatform,
} from '../../../src/main/security/authenticode';

describe('Authenticode Verification', () => {
  it('identifies platform correctly and provides safe fallback', () => {
    expect(typeof isWindowsPlatform()).toBe('boolean');
    const tool = findSignTool();
    // tool is string or null
    expect(tool === null || typeof tool === 'string').toBe(true);
  });

  it('fails gracefully or skips with explicit warning when binary or signtool is missing', () => {
    // Non-existent file
    const nonExistent = path.join(process.cwd(), 'non-existent-binary.dll');
    const res1 = verifyAuthenticode(nonExistent);
    expect(res1.verified).toBe(false);
    expect(res1.error).toContain('File not found');

    // Existing file that is not signed (e.g. package.json or node.exe)
    const pkgJson = path.join(process.cwd(), 'package.json');
    const res2 = verifyAuthenticode(pkgJson);

    // If signtool is missing, skipped is true with warning
    // If signtool is present, verified is false because package.json is not signed
    if (res2.skipped) {
      expect(res2.warning).toBeDefined();
    } else {
      expect(res2.verified).toBe(false);
      expect(res2.error).toBeDefined();
    }
  });
});
