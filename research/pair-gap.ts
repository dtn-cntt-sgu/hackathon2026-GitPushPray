// npm run bench:pair-gap -- research/dataset/doi_chung_ban_nhap.csv
// Chạy bộ luật trên bộ cặp đối chứng để tìm chỗ thiếu khi viết luật. Bộ này đã lộ và là nguồn gợi ý luật, nên
// kết quả không phải số đo: không ghi vào sổ thí nghiệm, không đưa vào báo cáo. Kết quả nằm ở research/results (không lên repo).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '@safechat/core/analyzer';
import { parseCsv } from './lib/csv';
import { parseMessages } from './lib/dataset';
import { RESULTS_DIR } from './lib/io';

const file = process.argv[2];
if (!file) throw new Error('Cần đường dẫn file CSV');
const { rows } = parseCsv(readFileSync(file, 'utf8'));

const out = rows.map(({ values: v }) => {
  const { messages, error } = parseMessages(v.hoi_thoai ?? '');
  if (error) throw new Error(`${v.id}: ${error}`);
  const r = analyze(messages);
  return {
    id: v.id!,
    kind: v.loai!,
    level: r.risk_level,
    score: r.score,
    signals: r.signals.map((s) => ({ type: s.type, severity: s.severity, mitigation: !!s.mitigation, msg: s.evidence_message_ids })),
  };
});

const dir = join(RESULTS_DIR, 'pair_gap');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'ket_qua.json'), JSON.stringify(out, null, 2));
for (const c of out) {
  const types = c.signals.map((s) => `${s.mitigation ? '~' : ''}${s.type}`).join(', ');
  console.log(`${c.id.padEnd(11)} ${c.level.padEnd(9)} ${String(c.score).padStart(3)}  ${types}`);
}
