// npm run bench:label-audit
// 1. research/experiments/label_audit.json: đồng thuận nhãn theo từng phần dữ liệu, lên repo (không có nội dung chat).
// 2. research/results/labeling/: phiếu gán nhãn ẩn nhãn cũ cho người chưa tham gia, CHỈ trên máy, gửi qua kênh riêng.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RiskLevel } from '@safechat/core/types';
import { toCsv } from './lib/csv';
import type { BenchCase } from './lib/dataset';
import { loadDataset, RESEARCH_DIR, RESULTS_DIR } from './lib/io';
import { cohenKappa } from './lib/metrics';
import { mulberry32 } from './lib/split';

const SEED = 20261107;
const cases = loadDataset('set:v2', 'all');
const sourceOf = (c: BenchCase) => c.source.split(':')[0] ?? c.source;

function agreement(list: BenchCase[]) {
  const a = list.map((c) => c.levelA ?? '');
  const b = list.map((c) => c.levelB ?? '');
  const same = a.filter((x, i) => x === b[i]).length;
  const distinct = new Set([...a, ...b]).size;
  return {
    n: list.length,
    agree: same,
    agreeRate: list.length ? same / list.length : 0,
    kappa: distinct > 1 ? cohenKappa(a, b) : null,
    goldEqualsA: list.filter((c) => c.gold === c.levelA).length,
    goldEqualsB: list.filter((c) => c.gold === c.levelB).length,
    bHeavierThanA: list.filter((c) => rank(c.levelB) > rank(c.levelA)).length,
    aHeavierThanB: list.filter((c) => rank(c.levelA) > rank(c.levelB)).length,
  };
}

const ORDER: RiskLevel[] = ['low', 'attention', 'high', 'critical'];
function rank(level: RiskLevel | undefined): number {
  return level ? ORDER.indexOf(level) : -1;
}

const audit = {
  dataset: 'set:v2',
  createdAt: new Date().toISOString().slice(0, 10),
  all: agreement(cases),
  bySource: Object.fromEntries(['chuyen_the', 'ai_sinh_da_sua', 'tu_viet'].map((s) => [s, agreement(cases.filter((c) => sourceOf(c) === s))])),
  scamOnly: agreement(cases.filter((c) => c.kind === 'scam')),
  note: 'Mốc theo từng tin chưa có người gán thứ hai độc lập. Dùng phiếu gán nhãn để đo.',
};
writeFileSync(join(RESEARCH_DIR, 'experiments', 'label_audit.json'), JSON.stringify(audit, null, 2) + '\n');

// Phiếu ẩn nhãn: trộn thứ tự theo seed, không có nhãn, nguồn, nhóm, loại ca, kết quả của luật
const rand = mulberry32(SEED);
const shuffled = cases
  .map((c) => ({ c, k: rand() }))
  .sort((x, y) => x.k - y.k)
  .map((x) => x.c);
const outDir = join(RESULTS_DIR, 'labeling');
mkdirSync(outDir, { recursive: true });

const render = (c: BenchCase) => {
  let turn = 0;
  return c.messages
    .map((m) => {
      if (m.sender === 'self') return `TOI: ${m.text}`;
      turn += 1;
      return `DP${turn}: ${m.text}`;
    })
    .join('\n');
};
const header = ['ma_phieu', 'hoi_thoai', 'muc_cuoi', 'moc_muc', 'ghi_chu'];
const rows = shuffled.map((c) => ({ ma_phieu: createHash('sha256').update(`${SEED}:${c.id}`).digest('hex').slice(0, 8), hoi_thoai: render(c) }));
writeFileSync(join(outDir, 'phieu_gan_nhan_doc_lap.csv'), '﻿' + toCsv(header, rows));
writeFileSync(
  join(outDir, 'khoa_phieu.json'),
  JSON.stringify(Object.fromEntries(shuffled.map((c) => [createHash('sha256').update(`${SEED}:${c.id}`).digest('hex').slice(0, 8), c.id]))),
);
console.log(JSON.stringify(audit, null, 1));
console.log(`Phiếu gán nhãn: ${join(outDir, 'phieu_gan_nhan_doc_lap.csv')} (${rows.length} ca)`);
