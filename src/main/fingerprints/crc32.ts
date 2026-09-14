// CRC32 for deterministic seed derivation from strings.
//
// Leaf module on purpose: `migration.ts` needs a checksum, and importing it from
// `derivation.ts` closed the cycle
//   migration -> derivation -> catalog -> macosFamilies -> migration
// which left `MAC_MODERN_FONTS` uninitialised whenever a new module (fonts.ts)
// changed the import order. Derivation re-exports from here so existing importers
// (including tests) keep working.
function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

export function crc32(str: string): number {
  let crc = 0 ^ -1;
  const buf = Buffer.from(str, 'utf8');
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}
