// Chống dao động mức cảnh báo (lớp hiển thị đặt SAU analyze):
//  - TĂNG NGAY khi bằng chứng mạnh: chỉ riêng tín hiệu của luật/sổ đối chiếu (không tính AI) đã đủ đạt mức mới
//    — gồm tín hiệu nguy hiểm trực tiếp, yêu cầu rủi ro cụ thể, hoặc nhiều tín hiệu cộng dồn;
//  - TĂNG CÓ ĐIỀU KIỆN khi phần vượt lên chỉ dựa vào AI: tăng ngay tới mức luật hỗ trợ, phần còn lại
//    "chờ xác nhận" — cần thêm 1 lần đánh giá mới (tin mới / lượt AI mới) vẫn cho mức đó;
//  - HẠ CHẬM: chỉ hạ khi K lần đánh giá liên tiếp đều cho mức thấp hơn; không bao giờ tự hạ từ Nghiêm trọng;
//  - ghi mức cao nhất trong phiên.
// Một "lần đánh giá" chỉ được tính khi có bằng chứng mới (tin mới hoặc lượt AI mới), để việc tính lại do
// đổi cài đặt/trạng thái không làm thay đổi mức.
import { buildAdvice } from './advice';
import { scoreSignals } from './scoring';
import type { AnalysisResult, RiskLevel } from './types';
import { RISK_LEVEL_LABEL, RISK_LEVEL_ORDER } from './types';

export const DOWNGRADE_CONFIRMATIONS = 2;
/** AI nâng mức sau 1 lần đánh giá có bằng chứng (Duy duyệt 2026-11-08); trước đây là 2. */
export const AI_UPGRADE_CONFIRMATIONS = 1;

export interface StabilityState {
  displayed: RiskLevel;
  maxLevel: RiskLevel;
  /** Khóa lần đánh giá gần nhất (seq tin cuối + số lượt AI) — tránh đếm lặp. */
  lastEvalKey: string;
  /** Mức thô (sau analyze) của các lần đánh giá gần nhất, mới nhất ở cuối. */
  recentRaw: RiskLevel[];
  /** Mức đang chờ xác nhận do phần vượt lên chỉ dựa vào AI. */
  pendingUp?: { level: RiskLevel; confirmations: number };
}

export interface StabilityOutcome {
  state: StabilityState;
  /** Kết quả đã áp mức hiển thị (risk_level, score, advice, level_reason được điều chỉnh). */
  result: AnalysisResult;
  /** Ghi chú cho dòng diễn biến khi mức hiển thị khác mức thô. */
  note?: string;
}

const O = RISK_LEVEL_ORDER;
const max = (a: RiskLevel, b: RiskLevel) => (O[a] >= O[b] ? a : b);
const min = (a: RiskLevel, b: RiskLevel) => (O[a] <= O[b] ? a : b);
const BAND: Record<RiskLevel, [number, number]> = { low: [0, 24], attention: [25, 59], high: [60, 99], critical: [100, 100] };

export function initialStability(): StabilityState {
  return { displayed: 'low', maxLevel: 'low', lastEvalKey: '', recentRaw: [] };
}

/** Mức chỉ dựa vào tín hiệu của luật/sổ đối chiếu (bỏ tín hiệu AI). */
export function ruleOnlyLevel(result: AnalysisResult): RiskLevel {
  return scoreSignals(result.signals.filter((s) => s.source !== 'ai')).level;
}

