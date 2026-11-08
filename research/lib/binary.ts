// Chỉ số 2 lớp cho bộ dữ liệu ngoài: "có cảnh báo" (mức ≥ ngưỡng) so với nhãn lừa đảo/bình thường.
import type { RiskLevel } from '@safechat/core/types';
import { RISK_LEVEL_ORDER } from '@safechat/core/types';
import { bootstrapCI } from './metrics';

export type Threshold = 'attention' | 'high';

export interface BinaryMetrics {
  n: number;
  pos: number;
  neg: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** Bắt được: tỷ lệ ca lừa đảo có cảnh báo. */
  recall: number;
  /** Báo nhầm: tỷ lệ ca bình thường có cảnh báo. */
  fpr: number;
  precision: number;
  f1: number;
  recallCI: [number, number];
  fprCI: [number, number];
}

export const flagged = (pred: RiskLevel | null, t: Threshold) => !!pred && RISK_LEVEL_ORDER[pred] >= RISK_LEVEL_ORDER[t];

export function binaryMetrics(rows: { kind: string; pred: RiskLevel | null }[], t: Threshold): BinaryMetrics {
  const posFlags = rows.filter((r) => r.kind === 'scam').map((r) => (flagged(r.pred, t) ? 1 : 0));
  const negFlags = rows.filter((r) => r.kind !== 'scam').map((r) => (flagged(r.pred, t) ? 1 : 0));
  const tp = posFlags.reduce<number>((a, b) => a + b, 0);
  const fp = negFlags.reduce<number>((a, b) => a + b, 0);
  const fn = posFlags.length - tp;
  const tn = negFlags.length - fp;
  const recall = posFlags.length ? tp / posFlags.length : 0;
  const fpr = negFlags.length ? fp / negFlags.length : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  return {
    n: rows.length,
    pos: posFlags.length,
    neg: negFlags.length,
    tp,
    fp,
    fn,
    tn,
    recall,
    fpr,
    precision,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    recallCI: bootstrapCI(posFlags),
    fprCI: bootstrapCI(negFlags),
  };
}
