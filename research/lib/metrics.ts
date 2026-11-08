// Chỉ số đánh giá cho nghiên cứu. Thuần logic, test được bằng Vitest.
import type { RiskLevel } from '@safechat/core/types';
import type { CaseKind } from './dataset';
import { mulberry32 } from './split';

export const LEVELS: RiskLevel[] = ['low', 'attention', 'high', 'critical'];
const IDX: Record<RiskLevel, number> = { low: 0, attention: 1, high: 2, critical: 3 };

export interface Prediction {
  caseId: string;
  gold: RiskLevel;
  /** null khi model lỗi/không trả JSON hợp lệ — tính là sai và là "chấm thấp" nếu gold > Thấp. */
  pred: RiskLevel | null;
  kind: CaseKind;
  group: number;
  tags?: string[];
}

export interface Metrics {
  n: number;
  accuracy: number;
  accuracyCI: [number, number];
  macroF1: number;
  /** confusion[gold][pred], pred cột 5 = lỗi/không trả lời */
  confusion: number[][];
  /** Tỷ lệ dự đoán thấp hơn nhãn (kể cả lỗi khi nhãn > Thấp). */
  underRate: number;
  overRate: number;
  /** Ca nhãn ≥ Cao mà dự đoán < Cao — "bỏ sót nguy hiểm". */
  dangerMissRate: number;
  dangerRecall: number;
  dangerRecallCI: [number, number];
  criticalRecall: number;
  /** Ca bình thường (benign*) bị dự đoán ≥ Cần chú ý. */
  benignFalseAlarm: number;
  confusableFalseAlarm: number;
  /** Sai số trung bình theo bậc (0–3), lỗi tính bằng khoảng cách tới Thấp. */
  ordinalMAE: number;
  noAnswerRate: number;
  byGroup: Record<string, { n: number; accuracy: number }>;
  byTag: Record<string, { n: number; accuracy: number }>;
}

const ratio = (a: number, b: number) => (b ? a / b : 0);

function f1For(cls: number, conf: number[][]): number {
  const tp = conf[cls]![cls]!;
  const fp = conf.reduce((s, row, g) => s + (g === cls ? 0 : row[cls]!), 0);
  const fn = conf[cls]!.reduce((s, v, p) => s + (p === cls ? 0 : v), 0);
  const p = ratio(tp, tp + fp);
  const r = ratio(tp, tp + fn);
  return p + r ? (2 * p * r) / (p + r) : 0;
}

/** Khoảng tin cậy 95% bằng bootstrap (seed cố định). */
export function bootstrapCI(values: number[], iterations = 1000, seed = 7): [number, number] {
  if (!values.length) return [0, 0];
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let k = 0; k < iterations; k++) {
    let s = 0;
    for (let i = 0; i < values.length; i++) s += values[Math.floor(rand() * values.length)]!;
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iterations * 0.025)]!, means[Math.floor(iterations * 0.975)]!];
}

