// npm run bench:analyze-rules [-- --dataset set:v2 --out rule_analysis]
// Chạy bộ luật trên bộ đề, xuất dữ liệu cho research/notebooks/phan_tich_luat.ipynb.
// Tập tune: có chi tiết từng tin để đọc lỗi. Tập check: CHỈ có số tổng, không ghi nội dung hay mã ca.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '@safechat/core/analyzer';
import { normalizeForMatch } from '@safechat/core/normalize';
import { ALL_RULES } from '@safechat/core/rules/index';
import { parseCsv } from './lib/csv';
import { computeMetrics, type Prediction } from './lib/metrics';
import type { BenchCase } from './lib/dataset';
import { arg, DATA_DIR, loadDataset, RESEARCH_DIR, RESULTS_DIR } from './lib/io';
import { caseReplayStats, replayCase } from './lib/replay';
import { hashSplit, tuneCheckSplit, type TuneCheckSplit } from './lib/tunecheck';

const dataset = arg('dataset', 'set:v2') ?? 'set:v2';
const outDir = join(RESULTS_DIR, arg('out', 'rule_analysis') ?? 'rule_analysis');
const CHECK_SIZE = 40;
const SEED = 20261107;

const cases = loadDataset(dataset, 'all');
const splitFile = join(RESEARCH_DIR, 'splits', `${dataset.replace(/\W+/g, '_')}_tune_check.json`);

function loadOrCreateSplit(): TuneCheckSplit {
  if (existsSync(splitFile)) {
    const s = JSON.parse(readFileSync(splitFile, 'utf8')) as TuneCheckSplit;
    if (hashSplit(s.tune, s.check) !== s.sha256) throw new Error(`${splitFile} đã bị sửa, không khớp mã băm`);
    return s;
  }
  const s = tuneCheckSplit(cases, CHECK_SIZE, SEED);
  mkdirSync(join(RESEARCH_DIR, 'splits'), { recursive: true });
  writeFileSync(splitFile, JSON.stringify(s, null, 2) + '\n');
  console.log(`Đã khóa tập tune/check: ${splitFile}`);
  return s;
}

const split = loadOrCreateSplit();
const tuneIds = new Set(split.tune);
const checkIds = new Set(split.check);

// Cột bối cảnh chỉ có trong bản CSV đã nhập, không có trong cases.json
const contextById = new Map<string, Record<string, string>>();
const csvFile = dataset.startsWith('set:') ? join(DATA_DIR, 'sets', dataset.slice(4), 'dataset.csv') : '';
if (csvFile && existsSync(csvFile)) {
  for (const { values } of parseCsv(readFileSync(csvFile, 'utf8')).rows) contextById.set(values.id ?? '', values);
}

function sourceType(c: BenchCase): string {
  return c.source.split(':')[0] ?? c.source;
}

function predictionOf(c: BenchCase, pred: Prediction['pred']): Prediction {
  return { caseId: c.id, gold: c.gold, pred, kind: c.kind, group: c.group, tags: c.tags };
}

function brief(preds: Prediction[]) {
  const m = computeMetrics(preds);
  return {
    n: m.n,
    accuracy: m.accuracy,
    accuracyCI: m.accuracyCI,
    macroF1: m.macroF1,
    dangerMiss: m.dangerMissRate,
    dangerRecall: m.dangerRecall,
    criticalRecall: m.criticalRecall,
    falseAlarm: m.benignFalseAlarm,
    ordinalMAE: m.ordinalMAE,
    confusion: m.confusion,
    byGroup: m.byGroup,
  };
}

function tally(list: BenchCase[], key: (c: BenchCase) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of list) out[key(c)] = (out[key(c)] ?? 0) + 1;
  return out;
}

/** Thống kê phân bố, không chứa mã ca hay nội dung, nên dùng được cho cả tập check. */
function shape(list: BenchCase[]) {
  return {
    n: list.length,
    messages: list.reduce((s, c) => s + c.messages.length, 0),
    dpMessages: list.reduce((s, c) => s + c.messages.filter((m) => m.sender !== 'self').length, 0),
    kind: tally(list, (c) => c.kind),
    gold: tally(list, (c) => c.gold),
    group: tally(list, (c) => String(c.group)),
    source: tally(list, sourceType),
    stage: tally(list, (c) => c.stage ?? '-'),
  };
}

