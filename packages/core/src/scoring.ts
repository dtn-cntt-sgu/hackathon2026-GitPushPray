import type { RiskLevel, ScoreBreakdownItem, Severity, Signal } from './types';
import { SEVERITY_LABEL } from './types';

export const SEVERITY_POINTS: Record<Severity, number> = { low: 10, medium: 25, high: 60, critical: 100 };

export interface ScoreResult {
  score: number;
  level: RiskLevel;
  safety_priority: boolean;
  breakdown: ScoreBreakdownItem[];
  /** Giải thích bằng lời vì sao ra mức này. */
  reason: string;
}

/**
 * Điểm dấu hiệu 0–100 (không phải xác suất):
 *  - lấy tín hiệu nặng nhất làm nền, cộng 25% điểm các tín hiệu còn lại (tối đa 99);
 *  - chỉ đạt 100 khi có tín hiệu nghiêm trọng/nguy hiểm trực tiếp, ≥2 loại tín hiệu cô lập,
 *    hoặc rủ đi xa kèm thúc ép thời gian.
 */
export function scoreSignals(signals: Signal[], stageBonus = 0): ScoreResult {
  if (signals.length === 0)
    return { score: 0, level: 'low', safety_priority: false, breakdown: [], reason: 'Chưa có tín hiệu nào trong phần đã đọc.' };

  const isolationTypes = new Set(signals.filter((s) => s.category === 'isolation').map((s) => s.type));
  const dangerSignal = signals.find((s) => s.direct_danger || s.severity === 'critical');
  const relocationUrgent =
    isolationTypes.has('urgent_relocation') && signals.some((s) => s.type === 'urgency_pressure');

  const sorted = [...signals].sort((a, b) => SEVERITY_POINTS[b.severity] - SEVERITY_POINTS[a.severity]);
  const breakdown: ScoreBreakdownItem[] = sorted.map((s, i) => ({
    type: s.type,
    title: s.title,
    severity: s.severity,
    base_points: SEVERITY_POINTS[s.severity],
    weight: i === 0 ? 1 : 0.25,
    contribution: Math.round(SEVERITY_POINTS[s.severity] * (i === 0 ? 1 : 0.25) * 10) / 10,
  }));

  if (dangerSignal || isolationTypes.size >= 2 || relocationUrgent) {
    const reason = dangerSignal
      ? `Có tín hiệu nguy hiểm trực tiếp: "${dangerSignal.title}".`
      : isolationTypes.size >= 2
        ? 'Có từ 2 loại dấu hiệu cô lập/di chuyển khác nhau cùng xuất hiện.'
        : 'Rủ đi xa kèm thúc ép thời gian.';
    return { score: 100, level: 'critical', safety_priority: true, breakdown, reason };
  }

  const raw = breakdown.reduce((a, b) => a + b.contribution, 0) + stageBonus;
  const score = Math.min(99, Math.round(raw));
  const level = levelOf(score);
  const top = sorted[0]!;
  let reason =
    sorted.length === 1
      ? `Một tín hiệu mức ${SEVERITY_LABEL[top.severity]}: "${top.title}".`
      : `Tín hiệu nặng nhất "${top.title}" (${SEVERITY_POINTS[top.severity]} điểm) cộng 25% của ${sorted.length - 1} tín hiệu khác.`;
  if (stageBonus) reason += ` Cộng ${stageBonus} điểm vì kịch bản đi qua nhiều giai đoạn.`;
  return { score, level, safety_priority: false, breakdown, reason };
}

export function levelOf(score: number): RiskLevel {
  if (score >= 100) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 25) return 'attention';
  return 'low';
}
