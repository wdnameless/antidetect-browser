/**
 * Android stream WebSocket client and scrcpy wire-format decoder.
 *
 * Implements the B1 zone from openspec/changes/android-emulator-integration/interfaces.md §4, §4.1, §7.
 *
 * This is an independent, browser-side implementation of the scrcpy 2.x/3.x wire format.
 * It must not import any modules from src/main/**.
 */

export const SCRCPY_HEADER_SIZE = 12;
export const SCRCPY_FLAG_CONFIG = 1n << 62n;
export const SCRCPY_FLAG_KEY_FRAME = 1n << 61n;

export type AndroidStreamStatus = 'connecting' | 'streaming' | 'closed' | 'error';

export interface AndroidStreamHandlers {
  onStatus(s: AndroidStreamStatus, message?: string): void;
  /** Codec description + first frames, once the codec-meta frame has been parsed. */
  onCodecMeta(meta: { codecId: number; width: number; height: number }): void;
  onFrame(frame: { data: Uint8Array; isKeyFrame: boolean; pts: bigint; isConfig: boolean }): void;
}

export class AndroidStreamClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private buffer: Uint8Array = new Uint8Array(0);
  private expectCodecMeta = true;
  private viewportWidth = 0;
  private viewportHeight = 0;

  constructor(
    private readonly wsUrl: string,
    private readonly handlers: AndroidStreamHandlers
  ) {}

  /**
   * Connect to the stream WebSocket.
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closed = false;
    this.buffer = new Uint8Array(0);
    this.expectCodecMeta = true;
    this.handlers.onStatus('connecting');

    try {
      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (this.closed || this.ws !== ws) {
          try { ws.close(); } catch {}
          return;
        }
        this.handlers.onStatus('streaming');
      };

      ws.onmessage = (event: MessageEvent) => {
        if (this.closed || this.ws !== ws) return;

        // Server->client text frames carry JSON status or error
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'error') {
              this.handlers.onStatus('error', msg.message || 'Stream error');
            } else if (msg.type === 'status') {
              if (msg.message === 'streaming') {
                this.handlers.onStatus('streaming', msg.message);
              } else {
                this.handlers.onStatus('connecting', msg.message);
              }
            }
          } catch {
            // Ignore non-JSON or malformed text frames
          }
          return;
        }

        // Server->client binary frames carry raw scrcpy stream bytes
        if (event.data instanceof ArrayBuffer) {
          this.handleBinaryChunk(new Uint8Array(event.data));
        }
      };

      ws.onerror = () => {
        if (this.closed || this.ws !== ws) return;
        this.handlers.onStatus('error', 'WebSocket connection error');
      };

      ws.onclose = () => {
        if (this.closed || this.ws !== ws) return;
        this.closed = true;
        this.ws = null;
        this.handlers.onStatus('closed');
      };

      this.ws = ws;
    } catch (err) {
      this.handlers.onStatus('error', (err as Error).message);
    }
  }

  /**
   * Idempotent close. Closes the WebSocket and cleans up parser state.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {}
    }

    this.buffer = new Uint8Array(0);
    this.handlers.onStatus('closed');
  }

  /**
   * Caches the current viewport so sendTouch and sendScroll do not need a round-trip.
   */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /**
   * Send touch event:
   * 0x01 | uint8 action (0 up, 1 down, 2 move) + uint32 x + uint32 y + uint32 screenW + uint32 screenH + uint8 buttons
   * Total 19 bytes.
   */
  sendTouch(action: 0 | 1 | 2, x: number, y: number): void {
    const buf = new ArrayBuffer(19);
    const view = new DataView(buf);
    view.setUint8(0, 0x01);
    view.setUint8(1, action);
    view.setUint32(2, Math.max(0, Math.round(x)), false);
    view.setUint32(6, Math.max(0, Math.round(y)), false);
    view.setUint32(10, Math.max(0, Math.round(this.viewportWidth)), false);
    view.setUint32(14, Math.max(0, Math.round(this.viewportHeight)), false);
    view.setUint8(18, action === 0 ? 0 : 1);
    this.sendBinary(buf);
  }

  /**
   * Send scroll event:
   * 0x02 | uint32 x + uint32 y + uint32 screenW + uint32 screenH + int32 hScroll + int32 vScroll
   * Total 25 bytes.
   */
  sendScroll(x: number, y: number, hScroll: number, vScroll: number): void {
    const buf = new ArrayBuffer(25);
    const view = new DataView(buf);
    view.setUint8(0, 0x02);
    view.setUint32(1, Math.max(0, Math.round(x)), false);
    view.setUint32(5, Math.max(0, Math.round(y)), false);
    view.setUint32(9, Math.max(0, Math.round(this.viewportWidth)), false);
    view.setUint32(13, Math.max(0, Math.round(this.viewportHeight)), false);
    view.setInt32(17, Math.round(hScroll), false);
    view.setInt32(21, Math.round(vScroll), false);
    this.sendBinary(buf);
  }

  /**
   * Send key event:
   * 0x03 | uint8 keycode (4 Back, 3 Home, 187 Recents, 26 Power)
   * Total 2 bytes.
   */
  sendKey(keycode: 4 | 3 | 187 | 26): void {
    const buf = new ArrayBuffer(2);
    const view = new DataView(buf);
    view.setUint8(0, 0x03);
    view.setUint8(1, keycode);
    this.sendBinary(buf);
  }

  /**
   * Send rotate command:
   * 0x04 | (no payload)
   * Total 1 byte.
   */
  sendRotate(): void {
    const buf = new Uint8Array([0x04]);
    this.sendBinary(buf.buffer);
  }

  /**
   * Send viewport change notice:
   * 0x05 | uint32 width + uint32 height
   * Total 9 bytes.
   * Server returns a fresh ScrcpyCodecMeta frame.
   */
  sendViewport(width: number, height: number): void {
    this.setViewport(width, height);
    this.expectCodecMeta = true;
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint8(0, 0x05);
    view.setUint32(1, Math.max(0, Math.round(width)), false);
    view.setUint32(5, Math.max(0, Math.round(height)), false);
    this.sendBinary(buf);
  }

  private sendBinary(data: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /**
   * Incremental scrcpy wire-format stream parser.
   *
   * Each packet has a 12-byte big-endian header:
   * - uint64 pts (top 2 bits are CONFIG (bit 62) and KEY_FRAME (bit 61))
   * - uint32 size
   * Followed by size bytes of payload.
   *
   * When expectCodecMeta is true, the first packet contains a 12-byte codec-meta body:
   * - uint32 codecId (e.g. 0x68323634 = 'h264')
   * - uint32 width
   * - uint32 height
   */
  private handleBinaryChunk(chunk: Uint8Array): void {
    if (this.buffer.length === 0) {
      this.buffer = chunk;
    } else {
      const combined = new Uint8Array(this.buffer.length + chunk.length);
      combined.set(this.buffer, 0);
      combined.set(chunk, this.buffer.length);
      this.buffer = combined;
    }

    while (this.buffer.length >= SCRCPY_HEADER_SIZE) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const rawPts = view.getBigUint64(0, false);
      const size = view.getUint32(8, false);

      if (this.buffer.length < SCRCPY_HEADER_SIZE + size) {
        // Incomplete packet; wait for more data
        break;
      }

      const payload = this.buffer.subarray(SCRCPY_HEADER_SIZE, SCRCPY_HEADER_SIZE + size);

      // Check if this packet is a codec meta frame (either expected, or 12 bytes with codecId 0x68323634)
      const isH264Meta = size === 12 && payload.length === 12 &&
        new DataView(payload.buffer, payload.byteOffset, 12).getUint32(0, false) === 0x68323634;

      if (this.expectCodecMeta || isH264Meta) {
        this.expectCodecMeta = false;
        if (payload.length >= 12) {
          const metaView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
          const codecId = metaView.getUint32(0, false);
          const width = metaView.getUint32(4, false);
          const height = metaView.getUint32(8, false);
          this.handlers.onCodecMeta({ codecId, width, height });
        }
      } else {
        const isConfig = (rawPts & SCRCPY_FLAG_CONFIG) !== 0n;
        const isKeyFrame = (rawPts & SCRCPY_FLAG_KEY_FRAME) !== 0n;
        const pts = rawPts & ~(SCRCPY_FLAG_CONFIG | SCRCPY_FLAG_KEY_FRAME);
        const data = this.buffer.slice(SCRCPY_HEADER_SIZE, SCRCPY_HEADER_SIZE + size);
        this.handlers.onFrame({ data, isKeyFrame, pts, isConfig });
      }

      if (this.buffer.length === SCRCPY_HEADER_SIZE + size) {
        this.buffer = new Uint8Array(0);
      } else {
        this.buffer = this.buffer.slice(SCRCPY_HEADER_SIZE + size);
      }
    }
  }
}
