import { Buffer } from 'node:buffer';

/**
 * Scrcpy 2.x/3.x wire protocol definitions and incremental parser.
 *
 * Each video packet starts with a 12-byte big-endian header:
 * - uint64 rawPts: presentation timestamp in microseconds. The top bits encode flags:
 *   - bit 62: SCRCPY_FLAG_CONFIG (packet contains sequence parameter sets / config)
 *   - bit 61: SCRCPY_FLAG_KEY_FRAME (packet is an IDR key frame)
 * - uint32 size: payload size in bytes.
 * Following the header are `size` payload bytes of H.264 NAL data.
 *
 * When expectCodecMeta is enabled, the first packet carries a 12-byte codec metadata
 * body (uint32 codecId, uint32 width, uint32 height) instead of video, which is exposed
 * through codecMeta and omitted from the returned packets array.
 */

export const SCRCPY_HEADER_SIZE = 12;
export const SCRCPY_FLAG_CONFIG = 1n << 62n;
export const SCRCPY_FLAG_KEY_FRAME = 1n << 61n;

/** Mask used to strip out flag bits (bits 62 and 61) to retrieve the raw timestamp in microseconds. */
const SCRCPY_FLAGS_MASK = SCRCPY_FLAG_CONFIG | SCRCPY_FLAG_KEY_FRAME;

/** Upper bound guard on packet payload size to fail closed against corrupted or malicious streams. */
export const MAX_SCRCPY_PACKET_SIZE = 64 * 1024 * 1024; // 64 MiB

export class ScrcpyProtocolError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'ScrcpyProtocolError';
  }
}

export interface ScrcpyPacket {
  /** Presentation timestamp in microseconds, with the flag bits masked off. */
  pts: bigint;
  size: number;
  isConfig: boolean;
  isKeyFrame: boolean;
  payload: Buffer;
}

export interface ScrcpyCodecMeta {
  codecId: number; // 0x68323634 = 'h264'
  width: number;
  height: number;
}

/**
 * Pure incremental parser over a scrcpy byte stream.
 * Buffers partial headers and partial payloads across feed() calls so that chunks
 * split at any arbitrary byte boundary yield identical packets.
 * Payloads are zero-copy sliced using Buffer.subarray whenever contiguous.
 */
export class ScrcpyParser {
  private _expectCodecMeta: boolean;
  private _codecMeta: ScrcpyCodecMeta | null = null;
  private _buffer: Buffer = Buffer.alloc(0);

  constructor(opts?: { expectCodecMeta?: boolean }) {
    this._expectCodecMeta = opts?.expectCodecMeta ?? false;
  }

  get codecMeta(): ScrcpyCodecMeta | null {
    return this._codecMeta;
  }

  /**
   * Feeds a stream chunk into the incremental parser and emits all complete packets available.
   */
  feed(chunk: Buffer): ScrcpyPacket[] {
    if (chunk.length === 0) {
      return [];
    }

    if (this._buffer.length === 0) {
      this._buffer = chunk;
    } else {
      this._buffer = Buffer.concat([this._buffer, chunk]);
    }

    const packets: ScrcpyPacket[] = [];
    let offset = 0;

    while (this._buffer.length - offset >= SCRCPY_HEADER_SIZE) {
      const rawPts = this._buffer.readBigUInt64BE(offset);
      const size = this._buffer.readUInt32BE(offset + 8);

      if (size > MAX_SCRCPY_PACKET_SIZE) {
        throw new ScrcpyProtocolError(
          `Hostile or invalid scrcpy packet size: ${size} bytes exceeds maximum allowed ${MAX_SCRCPY_PACKET_SIZE}`,
          'ERR_SCRCPY_PACKET_TOO_LARGE'
        );
      }

      const totalPacketLength = SCRCPY_HEADER_SIZE + size;
      if (this._buffer.length - offset < totalPacketLength) {
        // Need more data to complete this packet
        break;
      }

      // Zero-copy view of the payload
      const payload = this._buffer.subarray(offset + SCRCPY_HEADER_SIZE, offset + totalPacketLength);

      if (this._expectCodecMeta && this._codecMeta === null) {
        if (size < 12) {
          throw new ScrcpyProtocolError(
            `Expected at least 12 bytes for codec metadata body, received ${size}`,
            'ERR_SCRCPY_INVALID_CODEC_META'
          );
        }
        const codecId = payload.readUInt32BE(0);
        const width = payload.readUInt32BE(4);
        const height = payload.readUInt32BE(8);
        this._codecMeta = { codecId, width, height };
        this._expectCodecMeta = false;
      } else {
        const isConfig = (rawPts & SCRCPY_FLAG_CONFIG) !== 0n;
        const isKeyFrame = (rawPts & SCRCPY_FLAG_KEY_FRAME) !== 0n;
        const pts = rawPts & ~SCRCPY_FLAGS_MASK;

        packets.push({
          pts,
          size,
          isConfig,
          isKeyFrame,
          payload,
        });
      }

      offset += totalPacketLength;
    }

    if (offset > 0) {
      if (offset === this._buffer.length) {
        this._buffer = Buffer.alloc(0);
      } else {
        this._buffer = this._buffer.subarray(offset);
      }
    }

    return packets;
  }
}

