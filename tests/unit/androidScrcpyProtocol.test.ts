import { describe, it, expect } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ScrcpyParser,
  SCRCPY_HEADER_SIZE,
  SCRCPY_FLAG_CONFIG,
  SCRCPY_FLAG_KEY_FRAME,
  buildControl,
  buildControlMessages,
  ScrcpyProtocolError,
} from '../../src/main/android/scrcpyProtocol';
import { resolveAdbPath, allocateEmulatorPorts, AdbError } from '../../src/main/android/adb';
import { AndroidStreamHost, type AndroidInstanceLike } from '../../src/main/android/streamHost';

describe('scrcpyProtocol', () => {
  function makePacket(pts: bigint, payload: Buffer, flags = 0n): Buffer {
    const header = Buffer.allocUnsafe(SCRCPY_HEADER_SIZE);
    header.writeBigUInt64BE(pts | flags, 0);
    header.writeUInt32BE(payload.length, 8);
    return Buffer.concat([header, payload]);
  }

  function createSyntheticStream() {
    // 1. Codec-meta packet: 12-byte header with size 12 + 12-byte body (id, width, height)
    const metaBody = Buffer.allocUnsafe(12);
    metaBody.writeUInt32BE(0x68323634, 0); // 'h264'
    metaBody.writeUInt32BE(1080, 4); // width
    metaBody.writeUInt32BE(1920, 8); // height
    const metaPacket = makePacket(0n, metaBody);

    // 2. CONFIG packet (SPS/PPS NAL data)
    const configPayload = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x2a, 0x95, 0xa0]);
    const configPacket = makePacket(100_000n, configPayload, SCRCPY_FLAG_CONFIG);

    // 3. KEY FRAME packet (IDR slice)
    const keyPayload = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x10, 0x20, 0x30, 0x40, 0x50]);
    const keyPacket = makePacket(200_000n, keyPayload, SCRCPY_FLAG_KEY_FRAME);

    // 4. DELTA FRAME packet (non-IDR slice, no flags)
    const deltaPayload = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x41, 0x9a, 0x12, 0x34]);
    const deltaPacket = makePacket(233_333n, deltaPayload, 0n);

    const fullStream = Buffer.concat([metaPacket, configPacket, keyPacket, deltaPacket]);

    return {
      fullStream,
      configPayload,
      keyPayload,
      deltaPayload,
    };
  }

  it('(a) parses synthetic stream into codecMeta + exactly 3 video packets with exact payloads and flags', () => {
    const { fullStream, configPayload, keyPayload, deltaPayload } = createSyntheticStream();

    const parser = new ScrcpyParser({ expectCodecMeta: true });
    const packets = parser.feed(fullStream);

    // Assert codec metadata
    expect(parser.codecMeta).toEqual({
      codecId: 0x68323634,
      width: 1080,
      height: 1920,
    });

    // Assert video packets
    expect(packets).toHaveLength(3);

    // Packet 1: CONFIG
    expect(packets[0].pts).toBe(100_000n);
    expect(packets[0].size).toBe(configPayload.length);
    expect(packets[0].isConfig).toBe(true);
    expect(packets[0].isKeyFrame).toBe(false);
    expect(Buffer.compare(packets[0].payload, configPayload)).toBe(0);

    // Packet 2: KEY FRAME
    expect(packets[1].pts).toBe(200_000n);
    expect(packets[1].size).toBe(keyPayload.length);
    expect(packets[1].isConfig).toBe(false);
    expect(packets[1].isKeyFrame).toBe(true);
    expect(Buffer.compare(packets[1].payload, keyPayload)).toBe(0);

    // Packet 3: DELTA FRAME
    expect(packets[2].pts).toBe(233_333n);
    expect(packets[2].size).toBe(deltaPayload.length);
    expect(packets[2].isConfig).toBe(false);
    expect(packets[2].isKeyFrame).toBe(false);
    expect(Buffer.compare(packets[2].payload, deltaPayload)).toBe(0);
  });

  it('(b) produces identical results when fed byte-by-byte', () => {
    const { fullStream, configPayload, keyPayload, deltaPayload } = createSyntheticStream();

    const wholeParser = new ScrcpyParser({ expectCodecMeta: true });
    const wholePackets = wholeParser.feed(fullStream);

    const byteParser = new ScrcpyParser({ expectCodecMeta: true });
    const bytePackets = [];

    for (let i = 0; i < fullStream.length; i++) {
      const singleByte = fullStream.subarray(i, i + 1);
      const emitted = byteParser.feed(singleByte);
      if (emitted.length > 0) {
        bytePackets.push(...emitted);
      }
    }

    expect(byteParser.codecMeta).toEqual(wholeParser.codecMeta);
    expect(bytePackets).toHaveLength(wholePackets.length);

    for (let i = 0; i < wholePackets.length; i++) {
      expect(bytePackets[i].pts).toBe(wholePackets[i].pts);
      expect(bytePackets[i].size).toBe(wholePackets[i].size);
      expect(bytePackets[i].isConfig).toBe(wholePackets[i].isConfig);
      expect(bytePackets[i].isKeyFrame).toBe(wholePackets[i].isKeyFrame);
      expect(Buffer.compare(bytePackets[i].payload, wholePackets[i].payload)).toBe(0);
    }
  });

  it('(c) handles chunks split mid-header and mid-payload without data loss', () => {
    const { fullStream, configPayload, keyPayload, deltaPayload } = createSyntheticStream();

    const parser = new ScrcpyParser({ expectCodecMeta: true });

    // Chunk 1: 5 bytes (mid-header of codec meta)
    const p1 = parser.feed(fullStream.subarray(0, 5));
    expect(p1).toHaveLength(0);
    expect(parser.codecMeta).toBeNull();

    // Chunk 2: up to 30 bytes (finishes codec meta and cuts into config packet payload)
    const p2 = parser.feed(fullStream.subarray(5, 30));
    expect(parser.codecMeta).toEqual({ codecId: 0x68323634, width: 1080, height: 1920 });

    // Chunk 3: up to 55 bytes (finishes config packet and cuts into key frame)
    const p3 = parser.feed(fullStream.subarray(30, 55));

    // Chunk 4: remainder of stream
    const p4 = parser.feed(fullStream.subarray(55));

    const allPackets = [...p1, ...p2, ...p3, ...p4];
    expect(allPackets).toHaveLength(3);
    expect(Buffer.compare(allPackets[0].payload, configPayload)).toBe(0);
    expect(Buffer.compare(allPackets[1].payload, keyPayload)).toBe(0);
    expect(Buffer.compare(allPackets[2].payload, deltaPayload)).toBe(0);
  });

  it('(d) buildControl produces the exact expected byte sequences per §4.1 against hand-written hex literals', () => {
    // 1. Touch: type 0x01, action 1 (down), x 100 (0x64), y 200 (0xc8), screenW 1080 (0x438), screenH 1920 (0x780), buttons 1
    // Hand-written layout:
    // [01][01][00 00 00 64][00 00 00 c8][00 00 04 38][00 00 07 80][01] = 19 bytes
    const expectedTouchHex = '010100000064000000c8000004380000078001';
    const touchBuf1 = buildControl.touch(1, 100, 200, 1080, 1920, 1);
    const touchBuf2 = buildControl.touch({
      action: 1,
      x: 100,
      y: 200,
      screenW: 1080,
      screenH: 1920,
      buttons: 1,
    });
    const touchBuf3 = buildControlMessages('touch', 1, 100, 200, 1080, 1920, 1);

    expect(touchBuf1.toString('hex')).toBe(expectedTouchHex);
    expect(touchBuf2.toString('hex')).toBe(expectedTouchHex);
    expect(touchBuf3.toString('hex')).toBe(expectedTouchHex);
    expect(touchBuf1.length).toBe(19);

    // 2. Scroll: type 0x02, x 100 (0x64), y 200 (0xc8), screenW 1080 (0x438), screenH 1920 (0x780), hScroll 0, vScroll -5 (0xfffffffb)
    // Hand-written layout:
    // [02][00 00 00 64][00 00 00 c8][00 00 04 38][00 00 07 80][00 00 00 00][ff ff ff fb] = 25 bytes
    const expectedScrollHex = '0200000064000000c8000004380000078000000000fffffffb';
    const scrollBuf1 = buildControl.scroll(100, 200, 1080, 1920, 0, -5);
    const scrollBuf2 = buildControl.scroll({
      x: 100,
      y: 200,
      screenW: 1080,
      screenH: 1920,
      hScroll: 0,
      vScroll: -5,
    });
    const scrollBuf3 = buildControlMessages('scroll', 100, 200, 1080, 1920, 0, -5);

    expect(scrollBuf1.toString('hex')).toBe(expectedScrollHex);
    expect(scrollBuf2.toString('hex')).toBe(expectedScrollHex);
    expect(scrollBuf3.toString('hex')).toBe(expectedScrollHex);
    expect(scrollBuf1.length).toBe(25);

    // 3. Key: type 0x03, keycode 4 (Back) -> [03][04] = 2 bytes
    const expectedKeyHex = '0304';
    const keyBuf1 = buildControl.key(4);
    const keyBuf2 = buildControl.key({ keycode: 4 });
    const keyBuf3 = buildControlMessages('key', 4);

    expect(keyBuf1.toString('hex')).toBe(expectedKeyHex);
    expect(keyBuf2.toString('hex')).toBe(expectedKeyHex);
    expect(keyBuf3.toString('hex')).toBe(expectedKeyHex);
    expect(keyBuf1.length).toBe(2);

    // Key Home (3) -> 0303, Recents (187 = 0xbb) -> 03bb, Power (26 = 0x1a) -> 031a
    expect(buildControl.key(3).toString('hex')).toBe('0303');
    expect(buildControl.key(187).toString('hex')).toBe('03bb');
    expect(buildControl.key(26).toString('hex')).toBe('031a');

    // 4. Rotate: type 0x04 -> [04] = 1 byte
    const expectedRotateHex = '04';
    const rotateBuf1 = buildControl.rotate();
    const rotateBuf2 = buildControlMessages('rotate');

    expect(rotateBuf1.toString('hex')).toBe(expectedRotateHex);
    expect(rotateBuf2.toString('hex')).toBe(expectedRotateHex);
    expect(rotateBuf1.length).toBe(1);

    // 5. Viewport: type 0x05, width 1080 (0x438), height 1920 (0x780)
    // Hand-written layout:
    // [05][00 00 04 38][00 00 07 80] = 9 bytes
    const expectedViewportHex = '050000043800000780';
    const viewportBuf1 = buildControl.viewport(1080, 1920);
    const viewportBuf2 = buildControl.viewport({ width: 1080, height: 1920 });
    const viewportBuf3 = buildControlMessages('viewport', 1080, 1920);

    expect(viewportBuf1.toString('hex')).toBe(expectedViewportHex);
    expect(viewportBuf2.toString('hex')).toBe(expectedViewportHex);
    expect(viewportBuf3.toString('hex')).toBe(expectedViewportHex);
    expect(viewportBuf1.length).toBe(9);
  });

  it('(e) rejects an absurd declared packet size rather than allocating gigabytes', () => {
    const parser = new ScrcpyParser();

    // Create a hostile 12-byte header declaring a 100 MiB payload
    const hostileHeader = Buffer.allocUnsafe(12);
    hostileHeader.writeBigUInt64BE(1_000_000n, 0);
    hostileHeader.writeUInt32BE(100 * 1024 * 1024, 8); // 100 MiB > 64 MiB limit

    expect(() => {
      parser.feed(hostileHeader);
    }).toThrow(ScrcpyProtocolError);

    try {
      parser.feed(hostileHeader);
    } catch (err) {
      expect((err as ScrcpyProtocolError).code).toBe('ERR_SCRCPY_PACKET_TOO_LARGE');
    }
  });

  it('rejects an invalid codec meta payload smaller than 12 bytes', () => {
    const parser = new ScrcpyParser({ expectCodecMeta: true });
    const badMetaHeader = Buffer.allocUnsafe(12);
    badMetaHeader.writeBigUInt64BE(0n, 0);
    badMetaHeader.writeUInt32BE(6, 8); // Only 6 bytes declared
    const badBody = Buffer.alloc(6);

    expect(() => {
      parser.feed(Buffer.concat([badMetaHeader, badBody]));
    }).toThrow(ScrcpyProtocolError);
  });
});

