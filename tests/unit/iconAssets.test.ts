import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  // IHDR chunk starts at byte 8 (length: 4, type: 4 'IHDR', width: 4, height: 4)
  const ihdrType = buf.subarray(12, 16).toString('ascii');
  expect(ihdrType).toBe('IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

describe('NullTrace Icon Assets & Specifications', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('SVG master exists, is non-empty, and parses as valid XML', () => {
    const svgPath = path.join(rootDir, 'assets/brand/nulltrace-icon.svg');
    expect(fs.existsSync(svgPath)).toBe(true);
    const content = fs.readFileSync(svgPath, 'utf8');
    const trimmed = content.trim();
    expect(trimmed.startsWith('<svg')).toBe(true);
    expect(trimmed.endsWith('</svg>')).toBe(true);
    expect(content).toContain('viewBox="0 0 1024 1024"');
    expect(content).toContain('<circle cx="512" cy="512"');
    expect(content).toContain('feTurbulence');
  });

  it('All generated PNG assets exist with exact expected dimensions', () => {
    const pngSpecs: [string, number][] = [
      ['assets/brand/nulltrace-icon.1024.png', 1024],
      ['assets/brand/nulltrace-icon.512.png', 512],
      ['assets/brand/nulltrace-icon.256.png', 256],
      ['assets/brand/nulltrace-icon.128.png', 128],
      ['assets/brand/nulltrace-icon.64.png', 64],
      ['assets/brand/nulltrace-icon.32.png', 32],
      ['assets/brand/nulltrace-icon.16.png', 16],
      ['resources/icon.png', 256],
      ['resources/tray-icon.png', 32],
      ['assets/brand/favicon.png', 32],
    ];

    for (const [relPath, expectedDim] of pngSpecs) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Missing file: ${relPath}`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size).toBeGreaterThan(0);
      const { width, height } = readPngDimensions(fullPath);
      expect(width).toBe(expectedDim);
      expect(height).toBe(expectedDim);
    }
  });

  it('.ico container exists and contains multiple embedded icon sizes', () => {
    const icoPaths = [
      'assets/brand/nulltrace-icon.ico',
      'assets/brand/favicon.ico',
      'build/icon.ico',
      'release/.icon-ico/icon.ico',
    ];

    for (const relPath of icoPaths) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Missing ICO: ${relPath}`).toBe(true);
      const buf = fs.readFileSync(fullPath);
      expect(buf.length).toBeGreaterThan(500);

      // ICO header: reserved=0 (2 bytes), type=1 (2 bytes), image_count (2 bytes)
      const reserved = buf.readUInt16LE(0);
      const type = buf.readUInt16LE(2);
      const imageCount = buf.readUInt16LE(4);

      expect(reserved).toBe(0);
      expect(type).toBe(1); // 1 = ICO
      expect(imageCount).toBeGreaterThanOrEqual(4); // at least 16, 32, 48, 64, 128, 256
    }
  });

  it('.icns container has valid magic header and plausible length matching header', () => {
    const icnsPaths = [
      'assets/brand/nulltrace-icon.icns',
      'build/icon.icns',
    ];

    for (const relPath of icnsPaths) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Missing ICNS: ${relPath}`).toBe(true);
      const buf = fs.readFileSync(fullPath);
      expect(buf.length).toBeGreaterThan(10000);

      const magic = buf.subarray(0, 4).toString('ascii');
      expect(magic).toBe('icns');
      const totalLen = buf.readUInt32BE(4);
      expect(totalLen).toBe(buf.length);
    }
  });
});
