import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import {
  writeXlsx,
  readXlsx,
  InvalidXlsxError,
  UnsupportedCellTypeError,
  numToCol,
  colToNum,
} from '../../src/main/io/xlsx';

describe('xlsx-io helpers', () => {
  it('converts column index to letter and back', () => {
    expect(numToCol(0)).toBe('A');
    expect(numToCol(25)).toBe('Z');
    expect(numToCol(26)).toBe('AA');
    expect(numToCol(27)).toBe('AB');
    expect(numToCol(701)).toBe('ZZ');

    expect(colToNum('A')).toBe(0);
    expect(colToNum('Z')).toBe(25);
    expect(colToNum('AA')).toBe(26);
    expect(colToNum('AB')).toBe(27);
    expect(colToNum('ZZ')).toBe(701);
  });
});

describe('writeXlsx and readXlsx roundtrip', () => {
  it('roundtrips 3 rows with name, timezone, proxy-host', () => {
    const inputRows: string[][] = [
      ['name', 'timezone', 'proxy_host'],
      ['Profile Alpha', 'America/New_York', '192.168.1.100'],
      ['Profile Beta', 'Europe/London', '10.0.0.1'],
      ['Profile Gamma', 'Asia/Tokyo', '172.16.0.50'],
    ];

    const buf = writeXlsx(inputRows);
    expect(Buffer.isBuffer(buf)).toBe(true);

    const parsedRows = readXlsx(buf);
    expect(parsedRows).toEqual(inputRows);
  });

  it('preserves special XML characters and blank cells', () => {
    const inputRows: string[][] = [
      ['Header & More', 'Col <2>', 'Col "3"'],
      ['Special <>&"\' chars', '', 'Value 3'],
      ['', 'Only middle', ''],
    ];

    const buf = writeXlsx(inputRows);
    const parsedRows = readXlsx(buf);
    expect(parsedRows).toEqual(inputRows);
  });

  it('produces byte-stable output: exporting the same rows twice produces identical bytes', () => {
    const rows = [
      ['name', 'timezone', 'proxy_host', 'proxy_port'],
      ['Profile 1', 'UTC', '1.2.3.4', '8080'],
      ['Profile 2', 'Europe/Paris', '5.6.7.8', '1080'],
      ['Profile 3', 'Asia/Singapore', '9.10.11.12', '3128'],
    ];

    const buf1 = writeXlsx(rows);
    const buf2 = writeXlsx(rows);

    expect(buf1.equals(buf2)).toBe(true);
  });
});

describe('readXlsx fixture parsing', () => {
  it('parses shared-strings and inline-strings fixtures identically', () => {
    const expected = [
      ['Name', 'Timezone', 'Host'],
      ['Alpha', 'UTC', '127.0.0.1'],
      ['Beta', 'EST', '192.168.0.1'],
    ];

    // Build shared-string fixture
    const sstZip = new AdmZip();
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
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    const sstXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<si><t>Name</t></si>' +
      '<si><t>Timezone</t></si>' +
      '<si><t>Host</t></si>' +
      '<si><t>Alpha</t></si>' +
      '<si><t>UTC</t></si>' +
      '<si><t>127.0.0.1</t></si>' +
      '<si><t>Beta</t></si>' +
      '<si><t>EST</t></si>' +
      '<si><t>192.168.0.1</t></si>' +
      '</sst>';

    const sstSheetXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1">' +
      '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c>' +
      '</row>' +
      '<row r="2">' +
      '<c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c>' +
      '</row>' +
      '<row r="3">' +
      '<c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c>' +
      '</row>' +
      '</sheetData>' +
      '</worksheet>';

    sstZip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
    sstZip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
    sstZip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(wbRels, 'utf8'));
    sstZip.addFile('xl/workbook.xml', Buffer.from(workbook, 'utf8'));
    sstZip.addFile('xl/sharedStrings.xml', Buffer.from(sstXml, 'utf8'));
    sstZip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sstSheetXml, 'utf8'));
    const sstBuf = sstZip.toBuffer();

    // Build inline-strings fixture
    const inlineZip = new AdmZip();
    const inlineSheetXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>Name</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>Timezone</t></is></c>' +
      '<c r="C1" t="inlineStr"><is><t>Host</t></is></c>' +
      '</row>' +
      '<row r="2">' +
      '<c r="A2" t="inlineStr"><is><t>Alpha</t></is></c>' +
      '<c r="B2" t="inlineStr"><is><t>UTC</t></is></c>' +
      '<c r="C2" t="inlineStr"><is><t>127.0.0.1</t></is></c>' +
      '</row>' +
      '<row r="3">' +
      '<c r="A3" t="inlineStr"><is><t>Beta</t></is></c>' +
      '<c r="B3" t="inlineStr"><is><t>EST</t></is></c>' +
      '<c r="C3" t="inlineStr"><is><t>192.168.0.1</t></is></c>' +
      '</row>' +
      '</sheetData>' +
      '</worksheet>';

    inlineZip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
    inlineZip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
    inlineZip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(wbRels, 'utf8'));
    inlineZip.addFile('xl/workbook.xml', Buffer.from(workbook, 'utf8'));
    inlineZip.addFile('xl/worksheets/sheet1.xml', Buffer.from(inlineSheetXml, 'utf8'));
    const inlineBuf = inlineZip.toBuffer();

    const fromSst = readXlsx(sstBuf);
    const fromInline = readXlsx(inlineBuf);

    expect(fromSst).toEqual(expected);
    expect(fromInline).toEqual(expected);
    expect(fromSst).toEqual(fromInline);
  });

  it('throws a typed InvalidXlsxError on non-zip input', () => {
    const nonZipBuffer = Buffer.from('this is plain text, not a zip archive at all');
    expect(() => readXlsx(nonZipBuffer)).toThrow(InvalidXlsxError);
    expect(() => readXlsx(Buffer.alloc(2))).toThrow(InvalidXlsxError);
  });

  it('throws a typed UnsupportedCellTypeError on unknown cell types', () => {
    const zip = new AdmZip();
    const sheetXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1"><c r="A1" t="unknown_custom_type"><v>123</v></c></row>' +
      '</sheetData>' +
      '</worksheet>';
    zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));
    const buf = zip.toBuffer();

    expect(() => readXlsx(buf)).toThrow(UnsupportedCellTypeError);
  });
});