export function stabilize(prev: StabilityState | undefined, raw: AnalysisResult, evalKey: string): StabilityOutcome {
  const p = prev ?? initialStability();
  const isNewEval = evalKey !== p.lastEvalKey;
  const rawLevel = raw.risk_level;
  const recentRaw = isNewEval ? [...p.recentRaw, rawLevel].slice(-Math.max(DOWNGRADE_CONFIRMATIONS, AI_UPGRADE_CONFIRMATIONS)) : p.recentRaw;

  let displayed = p.displayed;
  let pendingUp = p.pendingUp;
  let note: string | undefined;

  if (O[rawLevel] > O[displayed]) {
    const supported = min(rawLevel, ruleOnlyLevel(raw));
    if (O[supported] >= O[rawLevel]) {
      // Bằng chứng mạnh từ luật → tăng ngay
      displayed = rawLevel;
      pendingUp = undefined;
    } else {
      // Phần vượt lên chỉ dựa vào AI → tăng tới mức luật hỗ trợ, phần còn lại chờ xác nhận
      displayed = max(displayed, supported);
      const samePending = pendingUp !== undefined && O[pendingUp.level] <= O[rawLevel];
      const confirmations = samePending ? pendingUp!.confirmations + (isNewEval ? 1 : 0) : 1;
      if (confirmations >= AI_UPGRADE_CONFIRMATIONS) {
        displayed = rawLevel;
        pendingUp = undefined;
      } else {
        pendingUp = { level: rawLevel, confirmations };
        note = `Chờ xác nhận: AI gợi ý mức ${RISK_LEVEL_LABEL[rawLevel]}, cần thêm 1 lần đánh giá`;
      }
    }
  } else {
    pendingUp = undefined;
    if (O[rawLevel] < O[displayed]) {
      const lastK = recentRaw.slice(-DOWNGRADE_CONFIRMATIONS);
      const sustained = lastK.length >= DOWNGRADE_CONFIRMATIONS && lastK.every((l) => O[l] < O[displayed]);
      if (displayed === 'critical') {
        note = 'Giữ mức Nghiêm trọng: không tự hạ khi đã có dấu hiệu nguy hiểm';
      } else if (sustained) {
        // Hạ về mức cao nhất trong K lần gần nhất (thận trọng)
        displayed = lastK.reduce(max);
      } else {
        const left = DOWNGRADE_CONFIRMATIONS - lastK.filter((l) => O[l] < O[displayed]).length;
        note = `Giữ mức ${RISK_LEVEL_LABEL[displayed]}: cần thêm ${left} lần đánh giá có mức thấp hơn trước khi hạ`;
      }
    }
  }

  const state: StabilityState = {
    displayed,
    maxLevel: max(p.maxLevel, displayed),
    lastEvalKey: evalKey,
    recentRaw,
    pendingUp,
  };

  if (displayed === rawLevel) return { state, result: { ...raw, raw_level: rawLevel, stability_note: note }, note };
  const [lo, hi] = BAND[displayed];
  const safety = displayed === 'critical';
  return {
    state,
    note,
    result: {
      ...raw,
      raw_level: rawLevel,
      stability_note: note,
      risk_level: displayed,
      score: Math.min(hi, Math.max(lo, raw.score)),
      safety_priority: safety || raw.safety_priority,
      // Chỉ dựng lại phần theo mức. Câu hỏi đã theo diễn biến hội thoại nên giữ nguyên từ kết quả gốc.
    advice: (() => {
      const safe = safety || raw.safety_priority;
      const { actions, safety_message, support_resources } = buildAdvice(displayed, raw.signals, safe);
      const { questions, waiting_answer, focus_title, question_reason, answer_assessment, ai_warning, likely_next } = raw.advice;
      return {
        actions,
        questions: safe ? [] : questions,
        ...(safety_message ? { safety_message } : {}),
        ...(support_resources ? { support_resources } : {}),
        ...(!safe && waiting_answer ? { waiting_answer } : {}),
        ...(focus_title ? { focus_title } : {}),
        ...(!safe && question_reason ? { question_reason } : {}),
        ...(answer_assessment ? { answer_assessment } : {}),
        ...(ai_warning ? { ai_warning } : {}),
        ...(likely_next ? { likely_next } : {}),
      };
    })(),
      level_reason: `${raw.level_reason} ${note ?? ''}`.trim(),
    },
  };
}
