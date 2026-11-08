// npm run bench:external -- --name sms      --file <full_dataset.csv>            [--revision <commit>]
// npm run bench:external -- --name tele28k  --scam <tele28k_scam.json> --harmless <tele28k_harmless.json> [--revision …]
// npm run bench:external -- --name scamtext --file <scamtext_dataset.txt>          [--revision …]
// Nhập một bộ dữ liệu NGOÀI vào research/data/external/<name>/: cases.json, split.json (dev 30% / test 70%
// phân tầng), test.lock (mã băm bộ test) và manifest.json (nguồn, giấy phép, phiên bản, sha256 file gốc, số ca).
// Đổi bộ test đã khóa → từ chối, trừ khi --force-new-test.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { convertScamtext, convertSms, convertTele, EXTERNAL_SOURCES } from './lib/external';
import { arg, DATA_DIR } from './lib/io';
import { hashCases, stratifiedSplit } from './lib/split';
import type { BenchCase } from './lib/dataset';

const name = arg('name') ?? '';
const src = EXTERNAL_SOURCES[name];
if (!src) {
  console.error(`Cách dùng: npm run bench:external -- --name ${Object.keys(EXTERNAL_SOURCES).join('|')} --file <…>`);
  process.exit(1);
}
const files = name === 'tele28k' ? [arg('scam'), arg('harmless')] : [arg('file')];
if (files.some((f) => !f || !existsSync(f))) {
  console.error('Thiếu hoặc không tìm thấy file nguồn.');
  process.exit(1);
}
const read = (f: string) => readFileSync(f, 'utf8').replace(/^﻿/, '');
let cases: BenchCase[];
if (name === 'sms') cases = convertSms(read(files[0]!));
else if (name === 'tele28k') cases = convertTele(JSON.parse(read(files[0]!)), JSON.parse(read(files[1]!)));
else cases = convertScamtext(read(files[0]!));

const ids = new Set<string>();
for (const c of cases) {
  if (ids.has(c.id)) throw new Error(`Trùng id ${c.id}`);
  ids.add(c.id);
}

const split = stratifiedSplit(cases, 0.3, 20261102);
const testSet = new Set(split.test);
const hash = hashCases(cases.filter((c) => testSet.has(c.id)));
const dir = join(DATA_DIR, 'external', name);
mkdirSync(dir, { recursive: true });
const lockFile = join(dir, 'test.lock');
if (existsSync(lockFile) && readFileSync(lockFile, 'utf8').trim() !== hash && !arg('force-new-test')) {
  console.error('❌ Bộ test đã khóa khác với lần nhập này (dữ liệu nguồn đổi?). Dùng --force-new-test nếu chủ ý tạo bộ test mới.');
  process.exit(1);
}

const count = (xs: BenchCase[]) => {
  const out: Record<string, number> = {};
  for (const c of xs) for (const k of [`kind:${c.kind}`, `tag:${c.tags[0]}`]) out[k] = (out[k] ?? 0) + 1;
  return out;
};
const manifest = {
  ...src,
  revision: arg('revision') ?? null,
  importedAt: new Date().toISOString(),
  sourceFiles: files.map((f) => ({ file: basename(f!), sha256: createHash('sha256').update(readFileSync(f!)).digest('hex') })),
  cases: cases.length,
  dev: split.dev.length,
  test: split.test.length,
  counts: count(cases),
  splitSeed: 20261102,
  testLock: hash,
};
writeFileSync(join(dir, 'cases.json'), JSON.stringify(cases));
writeFileSync(join(dir, 'split.json'), JSON.stringify(split, null, 1));
writeFileSync(lockFile, hash + '\n');
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`✔ ${src.title}: ${cases.length} ca (dev ${split.dev.length} / test ${split.test.length}) → research/data/external/${name}/`);
for (const [k, v] of Object.entries(manifest.counts).sort()) console.log(`   ${k.padEnd(40)} ${v}`);
console.log(`   giấy phép: ${src.license}${src.redistributable ? '' : ' — KHÔNG lưu bản chụp dữ liệu lên git, chỉ lưu manifest'}`);
console.log(`Chạy bộ luật: npm run bench:run -- --dataset ext:${name} --configs rules --split dev`);
