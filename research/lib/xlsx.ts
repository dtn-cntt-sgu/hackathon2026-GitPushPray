// Đọc một sheet trong file .xlsx (zip + XML) mà không cần thư viện ngoài — đủ cho bảng dữ liệu đơn giản
// (chuỗi dùng chung, chuỗi nội tuyến, số). Trả về dạng { header, rows } giống parseCsv.
import { inflateRawSync } from 'node:zlib';
import type { CsvRow } from './csv';

function unzip(buf: Buffer): Map<string, Buffer> {
  // Tìm End Of Central Directory (EOCD) từ cuối file
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Không phải file .xlsx hợp lệ (không tìm thấy cấu trúc zip)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Thư mục zip bị hỏng');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + compSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Nối mọi <t>…</t> trong một khối (chuỗi có định dạng gồm nhiều đoạn <r>). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)![0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function listSheets(buf: Buffer): string[] {
  const wb = unzip(buf).get('xl/workbook.xml')?.toString('utf8') ?? '';
  return [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((m) => decode(m[1]!));
}

export function readXlsxSheet(buf: Buffer, sheetName?: string): { header: string[]; rows: CsvRow[]; sheet: string } {
  const files = unzip(buf);
  const wb = files.get('xl/workbook.xml')?.toString('utf8');
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!wb || !rels) throw new Error('File .xlsx thiếu workbook.xml');
  const sheets = [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: decode(/\bname="([^"]+)"/.exec(m[1]!)![1]!),
    rid: /\br:id="([^"]+)"/.exec(m[1]!)![1]!,
  }));
  const chosen = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!chosen) throw new Error(`Không có sheet "${sheetName}". Các sheet: ${sheets.map((s) => s.name).join(', ')}`);
  const target = new RegExp(`<Relationship\\b[^>]*\\bId="${chosen.rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${chosen.rid}"`).exec(rels)?.[1];
  if (!target) throw new Error('Không tìm thấy dữ liệu sheet');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheetXml = files.get(path)?.toString('utf8');
  if (!sheetXml) throw new Error(`Thiếu ${path}`);

  const sst = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  const grid: { line: number; cells: string[] }[] = [];
  for (const rm of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const line = Number(/\br="(\d+)"/.exec(rm[1]!)?.[1] ?? grid.length + 1);
    const cells: string[] = [];
    for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : cells.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const inner = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (type === 's' && v !== undefined) val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(inner);
      else if (v !== undefined) val = decode(v);
      cells[idx] = val;
    }
    if (cells.some((c) => c && c.trim() !== '')) grid.push({ line, cells: Array.from(cells, (c) => c ?? '') });
  }
  const [head, ...body] = grid;
  const header = (head?.cells ?? []).map((h) => h.trim());
  const rows = body.map((r) => ({
    line: r.line,
    values: Object.fromEntries(header.map((h, i) => [h, (r.cells[i] ?? '').replace(/\r\n/g, '\n').trim()])),
  }));
  return { header, rows, sheet: chosen.name };
}
