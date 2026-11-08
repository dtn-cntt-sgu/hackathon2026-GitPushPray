// npm run bench:import -- <file.csv|file.xlsx> [--sheet Bo_De_Chuan_TEMPLATE] [--force-new-test] [--name v2]
// --name <tên>: lưu riêng vào research/data/sets/<tên>/ (dùng --dataset set:<tên> khi chạy), không ghi đè bộ đề chính.
// Cột split_co_dinh / dung_cho (dev|test) ép ca vào đúng phía; các ca còn lại chia ngẫu nhiên phân tầng.
// Kiểm tra bộ đề, chia dev/test và khóa bộ test bằng mã băm. Lưu bản chụp CSV chuẩn + mã băm file gốc
// (research/data/dataset.csv, import-meta.json) để làm bằng chứng cho từng đợt.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseCsv, toCsv } from './lib/csv';
import { readXlsxSheet } from './lib/xlsx';
import { rowsToCases } from './lib/dataset';
import { arg, DATA_DIR, RESEARCH_DIR } from './lib/io';
import { cohenKappa } from './lib/metrics';
import { hashCases, stratifiedSplit } from './lib/split';

const file = process.argv.slice(2).find((a) => /\.(csv|xlsx)$/i.test(a));
if (!file) {
  console.error('Cách dùng: npm run bench:import -- <file .csv hoặc .xlsx> [--sheet <tên sheet>] [--force-new-test]');
  process.exit(1);
}

const raw = readFileSync(file);
const isXlsx = /\.xlsx$/i.test(file);
const { header, rows, sheet } = isXlsx
  ? readXlsxSheet(raw, arg('sheet', 'Bo_De_Chuan_TEMPLATE'))
  : { ...parseCsv(raw.toString('utf8')), sheet: undefined };
const { cases, issues } = rowsToCases(header, rows);
if (issues.length) {
  console.error(`\n❌ ${issues.length} lỗi — sửa trong Sheet rồi xuất lại CSV:\n`);
  for (const i of issues.slice(0, 200)) console.error(`  dòng ${i.line}${i.id ? ` (${i.id})` : ''}: ${i.message}`);
  if (issues.length > 200) console.error(`  … và ${issues.length - 200} lỗi khác`);
  process.exit(1);
}

const split = stratifiedSplit(cases);
const testCases = cases.filter((c) => split.test.includes(c.id));
const hash = hashCases(testCases);
const setName = arg('name');
if (setName && !/^[a-z0-9_-]+$/i.test(setName)) {
  console.error('--name chỉ gồm chữ, số, - và _');
  process.exit(1);
}
const OUT_DIR = setName ? join(DATA_DIR, 'sets', setName) : DATA_DIR;
const lockFile = setName ? join(OUT_DIR, 'test.lock') : join(RESEARCH_DIR, 'test.lock');
if (existsSync(lockFile) && !arg('force-new-test')) {
  const old = readFileSync(lockFile, 'utf8').trim();
  if (old !== hash) {
    console.error(
      '\n⚠ Bộ test khác với bộ đã khóa (test.lock). Nếu đây là bộ đề mới có chủ ý, chạy lại với --force-new-test và ghi lý do vào RUNS.md.',
    );
    process.exit(1);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'cases.json'), JSON.stringify(cases, null, 2));
writeFileSync(join(OUT_DIR, 'split.json'), JSON.stringify(split, null, 2));
writeFileSync(lockFile, hash + '\n');
const snapshot = toCsv(header, rows.map((r) => r.values));
writeFileSync(join(OUT_DIR, 'dataset.csv'), snapshot);
writeFileSync(
  join(OUT_DIR, 'import-meta.json'),
  JSON.stringify(
    {
      importedAt: new Date().toISOString(),
      sourceFile: basename(file),
      sheet,
      sourceSha256: createHash('sha256').update(raw).digest('hex'),
      datasetCsvSha256: createHash('sha256').update(snapshot).digest('hex'),
      cases: cases.length,
      fixedDev: cases.filter((c) => c.fixedSplit === 'dev').length,
      fixedTest: cases.filter((c) => c.fixedSplit === 'test').length,
      dev: split.dev.length,
      test: split.test.length,
      testLock: hash,
    },
    null,
    2,
  ),
);

const count = (f: (c: (typeof cases)[number]) => string) =>
  Object.entries(cases.reduce<Record<string, number>>((m, c) => ((m[f(c)] = (m[f(c)] ?? 0) + 1), m), {}))
    .sort()
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
const both = cases.filter((c) => c.levelA && c.levelB);
console.log(`\n✅ Nhập ${cases.length} hội thoại (dev ${split.dev.length} / test ${split.test.length})`);
console.log(`Theo loại   : ${count((c) => c.kind)}`);
console.log(`Theo mức    : ${count((c) => c.gold)}`);
console.log(`Theo nhóm   : ${count((c) => String(c.group))}`);
console.log(
  `Đồng thuận 2 người gán (Cohen's κ): ${cohenKappa(both.map((c) => c.levelA!), both.map((c) => c.levelB!)).toFixed(3)} trên ${both.length} ca`,
);
console.log(`Ép cố định: dev ${cases.filter((c) => c.fixedSplit === 'dev').length} · test ${cases.filter((c) => c.fixedSplit === 'test').length}`);
console.log(`Mã khóa bộ test: ${hash.slice(0, 16)}…`);
if (setName) console.log(`Lưu ở research/data/sets/${setName}/ — chạy: npm run bench:run -- --dataset set:${setName} --split dev …`);
