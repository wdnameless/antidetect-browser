import AdmZip from 'adm-zip';

export class InvalidXlsxError extends Error {
  constructor(message = 'Invalid XLSX file or archive') {
    super(message);
    this.name = 'InvalidXlsxError';
  }
}

export class UnsupportedCellTypeError extends Error {
  constructor(cellType: string) {
    super(`Unsupported cell type: ${cellType}`);
    this.name = 'UnsupportedCellTypeError';
  }
}

export function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unescapeXml(str: string): string {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function numToCol(num: number): string {
  let col = '';
  let n = num + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

export function colToNum(col: string): number {
  let num = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    num = num * 26 + (upper.charCodeAt(i) - 64);
  }
  return num - 1;
}

const FIXED_DATE = new Date(1700000000000);

/**
 * Encodes rows into a deterministic OOXML .xlsx buffer with a shared string table.
 */
export function writeXlsx(rows: string[][]): Buffer {
  const stringMap = new Map<string, number>();
  const stringTable: string[] = [];

  function getStrId(s: string): number {
    let id = stringMap.get(s);
    if (id !== undefined) return id;
    id = stringTable.length;
    stringMap.set(s, id);
    stringTable.push(s);
    return id;
  }

  let sheetData = '';
  for (let r = 0; r < rows.length; r++) {
    const rowNum = r + 1;
    const row = rows[r];
    let rowXml = `<row r="${rowNum}">`;
    for (let c = 0; c < row.length; c++) {
      const val = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
      const colRef = numToCol(c);
      const cellRef = `${colRef}${rowNum}`;
      const strId = getStrId(val);
      rowXml += `<c r="${cellRef}" t="s"><v>${strId}</v></c>`;
    }
    rowXml += '</row>';
    sheetData += rowXml;
  }

  const sstXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${stringTable.length}" uniqueCount="${stringTable.length}">` +
    stringTable.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('') +
    '</sst>';

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${sheetData}</sheetData>` +
    '</worksheet>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    '<sheet name="Sheet1" sheetId="1" r:id="rId1"/>' +
    '</sheets>' +
    '</workbook>';

  const files: [string, string][] = [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rels],
    ['xl/_rels/workbook.xml.rels', wbRels],
    ['xl/sharedStrings.xml', sstXml],
    ['xl/workbook.xml', workbook],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ];

  files.sort((a, b) => a[0].localeCompare(b[0]));

  const zip = new AdmZip();
  for (const [name, content] of files) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }

  for (const entry of zip.getEntries()) {
    entry.header.time = FIXED_DATE;
  }

  return zip.toBuffer();
}

export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<si\b[\s\S]*?>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const siContent = siMatch[1];
    const tRegex = /<t(?:[^>]*)>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    let text = '';
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      text += unescapeXml(tMatch[1]);
    }
    strings.push(text);
  }
  return strings;
}

export function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*?(\br="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const explicitRowNum = rowMatch[2] ? parseInt(rowMatch[2], 10) : undefined;
    const rowContent = rowMatch[3];

    const cellRegex = /<c\b([^>]*?)>(?:([\s\S]*?)<\/c>|(?=\/>))/g;
    let cellMatch: RegExpExecArray | null;
    const rowCells: string[] = [];

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const attrs = cellMatch[1];
      const cellBody = cellMatch[2] || '';

      const rAttrMatch = /\br="([A-Z]+)(\d+)"/i.exec(attrs);
      let colIdx = rowCells.length;
      if (rAttrMatch) {
        colIdx = colToNum(rAttrMatch[1]);
      }

      const tAttrMatch = /\bt="([^"]*)"/.exec(attrs);
      const cellType = tAttrMatch ? tAttrMatch[1] : undefined;

      let val = '';
      if (!cellType) {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        val = vMatch ? unescapeXml(vMatch[1]) : '';
      } else if (cellType === 's') {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        if (vMatch) {
          const idx = parseInt(vMatch[1].trim(), 10);
          val = sharedStrings[idx] ?? '';
        }
      } else if (cellType === 'inlineStr') {
        const tRegex = /<t(?:[^>]*)>([\s\S]*?)<\/t>/g;
        let tMatch: RegExpExecArray | null;
        let text = '';
        while ((tMatch = tRegex.exec(cellBody)) !== null) {
          text += unescapeXml(tMatch[1]);
        }
        val = text;
      } else if (cellType === 'str') {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        val = vMatch ? unescapeXml(vMatch[1]) : '';
      } else if (cellType === 'b') {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        val = vMatch && vMatch[1].trim() === '1' ? 'TRUE' : 'FALSE';
      } else if (cellType === 'n') {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        val = vMatch ? unescapeXml(vMatch[1]) : '';
      } else {
        throw new UnsupportedCellTypeError(cellType);
      }

      rowCells[colIdx] = val;
    }

    for (let i = 0; i < rowCells.length; i++) {
      if (rowCells[i] === undefined) {
        rowCells[i] = '';
      }
    }

    const targetRowIdx = explicitRowNum !== undefined ? explicitRowNum - 1 : rows.length;
    rows[targetRowIdx] = rowCells;
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i] === undefined) {
      rows[i] = [];
    }
  }

  return rows;
}

/**
 * Reads a single-sheet .xlsx archive into string[][].
 * Throws InvalidXlsxError if input is not a valid zip or missing sheet data.
 */
export function readXlsx(bytes: Buffer): string[][] {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) {
    throw new InvalidXlsxError('Input is not a valid Buffer or is too short to be a ZIP archive');
  }

  // Check ZIP local file header or end of central directory signature (PK..)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new InvalidXlsxError('Input does not start with ZIP magic bytes PK');
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(bytes);
  } catch (err) {
    throw new InvalidXlsxError(`Failed to parse ZIP archive: ${(err as Error).message}`);
  }

  const entries = zip.getEntries();
  if (!entries || entries.length === 0) {
    throw new InvalidXlsxError('Empty ZIP archive');
  }

  let sstXml = '';
  let sheetXml = '';

  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (entryName === 'xl/sharedStrings.xml') {
      sstXml = entry.getData().toString('utf8');
    } else if (
      entryName === 'xl/worksheets/sheet1.xml' ||
      (!sheetXml && entryName.startsWith('xl/worksheets/') && entryName.endsWith('.xml'))
    ) {
      sheetXml = entry.getData().toString('utf8');
    }
  }

  if (!sheetXml) {
    throw new InvalidXlsxError('No worksheet XML found in XLSX package');
  }

  const sharedStrings = sstXml ? parseSharedStrings(sstXml) : [];
  return parseWorksheet(sheetXml, sharedStrings);
}
