// Đọc CSV theo RFC 4180 (ô có dấu ngoặc kép, xuống dòng trong ô, "" là dấu ngoặc kép). Không phụ thuộc thư viện.
export interface CsvRow {
  /** Số dòng trong file (bắt đầu từ 1, tính cả dòng tiêu đề) nơi bản ghi bắt đầu. */
  line: number;
  values: Record<string, string>;
}

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const src = text.replace(/^﻿/, '');
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      cells.push(cell);
      if (cells.some((x) => x.trim() !== '')) records.push({ line: recordLine, cells });
      cells = [];
      cell = '';
      line++;
      recordLine = line;
    } else cell += c;
  }
  cells.push(cell);
  if (cells.some((x) => x.trim() !== '')) records.push({ line: recordLine, cells });

  const [head, ...body] = records;
  const header = (head?.cells ?? []).map((h) => h.trim());
  const rows = body.map((r) => ({
    line: r.line,
    values: Object.fromEntries(header.map((h, i) => [h, (r.cells[i] ?? '').replace(/\r\n/g, '\n').trim()])),
  }));
  return { header, rows };
}

/** Ghi CSV (RFC 4180): ô có dấu phẩy, ngoặc kép hoặc xuống dòng được bọc ngoặc kép. */
export function toCsv(header: string[], rows: Record<string, string>[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header.map(cell).join(','), ...rows.map((r) => header.map((h) => cell(r[h] ?? '')).join(','))].join('\n') + '\n';
}