const finalPreds = new Map<string, Prediction>();
const replayPreds = new Map<string, Prediction>();
const tuneRows: unknown[] = [];
for (const c of cases) {
  const result = analyze(c.messages);
  const replay = await replayCase(c);
  finalPreds.set(c.id, predictionOf(c, result.risk_level));
  replayPreds.set(c.id, predictionOf(c, replay.finalLevel));
  if (!tuneIds.has(c.id)) continue; // Không ghi chi tiết ca thuộc check

  const ctx = contextById.get(c.id) ?? {};
  let dpTurn = 0;
  tuneRows.push({
    id: c.id,
    group: c.group,
    kind: c.kind,
    tags: c.tags,
    sourceType: sourceType(c),
    note: c.note ?? '',
    gold: c.gold,
    levelA: c.levelA ?? null,
    levelB: c.levelB ?? null,
    stage: c.stage ?? null,
    expectedRule: c.expectedRule ?? null,
    dangerTurn: c.dangerTurn ?? null,
    context: ctx.boi_canh ?? '',
    relation: ctx.quan_he ?? '',
    toneOther: ctx.giong_dp ?? '',
    toneSelf: ctx.giong_toi ?? '',
    pred: result.risk_level,
    replayPred: replay.finalLevel,
    score: result.score,
    signals: result.signals.map((s) => ({
      type: s.type,
      category: s.category,
      severity: s.severity,
      source: s.source,
      directDanger: !!s.direct_danger,
      mitigation: s.mitigation ?? null,
      messageIds: s.evidence_message_ids,
    })),
    checkpoints: c.checkpoints ?? [],
    turns: replay.turns.map((t) => ({ dpTurn: t.dpTurn, level: t.level, rawLevel: t.rawLevel })),
    stats: caseReplayStats(c, replay),
    messages: c.messages.map((m) => {
      const isOther = m.sender !== 'self';
      if (isOther) dpTurn += 1;
      return {
        id: m.id,
        sender: m.sender,
        dpTurn: isOther ? dpTurn : null,
        text: m.text,
        normalized: normalizeForMatch(m.text),
        rules: result.signals.filter((s) => s.evidence_message_ids.includes(m.id)).map((s) => s.type),
      };
    }),
  });
}

function pick(map: Map<string, Prediction>, ids: Set<string>): Prediction[] {
  return [...map.values()].filter((p) => ids.has(p.caseId));
}

// SMS thật đã ẩn danh, chỉ phần dev: kiểm tra mẫu mới có bắt nhầm tin bình thường không
const smsDev = existsSync(join(DATA_DIR, 'external', 'sms', 'cases.json')) ? loadDataset('ext:sms', 'dev') : [];
const smsRows = smsDev.map((c) => {
  const text = c.messages.map((m) => m.text).join(' ');
  return {
    kind: c.kind === 'scam' ? 'scam' : 'benign',
    text,
    normalized: normalizeForMatch(text),
    pred: analyze(c.messages).risk_level,
    rules: analyze(c.messages).signals.map((s) => s.type),
  };
});

const inventory = ALL_RULES.map((r) => ({
  type: r.type,
  ref: r.ref ?? '',
  category: r.category,
  severity: r.severity,
  directDanger: !!r.direct_danger,
  mode: r.groups ? `nhiều khía cạnh (cần ${r.minGroups ?? 2})` : 'một tin',
  title: r.title,
}));

const labelPairs: Record<string, number> = {};
for (const c of cases) {
  const key = `${c.levelA}|${c.levelB}`;
  labelPairs[key] = (labelPairs[key] ?? 0) + 1;
}

const normalizationExamples = [
  'Em ck 500k cho a nha, stk a gửi r',
  'ko cần đóng phí j đâu ạ',
  'c.h.u.y.ể.n t1ền trước 8tr',
  'Đọc giúp em mã OTP nhé',
  'NV 3 hoàn thành xong sẽ được rút lãi',
].map((text) => ({ text, normalized: normalizeForMatch(text) }));

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  if (execSync('git status --porcelain packages/core', { encoding: 'utf8' }).trim()) commit += '+dirty';
} catch {
  /* không có git thì bỏ qua */
}

const tuneCases = cases.filter((c) => tuneIds.has(c.id));
const checkCases = cases.filter((c) => checkIds.has(c.id));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tune_cases.json'), JSON.stringify(tuneRows));
writeFileSync(join(outDir, 'sms_dev.json'), JSON.stringify(smsRows));
writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify(
    {
      dataset,
      createdAt: new Date().toISOString(),
      rulesCommit: commit,
      splitSha256: split.sha256,
      splitSeed: split.seed,
      counts: { tune: split.tune.length, check: split.check.length },
      shape: { all: shape(cases), tune: shape(tuneCases), check: shape(checkCases) },
      labelPairs,
      labelFinalEqualsA: cases.filter((c) => c.gold === c.levelA).length,
      labelFinalEqualsB: cases.filter((c) => c.gold === c.levelB).length,
      final: { tune: brief(pick(finalPreds, tuneIds)), check: brief(pick(finalPreds, checkIds)) },
      replay: { tune: brief(pick(replayPreds, tuneIds)), check: brief(pick(replayPreds, checkIds)) },
      inventory,
      normalizationExamples,
    },
    null,
    2,
  ),
);
console.log(`Xong: ${split.tune.length} tune, ${split.check.length} check, ${smsRows.length} SMS dev → ${outDir}`);
