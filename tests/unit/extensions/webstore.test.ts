import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  normalizeWebStoreInput,
  verifyCrx,
  fetchCrx,
  unpackCrx,
  installFromWebStore,
  setFetchCrxTransport,
  resetFetchCrxTransport,
  WebStoreError,
} from '../../../src/main/extensions/webstore';
import * as em from '../../../src/main/extensions/extensionManager';

// Helper to create a minimal valid zip file buffer in memory
function createMinimalZip(files: Record<string, string | Buffer>): Buffer {
  // We construct standard PK zip entries
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const [filename, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(filename, 'utf-8');
    const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');

    // CRC32 calculation
    let crc = 0 ^ -1;
    for (let i = 0; i < dataBuf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ dataBuf[i]) & 0xff];
    }
    crc = (crc ^ -1) >>> 0;

    // Local file header (30 bytes + name + data)
    const local = Buffer.alloc(30 + nameBuf.length + dataBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // Local header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0, 6); // general purpose bit flag
    local.writeUInt16LE(0, 8); // compression method (0 = store)
    local.writeUInt16LE(0, 10); // file last mod time
    local.writeUInt16LE(0, 12); // file last mod date
    local.writeUInt32LE(crc, 14); // crc-32
    local.writeUInt32LE(dataBuf.length, 18); // compressed size
    local.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // file name length
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);
    dataBuf.copy(local, 30 + nameBuf.length);

    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // Central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0, 8); // bit flag
    central.writeUInt16LE(0, 10); // compression method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16); // crc-32
    central.writeUInt32LE(dataBuf.length, 20); // compressed size
    central.writeUInt32LE(dataBuf.length, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28); // name length
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(central, 46);

    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDirSize = centralHeaders.reduce((sum, b) => sum + b.length, 0);
  const endOfCentralDir = Buffer.alloc(22);
  endOfCentralDir.writeUInt32LE(0x06054b50, 0); // EOCD signature
  endOfCentralDir.writeUInt16LE(0, 4); // disk number
  endOfCentralDir.writeUInt16LE(0, 6); // start disk
  endOfCentralDir.writeUInt16LE(Object.keys(files).length, 8); // records on this disk
  endOfCentralDir.writeUInt16LE(Object.keys(files).length, 10); // total records
  endOfCentralDir.writeUInt32LE(centralDirSize, 12); // size of central directory
  endOfCentralDir.writeUInt32LE(offset, 16); // offset of start of central directory
  endOfCentralDir.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endOfCentralDir]);
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

// Build CRX2 buffer
function buildCrx2(zipBytes: Buffer, pubKeyLen = 16, sigLen = 16): Buffer {
  const header = Buffer.alloc(16);
  header.write('Cr24', 0, 'utf-8');
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(pubKeyLen, 8);
  header.writeUInt32LE(sigLen, 12);

  const pubKey = Buffer.alloc(pubKeyLen, 0xaa);
  const sig = Buffer.alloc(sigLen, 0xbb);

  return Buffer.concat([header, pubKey, sig, zipBytes]);
}

// Build CRX3 buffer
function buildCrx3(zipBytes: Buffer, headerLen = 32): Buffer {
  const header = Buffer.alloc(12);
  header.write('Cr24', 0, 'utf-8');
  header.writeUInt32LE(3, 4); // version 3
  header.writeUInt32LE(headerLen, 8);

  const headerData = Buffer.alloc(headerLen, 0x08);

  return Buffer.concat([header, headerData, zipBytes]);
}

