import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * Streaming ZIP reader for archives whose entries exceed Node's 2 GiB Buffer ceiling.
 *
 * `adm-zip` materialises each entry through `Buffer.concat`, and a Buffer cannot exceed
 * `buffer.constants.MAX_LENGTH` (2 GiB). The AOSP android-34 system image contains
 * `x86_64/system.img` at ~2.89 GiB, so `AdmZip.extractAllTo` throws
 * `The value of "length" is out of range ... Received 3101687808` no matter how much RAM
 * is free. There is no AdmZip option that lifts this — the ceiling is in V8, not in the
 * library — so extraction is done here by streaming the local file data through
 * `zlib.createInflateRaw()` straight to disk, hashing as it goes. Peak memory is one
 * stream chunk, not one entry.
 *
 * Only the central directory is buffered, because it is small (kilobytes) even for
 * multi-gigabyte archives.
 */

/** End of central directory record. */
const EOCD_SIG = 0x06054b50;
/** ZIP64 end of central directory record. */
const ZIP64_EOCD_SIG = 0x06064b50;
/** ZIP64 end of central directory locator. */
const ZIP64_LOCATOR_SIG = 0x07064b50;
/** Central directory file header. */
const CD_SIG = 0x02014b50;
/** Local file header. */
const LFH_SIG = 0x04034b50;
/** ZIP64 extended information extra field id. */
const ZIP64_EXTRA_ID = 0x0001;

/** EOCD is 22 bytes plus a comment of up to 0xFFFF bytes, and is found by scanning backwards. */
const MAX_EOCD_SEARCH = 22 + 0xffff;

const STORED = 0;
const DEFLATED = 8;

export type ZipExtractErrorCode =
  | 'ERR_ZIP_CORRUPT'
  | 'ERR_ZIP_UNSAFE_ENTRY'
  | 'ERR_ZIP_UNSUPPORTED_COMPRESSION'
  | 'ERR_ZIP_CRC_MISMATCH'
  | 'ERR_ZIP_SIZE_MISMATCH';

export class ZipExtractError extends Error {
  constructor(
    message: string,
    public readonly code: ZipExtractErrorCode,
  ) {
    super(message);
    this.name = 'ZipExtractError';
  }
}

interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** Unix permission bits recovered from the central directory, 0 when not recorded. */
  mode: number;
  isDirectory: boolean;
}



/** Reads the ZIP64 extended information field, consuming only the values the CD left as 0xFFFFFFFF. */
function readZip64Extra(
  extra: Buffer,
  wantUncompressed: boolean,
  wantCompressed: boolean,
  wantOffset: boolean,
): { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } {
  let off = 0;
  while (off + 4 <= extra.length) {
    const id = extra.readUInt16LE(off);
    const size = extra.readUInt16LE(off + 2);
    const bodyStart = off + 4;
    if (bodyStart + size > extra.length) break;
    if (id === ZIP64_EXTRA_ID) {
      const body = extra.subarray(bodyStart, bodyStart + size);
      const out: { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } = {};
      let q = 0;
      const need = (wantUncompressed ? 8 : 0) + (wantCompressed ? 8 : 0) + (wantOffset ? 8 : 0);
      if (body.length < need) throw new ZipExtractError('ZIP64 extra field is shorter than the entries it must describe', 'ERR_ZIP_CORRUPT');
      if (wantUncompressed) {
        out.uncompressedSize = Number(body.readBigUInt64LE(q));
        q += 8;
      }
      if (wantCompressed) {
        out.compressedSize = Number(body.readBigUInt64LE(q));
        q += 8;
      }
      if (wantOffset) {
        out.localHeaderOffset = Number(body.readBigUInt64LE(q));
        q += 8;
      }
      return out;
    }
    off = bodyStart + size;
  }
  throw new ZipExtractError('central directory references ZIP64 values but carries no ZIP64 extra field', 'ERR_ZIP_CORRUPT');
}