export function computeMetrics(preds: Prediction[]): Metrics {
  const conf = LEVELS.map(() => [0, 0, 0, 0, 0]);
  let under = 0;
  let over = 0;
  let mae = 0;
  let noAnswer = 0;
  const correct: number[] = [];
  const dangerHits: number[] = [];
  let crit = 0;
  let critHit = 0;
  let benign = 0;
  let benignFA = 0;
  let confusable = 0;
  let confusableFA = 0;
  const groups = new Map<string, number[]>();
  const tags = new Map<string, number[]>();

  for (const p of preds) {
    const g = IDX[p.gold];
    const q = p.pred === null ? null : IDX[p.pred];
    conf[g]![q ?? 4]!++;
    const ok = q === g ? 1 : 0;
    correct.push(ok);
    if (q === null) {
      noAnswer++;
      if (g > 0) under++;
      mae += g;
    } else {
      if (q < g) under++;
      if (q > g) over++;
      mae += Math.abs(q - g);
    }
    if (g >= 2) dangerHits.push(q !== null && q >= 2 ? 1 : 0);
    if (g === 3) {
      crit++;
      if (q === 3) critHit++;
    }
    if (p.kind !== 'scam') {
      benign++;
      const fa = q !== null && q > g ? 1 : 0;
      benignFA += fa;
      if (p.kind === 'benign_confusable') {
        confusable++;
        confusableFA += fa;
      }
    }
    const gk = String(p.group);
    groups.set(gk, [...(groups.get(gk) ?? []), ok]);
    for (const t of p.tags ?? []) tags.set(t, [...(tags.get(t) ?? []), ok]);
  }

  const n = preds.length;
  const agg = (m: Map<string, number[]>) =>
    Object.fromEntries([...m].sort().map(([k, v]) => [k, { n: v.length, accuracy: ratio(v.reduce((a, b) => a + b, 0), v.length) }]));
  return {
    n,
    accuracy: ratio(correct.reduce((a, b) => a + b, 0), n),
    accuracyCI: bootstrapCI(correct),
    // Chỉ lấy trung bình trên các mức có xuất hiện trong nhãn hoặc dự đoán (mức vắng mặt không kéo điểm xuống 0)
    macroF1: (() => {
      const present = LEVELS.map((_, i) => i).filter((i) => conf[i]!.some((v) => v > 0) || conf.some((row) => row[i]! > 0));
      return present.length ? present.reduce((s, i) => s + f1For(i, conf), 0) / present.length : 0;
    })(),
    confusion: conf,
    underRate: ratio(under, n),
    overRate: ratio(over, n),
    dangerMissRate: ratio(dangerHits.filter((x) => !x).length, dangerHits.length),
    dangerRecall: ratio(dangerHits.reduce((a, b) => a + b, 0), dangerHits.length),
    dangerRecallCI: bootstrapCI(dangerHits),
    criticalRecall: ratio(critHit, crit),
    benignFalseAlarm: ratio(benignFA, benign),
    confusableFalseAlarm: ratio(confusableFA, confusable),
    ordinalMAE: ratio(mae, n),
    noAnswerRate: ratio(noAnswer, n),
    byGroup: agg(groups),
    byTag: agg(tags),
  };
}

/** Cohen's kappa (không trọng số) giữa hai dãy nhãn cùng độ dài. */
export function cohenKappa(a: string[], b: string[]): number {
  const n = a.length;
  if (!n) return 0;
  const labels = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = labels.reduce((s, l) => s + (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** Độ ổn định giữa các lần chạy: trung bình kappa của mọi cặp lần chạy. */
export function meanPairwiseKappa(runs: string[][]): number {
  const ks: number[] = [];
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) ks.push(cohenKappa(runs[i]!, runs[j]!));
  return ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : 1;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

export interface PartMetrics {
  n: number;
  accuracy: number | null;
  macroF1: number | null;
  dangerMiss: number;
  dangerMissCount: string;
  criticalRecall: number | null;
  falseAlarm: number | null;
  falseAlarmHigh: number;
  falseAlarmHighCount: string;
  confusion?: number[][];
}

/** Số ghi vào sổ thí nghiệm: bỏ sót là ca từ Cao trở lên bị chấm dưới Cao, báo nhầm tính từ Cao trở lên. */
export function partMetrics(preds: Prediction[]): PartMetrics {
  const rank: Record<RiskLevel, number> = { low: 0, attention: 1, high: 2, critical: 3 };
  const m = computeMetrics(preds);
  const danger = preds.filter((p) => p.gold === 'high' || p.gold === 'critical');
  const missed = danger.filter((p) => !p.pred || rank[p.pred] < 2);
  const benign = preds.filter((p) => p.kind !== 'scam');
  const alarmed = benign.filter((p) => p.pred && rank[p.pred] >= 2);
  return {
    n: m.n,
    accuracy: m.accuracy,
    macroF1: m.macroF1,
    dangerMiss: m.dangerMissRate,
    dangerMissCount: `${missed.length}/${danger.length}`,
    criticalRecall: m.criticalRecall,
    falseAlarm: m.benignFalseAlarm,
    falseAlarmHigh: benign.length ? alarmed.length / benign.length : 0,
    falseAlarmHighCount: `${alarmed.length}/${benign.length}`,
    confusion: m.confusion.map((r) => r.slice(0, 4)),
  };
}
