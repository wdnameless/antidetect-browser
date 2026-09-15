// Generates resources/icon.png — the app/tray icon — from the brand mark.
//
// The repository shipped no raster assets at all, so `initTray()` fell through
// to nativeImage.createEmpty() and produced an invisible tray icon.
//
// This file previously drew an indigo shield (#6366f1) while assets/brand held a
// black visor-mask PNG — two different brands, and `predist` overwrote the correct
// assets with the shield on every build. The visor mask is now the only geometry here,
// matching scripts/generate-icons.py (the authoritative vector source) and the mark the
// user supplied.
//
// Usage: npm run icon:generate
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources');

// Two sizes: 256 is what the desktop shell needs for the app icon, while
// the tray slot is only 16-24 logical px — feeding the tray a native small
// bitmap keeps it sharp instead of letting Windows downscale 256 -> 16.
const APP_ICON = { size: 256, file: path.join(OUT_DIR, 'icon.png') };
const TRAY_ICON = { size: 32, file: path.join(OUT_DIR, 'tray-icon.png') };

const SS = 4; // supersample factor for antialiasing
// The brand mark: a black visor-mask / bandit-mask silhouette — the mark the user
// supplied. Two triangular ears with a V notch between them, a sharp horn spiking right,
// jagged torn tears down the lower-left edge, a rounded bottom mass, and a horizontal
// visor slit carrying white eye cutouts.
//
// Geometry is the same 1024-unit coordinate system used by scripts/generate-icons.py,
// which is the authoritative vector source. This script rasterises that geometry so the
// packaged icon, the tray icon and the .exe carry the user's mark rather than the indigo
// shield this file used to draw (#6366f1, the most recognizable AI-generated-design tell).
const VIEW_BOX = 1024;

const SILHOUETTE = [
  // Top centre notch between the ears
  [512, 340],
  [450, 250],
  [360, 120], // left ear apex
  [290, 230],
  [235, 330],
  [195, 415],
  [180, 425],
  // Jagged tears down the lower-left edge
  [260, 480], [185, 510],
  [280, 545], [200, 585],
  [300, 620], [220, 665],
  [325, 705], [245, 750],
  [350, 790], [280, 840],
  // Rounded bottom mass
  [340, 895],
  [420, 940],
  [512, 955],
  [605, 940],
  [685, 895],
  [755, 830],
  [810, 745],
  [835, 645],
  [830, 555],
  [800, 495],
  [965, 445], // horn spike apex
  [790, 400],
  [760, 305],
  [710, 215],
  [685, 155], // right ear apex
  [595, 255],
];

// White negative-space cutouts: an intruding left wedge, the two eye slits, and a dot.
const CUT_WEDGE = [[175, 420], [300, 442], [180, 465]];
const CUT_EYE_L = [[360, 442], [455, 415], [445, 465]];
const CUT_EYE_R = [[545, 415], [640, 442], [555, 465]];
const CUT_DOT = { cx: 685, cy: 442, r: 16 };

const DISC_RADIUS = 486;
const DISC_CENTER = 512;

const INK = [0x0a, 0x0a, 0x0a, 0xff]; // near-black, as supplied
const PAPER = [0xff, 0xff, 0xff, 0xff];

/** Ray-casting point-in-polygon over an arbitrary polygon in viewBox units. */
function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Simplified 16px form: at tray size the eye slits and the dotted pupil collapse into
 * mud. The small variant keeps the silhouette and drops only the finest cutouts, so the
 * mark stays recognisable instead of becoming a smudge.
 */
function isDetailed(size) {
  return size >= 32;
}

function renderRgba(size) {
  const px = Buffer.alloc(size * size * 4); // transparent by default
  const detailed = isDetailed(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let insideDisc = 0;
      let inkHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const vx = ((x + (sx + 0.5) / SS) / size) * VIEW_BOX;
          const vy = ((y + (sy + 0.5) / SS) / size) * VIEW_BOX;

          const dx = vx - DISC_CENTER;
          const dy = vy - DISC_CENTER;
          if (dx * dx + dy * dy > DISC_RADIUS * DISC_RADIUS) continue;
          insideDisc++;

          if (!inPolygon(vx, vy, SILHOUETTE)) continue;
          // The visor slit: knock the cutouts out of the black mass.
          if (inPolygon(vx, vy, CUT_WEDGE)) continue;
          if (inPolygon(vx, vy, CUT_EYE_L)) continue;
          if (inPolygon(vx, vy, CUT_EYE_R)) continue;
          if (detailed) {
            const ddx = vx - CUT_DOT.cx;
            const ddy = vy - CUT_DOT.cy;
            if (ddx * ddx + ddy * ddy <= CUT_DOT.r * CUT_DOT.r) continue;
          }
          inkHits++;
        }
      }

      const o = (y * size + x) * 4;
      const discCoverage = insideDisc / (SS * SS);
      const inkCoverage = inkHits / (SS * SS);

      if (inkCoverage > 0) {
        // Black mark on a white ground: the supplied mark is black-on-white, and the
        // white disc is what keeps it visible on a dark Windows taskbar.
        px[o] = INK[0];
        px[o + 1] = INK[1];
        px[o + 2] = INK[2];
        px[o + 3] = Math.round(255 * Math.max(inkCoverage, discCoverage * 0.999));
      } else if (discCoverage > 0) {
        px[o] = PAPER[0];
        px[o + 1] = PAPER[1];
        px[o + 2] = PAPER[2];
        px[o + 3] = Math.round(255 * discCoverage);
      }
      // Outside the disc stays transparent.
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