/** Parses the central directory. The only part of the archive that is buffered in memory. */
async function readCentralDirectory(handle: fsp.FileHandle, fileSize: number): Promise<ZipEntry[]> {
  if (fileSize < 22) throw new ZipExtractError('file is too small to be a zip archive', 'ERR_ZIP_CORRUPT');

  const tailLen = Math.min(fileSize, MAX_EOCD_SEARCH);
  const tail = Buffer.alloc(tailLen);
  await handle.read(tail, 0, tailLen, fileSize - tailLen);

  let eocdRel = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocdRel = i;
      break;
    }
  }
  if (eocdRel < 0) throw new ZipExtractError('no end-of-central-directory record found', 'ERR_ZIP_CORRUPT');
  const eocdAbs = fileSize - tailLen + eocdRel;

  let entryCount = tail.readUInt16LE(eocdRel + 10);
  let cdSize = tail.readUInt32LE(eocdRel + 12);
  let cdOffset = tail.readUInt32LE(eocdRel + 16);

  const needsZip64 = entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  if (needsZip64) {
    const locatorOffset = eocdAbs - 20;
    if (locatorOffset < 0) throw new ZipExtractError('ZIP64 locator is missing', 'ERR_ZIP_CORRUPT');
    const locator = Buffer.alloc(20);
    await handle.read(locator, 0, 20, locatorOffset);
    if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) throw new ZipExtractError('ZIP64 locator signature mismatch', 'ERR_ZIP_CORRUPT');

    const zip64Offset = Number(locator.readBigUInt64LE(8));
    if (zip64Offset <= 0 || zip64Offset + 56 > fileSize) throw new ZipExtractError('ZIP64 end-of-central-directory offset is out of range', 'ERR_ZIP_CORRUPT');
    const rec = Buffer.alloc(56);
    await handle.read(rec, 0, 56, zip64Offset);
    if (rec.readUInt32LE(0) !== ZIP64_EOCD_SIG) throw new ZipExtractError('ZIP64 end-of-central-directory signature mismatch', 'ERR_ZIP_CORRUPT');

    entryCount = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
  }

  if (cdOffset <= 0 || cdOffset + cdSize > fileSize) throw new ZipExtractError('central directory offset is out of range', 'ERR_ZIP_CORRUPT');

  const cd = Buffer.alloc(cdSize);
  await handle.read(cd, 0, cdSize, cdOffset);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > cd.length) throw new ZipExtractError(`central directory ended after ${i} of ${entryCount} entries`, 'ERR_ZIP_CORRUPT');
    if (cd.readUInt32LE(p) !== CD_SIG) throw new ZipExtractError(`bad central directory signature at entry ${i}`, 'ERR_ZIP_CORRUPT');

    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    let compressedSize = cd.readUInt32LE(p + 20);
    let uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const externalAttr = cd.readUInt32LE(p + 38);
    let localHeaderOffset = cd.readUInt32LE(p + 42);

    const nameStart = p + 46;
    const extraStart = nameStart + nameLen;
    if (extraStart + extraLen + commentLen > cd.length) throw new ZipExtractError(`entry ${i} header overruns the central directory`, 'ERR_ZIP_CORRUPT');

    const name = cd.toString('utf8', nameStart, extraStart);
    const extra = cd.subarray(extraStart, extraStart + extraLen);

    const wantUncompressed = uncompressedSize === 0xffffffff;
    const wantCompressed = compressedSize === 0xffffffff;
    const wantOffset = localHeaderOffset === 0xffffffff;
    if (wantUncompressed || wantCompressed || wantOffset) {
      const z = readZip64Extra(extra, wantUncompressed, wantCompressed, wantOffset);
      if (wantUncompressed) uncompressedSize = z.uncompressedSize!;
      if (wantCompressed) compressedSize = z.compressedSize!;
      if (wantOffset) localHeaderOffset = z.localHeaderOffset!;
    }

    entries.push({
      name,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      mode: (externalAttr >>> 16) & 0xffff,
      isDirectory: name.endsWith('/'),
    });
    p = extraStart + extraLen + commentLen;
  }

  return entries;
}

/**
 * Resolves an archive entry name against the destination directory, refusing anything that
 * would write outside it. Zip names are always forward-slash separated, but a hostile archive
 * can still carry `../`, an absolute path or a drive-qualified path. Backslashes are treated as
 * separators too: on Windows `path.join` honours them, so `..\evil` would otherwise escape.
 */