describe('webstore extension installer', () => {
  beforeEach(() => {
    resetFetchCrxTransport();
  });

  describe('normalizeWebStoreInput', () => {
    const validId = 'cjpalhdlnbpafiamejdnhcphjbkeiagm';

    it('normalizes chromewebstore.google.com URLs', () => {
      const url = `https://chromewebstore.google.com/detail/ublock-origin/${validId}?hl=en`;
      expect(normalizeWebStoreInput(url)).toEqual({ id: validId });
    });

    it('normalizes chromewebstore.google.com short detail URLs', () => {
      const url = `https://chromewebstore.google.com/detail/${validId}`;
      expect(normalizeWebStoreInput(url)).toEqual({ id: validId });
    });

    it('normalizes chrome.google.com/webstore URLs', () => {
      const url = `https://chrome.google.com/webstore/detail/ublock-origin/${validId}`;
      expect(normalizeWebStoreInput(url)).toEqual({ id: validId });
    });

    it('normalizes bare 32-character ID', () => {
      expect(normalizeWebStoreInput(validId)).toEqual({ id: validId });
    });

    it('normalizes local file path or directory', () => {
      // Create a temporary dir/file to test local path
      const tmpPath = path.resolve(__dirname, 'webstore.test.ts');
      expect(normalizeWebStoreInput(tmpPath)).toEqual({ path: tmpPath });
    });

    it('rejects invalid inputs as INVALID_INPUT', () => {
      expect(() => normalizeWebStoreInput('')).toThrow(WebStoreError);
      expect(() => normalizeWebStoreInput('not-a-real-id')).toThrowError(/INVALID_INPUT/);
      expect(() => normalizeWebStoreInput('https://google.com/search?q=ext')).toThrowError(/INVALID_INPUT/);
      expect(() => normalizeWebStoreInput('12345678901234567890123456789012')).toThrowError(/INVALID_INPUT/); // digits not allowed
    });
  });

  describe('verifyCrx', () => {
    it('verifies CRX2 header and returns zip payload', () => {
      const zipBytes = createMinimalZip({ 'manifest.json': '{"name":"test"}' });
      const crx2Bytes = buildCrx2(zipBytes);

      const verified = verifyCrx(crx2Bytes);
      expect(verified.version).toBe(2);
      expect(verified.zipPayload).toEqual(zipBytes);
    });

    it('verifies CRX3 header and returns zip payload', () => {
      const zipBytes = createMinimalZip({ 'manifest.json': '{"name":"test"}' });
      const crx3Bytes = buildCrx3(zipBytes);

      const verified = verifyCrx(crx3Bytes);
      expect(verified.version).toBe(3);
      expect(verified.zipPayload).toEqual(zipBytes);
    });

    it('rejects invalid magic bytes', () => {
      const badMagic = Buffer.from('PK0304somethingbad');
      expect(() => verifyCrx(badMagic)).toThrowError(/BAD_SIGNATURE/);
    });

    it('rejects unsupported version', () => {
      const badVer = Buffer.alloc(16);
      badVer.write('Cr24', 0);
      badVer.writeUInt32LE(4, 4); // version 4
      expect(() => verifyCrx(badVer)).toThrowError(/BAD_SIGNATURE/);
    });

    it('rejects truncated header', () => {
      const truncated = Buffer.from('Cr24');
      expect(() => verifyCrx(truncated)).toThrowError(/BAD_SIGNATURE/);
    });
  });

  describe('fetchCrx', () => {
    it('uses injected transport and requests correct URL with prodversion', async () => {
      let calledUrl = '';
      setFetchCrxTransport(async (url: string) => {
        calledUrl = url;
        const zip = createMinimalZip({ 'manifest.json': '{"name":"mock"}' });
        return buildCrx3(zip);
      });

      const bytes = await fetchCrx('cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(calledUrl).toContain('https://clients2.google.com/service/update2/crx');
      expect(calledUrl).toContain('prodversion=');
      expect(calledUrl).toContain('acceptformat=crx2,crx3');
      expect(calledUrl).toContain('x=id%3Dcjpalhdlnbpafiamejdnhcphjbkeiagm%26uc');
      expect(bytes.length).toBeGreaterThan(0);
    });

    it('throws FETCH_ERROR when network fails', async () => {
      setFetchCrxTransport(async () => {
        throw new Error('Network timeout');
      });

      await expect(fetchCrx('cjpalhdlnbpafiamejdnhcphjbkeiagm')).rejects.toThrowError(/FETCH_ERROR/);
    });
  });

  describe('unpackCrx and localization', () => {
    it('unpacks zip payload and resolves __MSG_*__ localization', async () => {
      const extId = 'testlocalizationextensionid12345';
      const manifest = {
        name: '__MSG_appName__',
        version: '1.2.3',
        default_locale: 'en',
      };
      const messages = {
        appName: {
          message: 'My Localized Extension',
        },
      };

      const zip = createMinimalZip({
        'manifest.json': JSON.stringify(manifest),
        '_locales/en/messages.json': JSON.stringify(messages),
      });

      const importSpy = vi.spyOn(em, 'importExtension').mockImplementation((p, n) => {
        return {
          id: extId,
          name: n,
          path: p,
          version: '1.2.3',
        };
      });

      const result = await unpackCrx(zip, extId);
      expect(result.name).toBe('My Localized Extension');
      expect(result.version).toBe('1.2.3');
      expect(importSpy).toHaveBeenCalledWith(expect.stringContaining(path.join('data', 'extensions', extId, '1.2.3')), 'My Localized Extension');

      importSpy.mockRestore();
    });

    it('cleans up directory if unpack fails', async () => {
      const extId = 'testfailureextensionid1234567890';
      const badZip = Buffer.from('not a zip file at all');

      await expect(unpackCrx(badZip, extId)).rejects.toThrow();

      const targetDir = path.resolve(process.cwd(), 'data', 'extensions', extId);
      expect(fs.existsSync(targetDir)).toBe(false);
    });
  });

  describe('installFromWebStore idempotency and orchestration', () => {
    it('returns existing extension without re-fetching if already installed with same version', async () => {
      const extId = 'cjpalhdlnbpafiamejdnhcphjbkeiagm';
      vi.spyOn(em, 'listExtensions').mockReturnValue([
        {
          id: extId,
          name: 'Existing Extension',
          path: '/mock/path',
          version: '2.0.0',
        },
      ]);

      const fetchSpy = vi.fn();
      setFetchCrxTransport(fetchSpy);

      const res = await installFromWebStore(extId);
      expect(res.reused).toBe(true);
      expect(res.id).toBe(extId);
      expect(res.version).toBe('2.0.0');
      expect(fetchSpy).not.toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it('installs fresh extension if not already present', async () => {
      const extId = 'freshinstallid1234567890abcdef';
      vi.spyOn(em, 'listExtensions').mockReturnValue([]);

      const zip = createMinimalZip({
        'manifest.json': JSON.stringify({ name: 'Fresh Extension', version: '1.0.0' }),
      });
      const crxBytes = buildCrx3(zip);

      setFetchCrxTransport(async () => crxBytes);

      vi.spyOn(em, 'importExtension').mockReturnValue({
        id: extId,
        name: 'Fresh Extension',
        path: '/some/path',
        version: '1.0.0',
      });

      const res = await installFromWebStore(extId);
      expect(res.reused).toBe(false);
      expect(res.name).toBe('Fresh Extension');
      expect(res.version).toBe('1.0.0');

      vi.restoreAllMocks();
    });

    it('handles local directory path directly', async () => {
      const localDir = path.resolve(__dirname, 'mock-local-ext');
      fs.mkdirSync(localDir, { recursive: true });
      fs.writeFileSync(
        path.join(localDir, 'manifest.json'),
        JSON.stringify({ name: 'Local Mock Ext', version: '0.9.1' })
      );

      vi.spyOn(em, 'listExtensions').mockReturnValue([]);
      vi.spyOn(em, 'importExtension').mockImplementation((p, n) => ({
        id: 'localmockext',
        name: n,
        path: p,
        version: '0.9.1',
      }));

      const res = await installFromWebStore(localDir);
      expect(res.name).toBe('Local Mock Ext');
      expect(res.version).toBe('0.9.1');

      fs.rmSync(localDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });
  });
});