describe('adb utilities', () => {
  it('resolveAdbPath finds executable in candidate locations or throws ERR_ANDROID_ADB_NOT_FOUND', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-test-'));
    try {
      // 1. Initially empty directory: must throw ERR_ANDROID_ADB_NOT_FOUND
      expect(() => resolveAdbPath(tmpDir)).toThrow(AdbError);
      try {
        resolveAdbPath(tmpDir);
      } catch (err) {
        expect((err as AdbError).code).toBe('ERR_ANDROID_ADB_NOT_FOUND');
      }

      // 2. Create platform-tools/adb or adb.exe
      const exeName = process.platform === 'win32' ? 'adb.exe' : 'adb';
      const ptDir = path.join(tmpDir, 'platform-tools');
      fs.mkdirSync(ptDir, { recursive: true });
      const adbFake = path.join(ptDir, exeName);
      fs.writeFileSync(adbFake, '#!/bin/sh\nexit 0');

      const resolved = resolveAdbPath(tmpDir);
      expect(resolved).toBe(path.resolve(adbFake));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('allocateEmulatorPorts throws ERR_ANDROID_PORT_OCCUPIED when preferred port is occupied', async () => {
    // Occupy an ephemeral port
    const occupiedServer = net.createServer();
    const { promise: bound, resolve: resolveBound } = Promise.withResolvers<number>();
    occupiedServer.listen({ host: '127.0.0.1', port: 0 }, () => {
      const addr = occupiedServer.address() as net.AddressInfo;
      resolveBound(addr.port);
    });
    const occupiedPort = await bound;

    try {
      await expect(allocateEmulatorPorts(occupiedPort)).rejects.toThrow(AdbError);
      try {
        await allocateEmulatorPorts(occupiedPort);
      } catch (err) {
        expect((err as AdbError).code).toBe('ERR_ANDROID_PORT_OCCUPIED');
      }
    } finally {
      occupiedServer.close();
    }
  });
});

describe('AndroidStreamHost ticket contract', () => {
  it('issues unique tickets with valid URL and screen dimensions', () => {
    const fakeInstance: AndroidInstanceLike = {
      profileId: 'test-profile-123',
      serial: 'emulator-5554',
      adb: {
        adbPath: 'adb',
        serial: 'emulator-5554',
      } as unknown as AndroidInstanceLike['adb'],
      screen: { width: 1080, height: 2400 },
    };

    const host = new AndroidStreamHost(fakeInstance);
    const t1 = host.issueTicket();
    const t2 = host.issueTicket();

    expect(t1.ticket).not.toBe(t2.ticket);
    expect(t1.wsUrl).toContain(`/android/stream?ticket=${t1.ticket}`);
    expect(t1.width).toBe(1080);
    expect(t1.height).toBe(2400);
    expect(t1.expiresAt).toBeGreaterThan(Date.now());
    expect(host.status).toBe('idle');
  });
});