function safeJoin(destDir: string, entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/');
  if (path.isAbsolute(entryName) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')) {
    throw new ZipExtractError(`refusing absolute path in archive: ${entryName}`, 'ERR_ZIP_UNSAFE_ENTRY');
  }
  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.some((part) => part === '..')) {
    throw new ZipExtractError(`refusing path traversal in archive: ${entryName}`, 'ERR_ZIP_UNSAFE_ENTRY');
  }
  return path.join(destDir, ...parts);
}

/** Streams one entry from the archive to disk, verifying its CRC-32 and length on the way. */
async function extractEntry(handle: fsp.FileHandle, zipPath: string, entry: ZipEntry, targetPath: string): Promise<void> {
  const lfh = Buffer.alloc(30);
  await handle.read(lfh, 0, 30, entry.localHeaderOffset);
  if (lfh.readUInt32LE(0) !== LFH_SIG) {
    throw new ZipExtractError(`bad local file header for ${entry.name}`, 'ERR_ZIP_CORRUPT');
  }
  const dataStart = entry.localHeaderOffset + 30 + lfh.readUInt16LE(26) + lfh.readUInt16LE(28);

  let crc = 0;
  let written = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      crc = zlib.crc32(chunk, crc);
      written += chunk.length;
      cb(null, chunk);
    },
  });

  if (entry.compressedSize === 0 && entry.uncompressedSize === 0) {
    await fsp.writeFile(targetPath, Buffer.alloc(0));
  } else {
    // One stream per entry, each opening its own descriptor: `handle.createReadStream` would leave a
    // `close` listener on the shared FileHandle for every entry, and a 37-entry image exceeds the
    // default listener cap.
    const source = fs.createReadStream(zipPath, {
      start: dataStart,
      end: dataStart + entry.compressedSize - 1,
    });
    const sink = fs.createWriteStream(targetPath);
    if (entry.method === STORED) {
      await pipeline(source, meter, sink);
    } else if (entry.method === DEFLATED) {
      await pipeline(source, zlib.createInflateRaw(), meter, sink);
    } else {
      throw new ZipExtractError(
        `unsupported compression method ${entry.method} for ${entry.name}`,
        'ERR_ZIP_UNSUPPORTED_COMPRESSION',
      );
    }
  }

  if (written !== entry.uncompressedSize) {
    throw new ZipExtractError(
      `size mismatch for ${entry.name}: expected ${entry.uncompressedSize} bytes, wrote ${written}`,
      'ERR_ZIP_SIZE_MISMATCH',
    );
  }
  if (crc !== entry.crc32) {
    throw new ZipExtractError(
      `CRC-32 mismatch for ${entry.name}: expected ${entry.crc32.toString(16)}, got ${crc.toString(16)}`,
      'ERR_ZIP_CRC_MISMATCH',
    );
  }
  // A zip built on a Unix host records the executable bit here; the emulator binary needs it
  // on macOS and Linux. Windows has no equivalent, and the extracted mode is meaningless there.
  if (process.platform !== 'win32' && (entry.mode & 0o777) !== 0) {
    await fsp.chmod(targetPath, entry.mode & 0o777);
  }
}

/** Entry names in archive order. Reads only the central directory — nothing is decompressed. */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const handle = await fsp.open(zipPath, 'r');
  try {
    const { size } = await handle.stat();
    const entries = await readCentralDirectory(handle, size);
    return entries.map((entry) => entry.name);
  } finally {
    await handle.close();
  }
}

/**
 * Extracts every entry of `zipPath` into `destDir`, streaming each one to disk and verifying
 * its CRC-32 and uncompressed length. Peak memory is one stream chunk regardless of entry size.
 */
export async function extractZipStreaming(zipPath: string, destDir: string): Promise<void> {
  const handle = await fsp.open(zipPath, 'r');
  try {
    const { size } = await handle.stat();
    const entries = await readCentralDirectory(handle, size);
    await fsp.mkdir(destDir, { recursive: true });
    for (const entry of entries) {
      const targetPath = safeJoin(destDir, entry.name);
      if (entry.isDirectory) {
        await fsp.mkdir(targetPath, { recursive: true });
        continue;
      }
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await extractEntry(handle, zipPath, entry, targetPath);
    }
  } finally {
    await handle.close();
  }
}