/**
 * Control message constructors per interfaces.md §4.1.
 * All messages begin with a 1-byte type header followed by big-endian fields.
 */
export interface TouchControlParams {
  action: number; // 0 up, 1 down, 2 move
  x: number;
  y: number;
  screenW: number;
  screenH: number;
  buttons?: number;
}

export interface ScrollControlParams {
  x: number;
  y: number;
  screenW: number;
  screenH: number;
  hScroll: number;
  vScroll: number;
}

export interface KeyControlParams {
  keycode: number; // 4 Back, 3 Home, 187 Recents, 26 Power
}

export interface ViewportControlParams {
  width: number;
  height: number;
}

/**
 * Builds touch control binary message (type 0x01).
 * Layout: [0x01][action uint8][x uint32][y uint32][screenW uint32][screenH uint32][buttons uint8] (19 bytes)
 */
export function buildTouchMessage(
  actionOrParams: number | TouchControlParams,
  x?: number,
  y?: number,
  screenW?: number,
  screenH?: number,
  buttons?: number
): Buffer {
  let action: number;
  let px: number;
  let py: number;
  let pw: number;
  let ph: number;
  let pbtn: number;

  if (typeof actionOrParams === 'object') {
    action = actionOrParams.action;
    px = actionOrParams.x;
    py = actionOrParams.y;
    pw = actionOrParams.screenW;
    ph = actionOrParams.screenH;
    pbtn = actionOrParams.buttons ?? 0;
  } else {
    action = actionOrParams;
    px = x!;
    py = y!;
    pw = screenW!;
    ph = screenH!;
    pbtn = buttons ?? 0;
  }

  const buf = Buffer.allocUnsafe(19);
  buf.writeUInt8(0x01, 0);
  buf.writeUInt8(action & 0xff, 1);
  buf.writeUInt32BE(px >>> 0, 2);
  buf.writeUInt32BE(py >>> 0, 6);
  buf.writeUInt32BE(pw >>> 0, 10);
  buf.writeUInt32BE(ph >>> 0, 14);
  buf.writeUInt8(pbtn & 0xff, 18);
  return buf;
}

/**
 * Builds scroll control binary message (type 0x02).
 * Layout: [0x02][x uint32][y uint32][screenW uint32][screenH uint32][hScroll int32][vScroll int32] (25 bytes)
 */
export function buildScrollMessage(
  xOrParams: number | ScrollControlParams,
  y?: number,
  screenW?: number,
  screenH?: number,
  hScroll?: number,
  vScroll?: number
): Buffer {
  let px: number;
  let py: number;
  let pw: number;
  let ph: number;
  let phs: number;
  let pvs: number;

  if (typeof xOrParams === 'object') {
    px = xOrParams.x;
    py = xOrParams.y;
    pw = xOrParams.screenW;
    ph = xOrParams.screenH;
    phs = xOrParams.hScroll;
    pvs = xOrParams.vScroll;
  } else {
    px = xOrParams;
    py = y!;
    pw = screenW!;
    ph = screenH!;
    phs = hScroll!;
    pvs = vScroll!;
  }

  const buf = Buffer.allocUnsafe(25);
  buf.writeUInt8(0x02, 0);
  buf.writeUInt32BE(px >>> 0, 1);
  buf.writeUInt32BE(py >>> 0, 5);
  buf.writeUInt32BE(pw >>> 0, 9);
  buf.writeUInt32BE(ph >>> 0, 13);
  buf.writeInt32BE(phs | 0, 17);
  buf.writeInt32BE(pvs | 0, 21);
  return buf;
}

