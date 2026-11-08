// npm run bench:report -- --runs <runId1,runId2>   (bỏ trống = lần chạy mới nhất)
// Tạo research/reports/<ngày>_<runId>.md và .html: bảng xếp hạng, ma trận nhầm lẫn, theo nhóm/biến thể, ca sai tiêu biểu.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from '@safechat/core/export';
import { RISK_LEVEL_LABEL } from '@safechat/core/types';
import { arg, DATA_DIR, hasTuneCheckSplit, loadDataset, REPORTS_DIR, RESULTS_DIR } from './lib/io';
import { computeMetrics, LEVELS, meanPairwiseKappa, percentile, type Metrics } from './lib/metrics';
import { computeReplayMetrics } from './lib/replay';
import type { ResultRow } from './run';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (c: [number, number]) => `${(c[0] * 100).toFixed(0)}–${(c[1] * 100).toFixed(0)}`;

let runIds = (arg('runs') ?? '').split(',').filter(Boolean);
if (!runIds.length) {
  const metas = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.meta.json')).sort() : [];
  if (!metas.length) {
    console.error('Chưa có lần chạy nào trong research/results.');
    process.exit(1);
  }
  runIds = [metas.at(-1)!.replace('.meta.json', '')];
}

const rows: ResultRow[] = runIds.flatMap((id) =>
  readFileSync(join(RESULTS_DIR, `${id}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ResultRow),
);
const metas = runIds.map((id) => JSON.parse(readFileSync(join(RESULTS_DIR, `${id}.meta.json`), 'utf8')));
const prices = existsSync(join(DATA_DIR, 'models.json'))
  ? new Map(
      (JSON.parse(readFileSync(join(DATA_DIR, 'models.json'), 'utf8')).models as { id: string; paidPrice?: { prompt: number; completion: number } }[]).map(
        (m) => [m.id, m.paidPrice],
      ),
    )
  : new Map();

interface Row {
  key: string;
  config: string;
  model: string;
  m: Metrics;
  stability?: number;
  jsonValid: number;
  rejectedPerCase: number;
  schemaDroppedPerCase: number;
  p50?: number;
  p95?: number;
  tokens: number;
  costPer1k?: number;
}

const groups = new Map<string, ResultRow[]>();
for (const r of rows) groups.set(`${r.config}|${r.model}`, [...(groups.get(`${r.config}|${r.model}`) ?? []), r]);

const table: Row[] = [];
for (const [key, rs] of groups) {
  const first = rs.filter((r) => r.repeat === 0);
  const m = computeMetrics(first.map((r) => ({ caseId: r.caseId, gold: r.gold, pred: r.pred, kind: r.kind as never, group: r.group, tags: r.tags })));
  const reps = [...new Set(rs.map((r) => r.repeat))];
  let stability: number | undefined;
  if (reps.length > 1) {
    const ids = first.map((r) => r.caseId);
    const runsLabels = reps.map((rep) => ids.map((id) => rs.find((r) => r.repeat === rep && r.caseId === id)?.pred ?? 'none'));
    stability = meanPairwiseKappa(runsLabels);
  }
  const live = first.filter((r) => r.latencyMs !== undefined && !r.cached).map((r) => r.latencyMs!);
  const tokIn = first.reduce((s, r) => s + (r.promptTokens ?? 0), 0);
  const tokOut = first.reduce((s, r) => s + (r.completionTokens ?? 0), 0);
  const price = prices.get(first[0]?.model ?? '') as { prompt: number; completion: number } | undefined;
  const ai = first[0]?.config !== 'rules';
  table.push({
    key,
    config: first[0]?.config ?? key,
    model: first[0]?.model ?? '-',
    m,
    stability,
    jsonValid: ai ? first.filter((r) => r.jsonValid).length / first.length : 1,
    rejectedPerCase: ai ? first.reduce((s, r) => s + (r.rejected ?? 0), 0) / first.length : 0,
    schemaDroppedPerCase: ai ? first.reduce((s, r) => s + (r.schemaDropped ?? 0), 0) / first.length : 0,
    p50: live.length ? percentile(live, 50) : undefined,
    p95: live.length ? percentile(live, 95) : undefined,
    tokens: tokIn + tokOut,
    costPer1k: price && first.length ? ((tokIn * price.prompt + tokOut * price.completion) / first.length) * 1000 : undefined,
  });
}
// Xếp hạng: ưu tiên ít bỏ sót nguy hiểm, rồi độ chính xác
table.sort((a, b) => a.m.dangerMissRate - b.m.dangerMissRate || b.m.accuracy - a.m.accuracy);

// ---------- dựng báo cáo dạng khối, xuất ra cả Markdown và HTML ----------
type Block = { h: string } | { p: string } | { table: string[][] };
const blocks: Block[] = [];
const date = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD theo giờ máy
blocks.push({ h: `Báo cáo đánh giá SafeChat AI — ${date}` });
blocks.push({
  p: `Lần chạy: ${metas.map((m) => `${m.runId} (${m.dataset}/${m.split}, ${m.n} ca, luật ${m.rulesCommit}, prompt ${m.promptVersion}${m.testLock && m.dataset !== 'fixtures' ? `, khóa test ${m.testLock}` : ''}${m.stoppedEarly ? ', DỪNG SỚM' : ''})`).join('; ')}.`,
});
blocks.push({
  p: 'Nhãn là mức do người gán (muc_chot). "Bỏ sót nguy hiểm" = ca nhãn ≥ Cao nhưng hệ thống chấm < Cao — chỉ số quan trọng nhất. Ngoặc vuông là khoảng tin cậy 95% (bootstrap). Chi phí quy đổi theo giá bản trả phí của cùng model; bản :free hiện là 0đ.',
});
if (metas.some((m) => m.dataset === 'fixtures'))
  blocks.push({ p: '⚠ Bộ "fixtures" do chính người viết luật soạn — chỉ để thử đường ống, KHÔNG dùng làm số liệu nghiên cứu.' });

blocks.push({ h: 'Bảng xếp hạng' });
blocks.push({
  table: [
    ['Cấu hình', 'Model', 'n', 'Đúng mức [CI]', 'Macro-F1', 'Bắt được nguy hiểm [CI]', 'Bỏ sót nguy hiểm', 'Bắt Nghiêm trọng', 'Báo nhầm (bình thường / dễ nhầm)', 'Sai số bậc', 'Không trả lời', 'JSON hợp lệ', 'Ổn định κ', 'Trễ p50/p95', 'Chi phí/1000 hội thoại'],
    ...table.map((r) => [
      r.config,
      r.model,
      String(r.m.n),
      `${pct(r.m.accuracy)} [${ci(r.m.accuracyCI)}]`,
      r.m.macroF1.toFixed(3),
      `${pct(r.m.dangerRecall)} [${ci(r.m.dangerRecallCI)}]`,
      pct(r.m.dangerMissRate),
      pct(r.m.criticalRecall),
      `${pct(r.m.benignFalseAlarm)} / ${pct(r.m.confusableFalseAlarm)}`,
      r.m.ordinalMAE.toFixed(2),
      pct(r.m.noAnswerRate),
      pct(r.jsonValid),
      r.stability === undefined ? '–' : r.stability.toFixed(2),
      r.p50 === undefined ? '–' : `${(r.p50 / 1000).toFixed(1)}s / ${(r.p95! / 1000).toFixed(1)}s`,
      r.costPer1k === undefined ? (r.config === 'rules' ? '0 (chạy trên máy)' : '–') : `$${r.costPer1k.toFixed(3)}`,
    ]),
  ],
});

// ---------- Theo dõi diễn biến (chế độ phát lại từng tin) ----------
const replayKeys = [...groups.keys()].filter((k) => groups.get(k)!.some((r) => r.replay));
if (replayKeys.length) {
  blocks.push({ h: 'Theo dõi diễn biến (phát lại từng tin)' });
  blocks.push({
    p: 'Mỗi hội thoại được phát lại từng tin như phiên thật. "Đúng tại mốc" chấm mức sau tin đối phương thứ k theo cột moc_muc (ca không có mốc: chấm ở tin cuối). "Độ trễ" = số tin đối phương chậm hơn nhãn khi lên ≥ Cao (âm = sớm hơn). "Báo động quá sớm" = hệ thống ≥ Cao khi nhãn còn < Cao. "Dao động" = ca có ít nhất một lần mức đổi chiều.',
  });
  const rmRows = replayKeys.map((k) => {
    const rs = groups.get(k)!.filter((r) => r.repeat === 0 && r.replay);
    const m = computeReplayMetrics(
      rs.map((r) => r.replay!),
      rs.reduce((a, r) => a + (r.dpTurns ?? 0), 0),
      rs.filter((r) => r.hasCheckpoints).length,
    );
    return { k: rs[0]!, m, withCp: rs.filter((r) => r.hasCheckpoints).length };
  });
  const d = (x?: number) => (x === undefined ? '–' : x.toFixed(1));
  blocks.push({
    table: [
      ['Cấu hình', 'Model', 'Ca (có mốc)', 'Số mốc', 'Đúng tại mốc', 'Chấm thấp / cao tại mốc', 'Bỏ sót nguy hiểm tại mốc', 'Phát hiện đúng lúc / muộn / không bao giờ', 'Độ trễ trung vị (TB)', 'Báo động quá sớm', 'Dao động (TB lần)', 'Hạ mức vô cớ', 'Lượt AI / ca (/10 tin)'],
      ...rmRows.map(({ k, m, withCp }) => [
        k.config,
        k.model,
        `${m.cases} (${withCp})`,
        String(m.checkpoints),
        pct(m.checkpointAccuracy),
        `${pct(m.checkpointUnderRate)} / ${pct(m.checkpointOverRate)}`,
        pct(m.checkpointDangerMissRate),
        `${pct(m.onTimeRate)} / ${pct(m.lateRate)} / ${pct(m.neverRate)}`,
        `${d(m.medianDelay)} (${d(m.meanDelay)})`,
        withCp ? pct(m.prematureCaseRate) : '– (chưa có mốc)',
        `${pct(m.oscillationCaseRate)} (${m.meanDirectionChanges.toFixed(2)})`,
        pct(m.unwarrantedDropCaseRate),
        `${m.aiCallsPerCase.toFixed(2)} (${m.aiCallsPer10Turns.toFixed(2)})`,
      ]),
    ],
  });
}

for (const r of table) {
  blocks.push({ h: `Ma trận nhầm lẫn — ${r.config}${r.model !== '-' ? ` · ${r.model}` : ''}` });
  blocks.push({
    table: [
      ['Nhãn \\ Dự đoán', ...LEVELS.map((l) => RISK_LEVEL_LABEL[l]), 'Lỗi'],
      ...LEVELS.map((l, i) => [RISK_LEVEL_LABEL[l], ...r.m.confusion[i]!.map(String)]),
    ],
  });
}

const groupKeys = [...new Set(table.flatMap((r) => Object.keys(r.m.byGroup)))].sort((a, b) => Number(a) - Number(b));
if (groupKeys.length > 1) {
  blocks.push({ h: 'Độ chính xác theo nhóm kịch bản' });
  blocks.push({
    table: [
      ['Cấu hình · model', ...groupKeys.map((g) => `Nhóm ${g}`)],
      ...table.map((r) => [`${r.config} · ${r.model}`, ...groupKeys.map((g) => (r.m.byGroup[g] ? `${pct(r.m.byGroup[g]!.accuracy)} (${r.m.byGroup[g]!.n})` : '–'))]),
    ],
  });
}
const tagKeys = [...new Set(table.flatMap((r) => Object.keys(r.m.byTag)))].sort();
if (tagKeys.length) {
  blocks.push({ h: 'Độ chính xác theo biến thể khó' });
  blocks.push({
    table: [
      ['Cấu hình · model', ...tagKeys],
      ...table.map((r) => [`${r.config} · ${r.model}`, ...tagKeys.map((t) => (r.m.byTag[t] ? `${pct(r.m.byTag[t]!.accuracy)} (${r.m.byTag[t]!.n})` : '–'))]),
    ],
  });
}

// Tập check / không phải tune của bộ đã khóa: chỉ xuất số tổng, tuyệt đối không in danh sách từng ca để tránh lộ nội dung check
const hideCaseDetails = metas.some((m) => m.split === 'check' || m.split === 'test' || (hasTuneCheckSplit(m.dataset) && m.split !== 'tune'));
const best = table[0];
if (hideCaseDetails) {
  blocks.push({
    p: '🔒 Chế độ bảo vệ tập check/test: báo cáo chỉ xuất số tổng hợp, ẩn hoàn toàn danh sách và nội dung từng ca.',
  });
} else if (best) {
  const firstRows = groups.get(best.key)!.filter((r) => r.repeat === 0);
  const misses = firstRows.filter((r) => ['high', 'critical'].includes(r.gold) && !['high', 'critical'].includes(r.pred ?? ''));
  if (misses.length) {
    const ds = metas[0]?.dataset ?? 'bench';
    const byId = new Map(loadDataset(ds, 'all').map((c) => [c.id, c]));
    blocks.push({ h: `Ca bỏ sót nguy hiểm — ${best.config} · ${best.model} (${misses.length} ca, tối đa 15)` });
    blocks.push({
      table: [
        ['id', 'Nhãn', 'Dự đoán', 'Tín hiệu', 'Tin đối phương đầu tiên'],
        ...misses.slice(0, 15).map((r) => [
          r.caseId,
          RISK_LEVEL_LABEL[r.gold],
          r.pred ? RISK_LEVEL_LABEL[r.pred] : 'Lỗi',
          r.signals.join(', ') || '–',
          (byId.get(r.caseId)?.messages.find((m) => m.sender === 'other')?.text ?? '').slice(0, 90),
        ]),
      ],
    });
  }
}

const md = blocks
  .map((b) =>
    'h' in b
      ? `## ${b.h}`
      : 'p' in b
        ? b.p
        : [b.table[0]!, b.table[0]!.map(() => '---'), ...b.table.slice(1)].map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`).join('\n'),
  )
  .join('\n\n');
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Báo cáo đánh giá SafeChat AI</title>
<style>
:root{--bg:#fff;--fg:#1d2330;--muted:#5a6372;--line:#e3e7ee;--head:#f3f5f9}
@media (prefers-color-scheme:dark){:root{--bg:#15181e;--fg:#e6e9ef;--muted:#9aa3b2;--line:#323846;--head:#1e222a}}
body{font:14px/1.5 system-ui,sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;background:var(--bg);color:var(--fg)}
h2{font-size:18px;margin-top:28px} p{color:var(--muted)}
.wrap{overflow-x:auto} table{border-collapse:collapse;font-size:13px;min-width:100%}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top;white-space:nowrap} th{background:var(--head)}
td:last-child{white-space:normal}
</style></head><body>
${blocks
  .map((b) =>
    'h' in b
      ? `<h2>${escapeHtml(b.h)}</h2>`
      : 'p' in b
        ? `<p>${escapeHtml(b.p)}</p>`
        : `<div class="wrap"><table><thead><tr>${b.table[0]!.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${b.table
            .slice(1)
            .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></div>`,
  )
  .join('\n')}
</body></html>`;

mkdirSync(REPORTS_DIR, { recursive: true });
// --out <tên>: đặt tên file báo cáo (bench:archive dùng để lưu đúng tên theo đợt)
const base = join(REPORTS_DIR, arg('out') ?? `${date}_${runIds.length === 1 ? runIds[0] : `${runIds.length}-runs`}`);
writeFileSync(`${base}.md`, md + '\n');
writeFileSync(`${base}.html`, html);
console.log(md.split('\n').slice(0, 12).join('\n'));
console.log(`\nBáo cáo: ${base}.md\n         ${base}.html`);
