import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import AdmZip from 'adm-zip';
import { listZipEntries, extractZipStreaming, ZipExtractError } from '../../src/main/android/zipExtract';

/**
 * The streaming extractor exists because `AdmZip.extractAllTo` cannot materialise an entry larger
 * than 2 GiB — the AOSP android-34 system image contains `x86_64/system.img` at ~2.89 GiB. The
 * >2 GiB case cannot be reproduced in a unit test (it would need a 3 GB fixture), so these tests
 * cover the parsing, integrity and safety behaviour that the same code path exercises.
 */
describe('Android zip extraction', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-extract-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeZip(entries: Record<string, string>): string {
    const zip = new AdmZip();
    for (const [entryPath, content] of Object.entries(entries)) {
      zip.addFile(entryPath, Buffer.from(content, 'utf8'));
    }
    const zipPath = path.join(tmpDir, 'fixture.zip');
    zip.writeZip(zipPath);
    return zipPath;
  }

  /**
   * Builds a stored (uncompressed) archive by hand. AdmZip sanitises entry names on write, so it
   * cannot produce the hostile names these tests need to feed the extractor.
   */
  function rawZip(entries: Array<{ name: string; content: string }>): Buffer {
    const local: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const data = Buffer.from(entry.content, 'utf8');
      const crc = zlib.crc32(data);

      const lfh = Buffer.alloc(30);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(20, 4);
      lfh.writeUInt16LE(0, 8);
      lfh.writeUInt32LE(crc, 14);
      lfh.writeUInt32LE(data.length, 18);
      lfh.writeUInt32LE(data.length, 22);
      lfh.writeUInt16LE(nameBuf.length, 26);
      local.push(lfh, nameBuf, data);

      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(0x031e, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(data.length, 20);
      cd.writeUInt32LE(data.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt32LE(0, 38);
      cd.writeUInt32LE(offset, 42);
      central.push(cd, nameBuf);

      offset += lfh.length + nameBuf.length + data.length;
    }

    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, cdBuf, eocd]);
  }

  it('lists entry names without decompressing them', async () => {
    const zipPath = writeZip({
      'emulator/.installed': '1',
      'emulator/bin/emulator.exe': 'binary',
    });
    const names = await listZipEntries(zipPath);
    expect(names.sort()).toEqual(['emulator/.installed', 'emulator/bin/emulator.exe']);
  });

  it('extracts nested entries byte-for-byte', async () => {
    const payload = 'x'.repeat(4096);
    const zipPath = writeZip({
      'x86_64/system.img': payload,
      'x86_64/nested/deep/kernel-ranchu': 'kernel',
      'x86_64/source.properties': 'ro.build.version.sdk=34',
    });

    const destDir = path.join(tmpDir, 'out');
    await extractZipStreaming(zipPath, destDir);

    expect(fs.readFileSync(path.join(destDir, 'x86_64', 'system.img'), 'utf8')).toBe(payload);
    expect(fs.readFileSync(path.join(destDir, 'x86_64', 'nested', 'deep', 'kernel-ranchu'), 'utf8')).toBe('kernel');
    expect(fs.readFileSync(path.join(destDir, 'x86_64', 'source.properties'), 'utf8')).toBe('ro.build.version.sdk=34');
  });

  it('round-trips binary content unchanged', async () => {
    const binary = Buffer.from(Array.from({ length: 100_000 }, (_, i) => i % 256));
    const zip = new AdmZip();
    zip.addFile('image/system.img', binary);
    const zipPath = path.join(tmpDir, 'binary.zip');
    zip.writeZip(zipPath);

    const destDir = path.join(tmpDir, 'out');
    await extractZipStreaming(zipPath, destDir);

    const extracted = fs.readFileSync(path.join(destDir, 'image', 'system.img'));
    expect(extracted.length).toBe(binary.length);
    expect(extracted.equals(binary)).toBe(true);
  });

  it('refuses a forward-slash traversal entry', async () => {
    const zipPath = path.join(tmpDir, 'trav-fwd.zip');
    fs.writeFileSync(zipPath, rawZip([{ name: '../escaped.txt', content: 'pwned' }]));
    const destDir = path.join(tmpDir, 'out');

    await expect(extractZipStreaming(zipPath, destDir)).rejects.toThrow(ZipExtractError);
    expect(fs.existsSync(path.join(tmpDir, 'escaped.txt'))).toBe(false);
  });

  it('refuses a backslash traversal entry on Windows', async () => {
    const zipPath = path.join(tmpDir, 'trav-back.zip');
    fs.writeFileSync(zipPath, rawZip([{ name: '..\\escaped.txt', content: 'pwned' }]));
    const destDir = path.join(tmpDir, 'out');

    await expect(extractZipStreaming(zipPath, destDir)).rejects.toMatchObject({ code: 'ERR_ZIP_UNSAFE_ENTRY' });
    expect(fs.existsSync(path.join(tmpDir, 'escaped.txt'))).toBe(false);
  });

  it('refuses a drive-qualified absolute entry name', async () => {
    const zipPath = path.join(tmpDir, 'trav-abs.zip');
    fs.writeFileSync(zipPath, rawZip([{ name: 'C:/Windows/Temp/pwned.txt', content: 'pwned' }]));
    const destDir = path.join(tmpDir, 'out');

    await expect(extractZipStreaming(zipPath, destDir)).rejects.toMatchObject({ code: 'ERR_ZIP_UNSAFE_ENTRY' });
  });

  it('rejects an entry whose stored CRC does not match its content', async () => {
    const good = rawZip([{ name: 'x86_64/system.img', content: 'integrity matters' }]);
    const corrupted = Buffer.from(good);
    // The CRC lives in the local header at offset 14 and again in the central directory; corrupt
    // the recorded CRC rather than the payload so the mismatch is unambiguous.
    const corruptCrc = corrupted.readUInt32LE(14) ^ 0xffffffff;
    corrupted.writeUInt32LE(corruptCrc, 14);
    const cdStart = corrupted.indexOf(Buffer.from('PK\x01\x02'));
    expect(cdStart).toBeGreaterThan(0);
    corrupted.writeUInt32LE(corruptCrc, cdStart + 16);

    const zipPath = path.join(tmpDir, 'bad-crc.zip');
    fs.writeFileSync(zipPath, corrupted);
    const destDir = path.join(tmpDir, 'out');

    await expect(extractZipStreaming(zipPath, destDir)).rejects.toMatchObject({ code: 'ERR_ZIP_CRC_MISMATCH' });
  });

  it('creates directory entries as directories', async () => {
    const zip = new AdmZip();
    zip.addFile('x86_64/data/', Buffer.alloc(0));
    zip.addFile('x86_64/data/local.prop', Buffer.from('qemu=1', 'utf8'));
    const zipPath = path.join(tmpDir, 'dirs.zip');
    zip.writeZip(zipPath);

    const destDir = path.join(tmpDir, 'out');
    await extractZipStreaming(zipPath, destDir);

    expect(fs.statSync(path.join(destDir, 'x86_64', 'data')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(destDir, 'x86_64', 'data', 'local.prop'), 'utf8')).toBe('qemu=1');
  });
});
