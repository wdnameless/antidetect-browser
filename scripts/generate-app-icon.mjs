// Generates resources/icon.png — the app/tray icon.
//
// The repository shipped no raster assets at all, so `initTray()` fell through
// to nativeImage.createEmpty() and produced an invisible tray icon. The mark is
// the same shield the renderer already uses (src/renderer/src/icons.tsx
// ShieldIcon, also the window favicon), drawn filled in the accent indigo so it
// stays legible on both light and dark Windows taskbars.
//
// Usage: npm run icon:generate
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources');

// Two sizes: 256 is what electron-builder needs to derive the .exe icon, while
// the tray slot is only 16-24 logical px — feeding the tray a native small
// bitmap keeps it sharp instead of letting Windows downscale 256 -> 16.
const APP_ICON = { size: 256, file: path.join(OUT_DIR, 'icon.png') };
const TRAY_ICON = { size: 32, file: path.join(OUT_DIR, 'tray-icon.png') };

const SS = 4; // supersample factor for antialiasing
const ACCENT = [0x63, 0x66, 0xf1, 0xff]; // --accent, matches the favicon stroke

// Shield outline from the renderer's ShieldIcon, sampled as a polygon in the
// icon's 24x24 viewBox (the path is symmetric about x=12).
const SHIELD = [
  [12, 2], // top centre
  [20, 5], // right shoulder
  [20, 12], // right flank
  [12, 22], // bottom point
  [4, 12], // left flank
  [4, 5], // left shoulder
];

/** Ray-casting point-in-polygon over the shield, in viewBox units. */
function inShield(x, y) {
  let inside = false;
  for (let i = 0, j = SHIELD.length - 1; i < SHIELD.length; j = i++) {
    const [xi, yi] = SHIELD[i];
    const [xj, yj] = SHIELD[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function renderRgba(size) {
  const px = Buffer.alloc(size * size * 4); // transparent by default
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Map the supersampled sample back into the 24x24 viewBox.
          const vx = ((x + (sx + 0.5) / SS) / size) * 24;
          const vy = ((y + (sy + 0.5) / SS) / size) * 24;
          if (inShield(vx, vy)) hits++;
        }
      }
      const coverage = hits / (SS * SS);
      const o = (y * size + x) * 4;
      px[o] = ACCENT[0];
      px[o + 1] = ACCENT[1];
      px[o + 2] = ACCENT[2];
      px[o + 3] = Math.round(ACCENT[3] * coverage);
    }
  }
  return px;
}

// --- minimal PNG encoder (RGBA, filter 0) -----------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const target of [APP_ICON, TRAY_ICON]) {
  const png = encodePng(renderRgba(target.size), target.size, target.size);
  writeFileSync(target.file, png);
  console.log(`[icon] wrote ${target.file} (${target.size}x${target.size}, ${png.length} bytes)`);
}