/**
 * Builds key control binary message (type 0x03).
 * Layout: [0x03][keycode uint8] (2 bytes)
 */
export function buildKeyMessage(keycodeOrParams: number | KeyControlParams): Buffer {
  const keycode = typeof keycodeOrParams === 'object' ? keycodeOrParams.keycode : keycodeOrParams;
  const buf = Buffer.allocUnsafe(2);
  buf.writeUInt8(0x03, 0);
  buf.writeUInt8(keycode & 0xff, 1);
  return buf;
}

/**
 * Builds rotate control binary message (type 0x04).
 * Layout: [0x04] (1 byte)
 */
export function buildRotateMessage(): Buffer {
  return Buffer.from([0x04]);
}

/**
 * Builds viewport control binary message (type 0x05).
 * Layout: [0x05][width uint32][height uint32] (9 bytes)
 */
export function buildViewportMessage(
  widthOrParams: number | ViewportControlParams,
  height?: number
): Buffer {
  const width = typeof widthOrParams === 'object' ? widthOrParams.width : widthOrParams;
  const h = typeof widthOrParams === 'object' ? widthOrParams.height : height!;
  const buf = Buffer.allocUnsafe(9);
  buf.writeUInt8(0x05, 0);
  buf.writeUInt32BE(width >>> 0, 1);
  buf.writeUInt32BE(h >>> 0, 5);
  return buf;
}

/**
 * Namespace-free control message builder object.
 * Documented API for constructing binary control channel packets per §4.1.
 */
export const buildControl = {
  touch: buildTouchMessage,
  scroll: buildScrollMessage,
  key: buildKeyMessage,
  rotate: buildRotateMessage,
  viewport: buildViewportMessage,
};

/**
 * Generic dispatcher function matching interfaces.md §4: `export function buildControlMessages(...): Buffer`.
 */
export function buildControlMessages(
  type: 'touch',
  params: TouchControlParams | number,
  x?: number,
  y?: number,
  screenW?: number,
  screenH?: number,
  buttons?: number
): Buffer;
export function buildControlMessages(
  type: 'scroll',
  params: ScrollControlParams | number,
  y?: number,
  screenW?: number,
  screenH?: number,
  hScroll?: number,
  vScroll?: number
): Buffer;
export function buildControlMessages(type: 'key', params: KeyControlParams | number): Buffer;
export function buildControlMessages(type: 'rotate'): Buffer;
export function buildControlMessages(
  type: 'viewport',
  params: ViewportControlParams | number,
  height?: number
): Buffer;
export function buildControlMessages(
  type: 'touch' | 'scroll' | 'key' | 'rotate' | 'viewport',
  params?: unknown,
  ...rest: unknown[]
): Buffer {
  switch (type) {
    case 'touch':
      return buildTouchMessage(
        params as TouchControlParams | number,
        rest[0] as number | undefined,
        rest[1] as number | undefined,
        rest[2] as number | undefined,
        rest[3] as number | undefined,
        rest[4] as number | undefined
      );
    case 'scroll':
      return buildScrollMessage(
        params as ScrollControlParams | number,
        rest[0] as number | undefined,
        rest[1] as number | undefined,
        rest[2] as number | undefined,
        rest[3] as number | undefined,
        rest[4] as number | undefined
      );
    case 'key':
      return buildKeyMessage(params as KeyControlParams | number);
    case 'rotate':
      return buildRotateMessage();
    case 'viewport':
      return buildViewportMessage(
        params as ViewportControlParams | number,
        rest[0] as number | undefined
      );
    default:
      throw new ScrcpyProtocolError(
        `Unknown control message type: ${String(type)}`,
        'ERR_SCRCPY_UNKNOWN_CONTROL_TYPE'
      );
  }
}
