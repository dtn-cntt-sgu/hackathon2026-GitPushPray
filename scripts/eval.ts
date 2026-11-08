// Đánh giá bộ quy tắc trên fixtures/scenarios.json (mục 13.2 kế hoạch).
// Chạy: npm run eval
//   --json              chỉ in JSON chỉ số (dùng cho hook)
//   --update-baseline   ghi chỉ số hiện tại vào fixtures/eval-baseline.json
//   --check             so với mốc; tụt chất lượng → in lý do và thoát mã 1 (dùng trong npm run check)
// Tình huống có "pending": true (đang chờ luật mới) được báo riêng và KHÔNG tính vào chỉ số chính/mốc.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyze } from '@safechat/core/analyzer';
import { RISK_LEVEL_LABEL, RISK_LEVEL_ORDER } from '@safechat/core/types';
import { scenarios } from '../fixtures/scenarios';

const asJson = process.argv.includes('--json');
const updateBaseline = process.argv.includes('--update-baseline');
const checkBaseline = process.argv.includes('--check');
const log = (s = '') => {
  if (!asJson) console.log(s);
};

let total = 0;
let tp = 0;
let fp = 0;
let fn = 0;
let levelOk = 0;
let dangerTotal = 0;
let dangerHit = 0;
let benignTotal = 0;
let benignFlagged = 0;
let maxMs = 0;
let pendingTotal = 0;
let pendingOk = 0;

log('\nKết quả từng tình huống\n');
for (const s of scenarios) {
  const t0 = performance.now();
  const r = analyze(s.messages);
  const ms = performance.now() - t0;
  maxMs = Math.max(maxMs, ms);

  const got = new Set(r.signals.map((x) => x.type));
  const want = new Set(s.expected.signals);
  const sTp = [...want].filter((t) => got.has(t)).length;
  const sFn = want.size - sTp;
  // Tín hiệu ngoài kỳ vọng chỉ tính FP khi nằm trong danh sách cấm hoặc tình huống kỳ vọng mức Thấp
  // Tín hiệu đã hạ mức do ngữ cảnh hợp lệ chỉ mang tính thông tin, không tính là cảnh báo nhầm
  const active = new Set(r.signals.filter((x) => !x.mitigation).map((x) => x.type));
  const extra = [...active].filter((t) => !want.has(t));
  const forbidden = s.expected.forbidden ?? [];
  const sFp = s.expected.level === 'low' ? extra.length : extra.filter((t) => forbidden.includes(t)).length;
  const ok = r.risk_level === s.expected.level && sFn === 0 && sFp === 0;

  if (s.pending) {
    pendingTotal++;
    if (ok) pendingOk++;
  } else {
    total++;
    tp += sTp;
    fn += sFn;
    fp += sFp;
    if (r.risk_level === s.expected.level) levelOk++;
    if (RISK_LEVEL_ORDER[s.expected.level] >= RISK_LEVEL_ORDER.high) {
      dangerTotal++;
      if (RISK_LEVEL_ORDER[r.risk_level] >= RISK_LEVEL_ORDER.high) dangerHit++;
    }
    if (s.expected.level === 'low') {
      benignTotal++;
      if (r.risk_level !== 'low') benignFlagged++;
    }
  }

  const mark = s.pending ? (ok ? '.. ' : '-- ') : ok ? 'OK ' : 'XX ';
  log(
    `${mark}${s.id.padEnd(30)} ${RISK_LEVEL_LABEL[r.risk_level].padEnd(13)} (kỳ vọng ${RISK_LEVEL_LABEL[s.expected.level]}) điểm ${String(r.score).padStart(3)}  [${[...got].join(', ')}]`,
  );
}

const metrics = {
  total,
  levelOk,
  levelAccuracy: total ? levelOk / total : 1,
  tp,
  fp,
  fn,
  precision: tp + fp ? tp / (tp + fp) : 1,
  recall: tp + fn ? tp / (tp + fn) : 1,
  dangerHit,
  dangerTotal,
  benignFlagged,
  benignTotal,
  pendingOk,
  pendingTotal,
  maxMs: Number(maxMs.toFixed(2)),
};

if (asJson) {
  console.log(JSON.stringify(metrics));
} else {
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');
  log('\nChỉ số (trên bộ giả lập — không đại diện cho dữ liệu thật; không tính tình huống pending)\n');
  log(`Số tình huống                 : ${total}`);
  log(`Đúng mức cảnh báo             : ${levelOk}/${total} (${pct(levelOk, total)})`);
  log(`Precision tín hiệu            : ${pct(tp, tp + fp)}  (TP ${tp}, FP ${fp})`);
  log(`Recall tín hiệu               : ${pct(tp, tp + fn)}  (FN ${fn})`);
  log(`Recall tình huống Cao/Nghiêm trọng: ${dangerHit}/${dangerTotal}`);
  log(`Cảnh báo sai ở tình huống bình thường: ${benignFlagged}/${benignTotal}`);
  log(`Độ trễ phân tích lớn nhất     : ${maxMs.toFixed(2)} ms`);
  if (pendingTotal) log(`Tình huống pending đã đạt     : ${pendingOk}/${pendingTotal} (đánh dấu .. là đạt, -- là chưa)`);
  log();
}

if (checkBaseline && !updateBaseline) {
  const base = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/eval-baseline.json'), 'utf8'));
  const eps = 1e-9;
  const regress: string[] = [];
  if (metrics.levelAccuracy + eps < base.levelAccuracy) regress.push(`Đúng mức ${metrics.levelOk}/${metrics.total} < mốc ${base.levelOk}/${base.total}`);
  if (metrics.recall + eps < base.recall) regress.push(`Recall tín hiệu ${(metrics.recall * 100).toFixed(1)}% < mốc ${(base.recall * 100).toFixed(1)}%`);
  if (metrics.dangerHit / (metrics.dangerTotal || 1) + eps < base.dangerHit / (base.dangerTotal || 1))
    regress.push(`Recall tình huống nguy hiểm ${metrics.dangerHit}/${metrics.dangerTotal} < mốc ${base.dangerHit}/${base.dangerTotal}`);
  if (metrics.benignFlagged > base.benignFlagged) regress.push(`Cảnh báo sai ở tình huống bình thường ${metrics.benignFlagged} > mốc ${base.benignFlagged}`);
  if (regress.length) {
    console.error(`Chất lượng TỤT so với mốc fixtures/eval-baseline.json:\n- ${regress.join('\n- ')}`);
    process.exit(1);
  }
  if (!asJson) console.log('Không tụt so với mốc.');
}

if (updateBaseline) {
  const file = resolve(import.meta.dirname, '../fixtures/eval-baseline.json');
  writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), ...metrics }, null, 2) + '\n');
  if (!asJson) console.log('Đã cập nhật mốc:', file);
}
