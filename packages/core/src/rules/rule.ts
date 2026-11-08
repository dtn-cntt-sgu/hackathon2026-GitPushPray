import type { Severity, SignalCategory } from '../types';

/**
 * Một quy tắc so khớp trên văn bản đã chuẩn hóa (chữ thường, không dấu, teencode đã mở rộng).
 * Quy tắc chỉ áp dụng cho tin nhắn của đối phương hoặc người gửi chưa xác định,
 * không áp dụng cho tin của chính người dùng (họ hỏi "có thu phí không?" không phải dấu hiệu).
 *
 * Hai chế độ:
 *  - `patterns`: khớp bất kỳ mẫu nào trong MỘT tin nhắn;
 *  - `groups` (ANY_N): mỗi nhóm là một khía cạnh của kịch bản; luật kích hoạt khi trong một cửa sổ
 *    vài tin gần nhau có ≥ `minGroups` nhóm khớp (kẻ gian thường rải kịch bản qua nhiều tin).
 */
export interface Rule {
  type: string;
  category: SignalCategory;
  severity: Severity;
  title: string;
  explanation: string;
  recommended_action: string;
  patterns?: RegExp[];
  groups?: RegExp[][];
  /** Số nhóm tối thiểu phải khớp (mặc định 2). */
  minGroups?: number;
  /** Ít nhất một trong các nhóm (theo chỉ số) này phải khớp — phần "nguy hiểm" cốt lõi của kịch bản. */
  requireOneOf?: number[];
  /** Nếu ngay trước vị trí khớp có từ phủ định (không, miễn, chẳng...) thì bỏ qua lần khớp đó. */
  negatable?: boolean;
  /** Chế độ `groups`: chỉ xét phủ định ở các nhóm này. Không đặt thì `negatable` áp dụng cho mọi nhóm. */
  negatableGroups?: number[];
  /** Bỏ qua cả tin nhắn nếu khớp một trong các mẫu này (ngữ cảnh hợp lệ). */
  exclude?: RegExp[];
  direct_danger?: boolean;
  /** Mã luật trong tài liệu kịch bản (vd. R04). */
  ref?: string;
}

/** Số tin của đối phương xét chung khi đếm nhóm ở chế độ `groups`. */
export const GROUP_WINDOW = 6;

const NEGATION = /\b(khong|chang|cha|mien|chua|khoi)\s+(\S+\s+){0,2}$/;
/**
 * Phủ định liệt kê: "không cần nạp hay đặt cọc" phủ định cả vế sau. Chỉ trong cùng một vế câu và tối đa một từ
 * sau "hay/hoặc", để "không mất phí hay rủi ro, đặt cọc 500k" hay "không mất phí hay rủi ro đặt cọc 500k" vẫn bị bắt.
 */
const LIST_NEGATION = /\b(khong|chang|mien)\b[^,.;!?]*\s(hay|hoac)\s+(\S+\s+)?$/;

function firstMatch(re: RegExp, normalized: string, negatable: boolean): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of normalized.matchAll(g)) {
    const idx = m.index ?? 0;
    if (negatable) {
      const before = normalized.slice(Math.max(0, idx - 30), idx);
      if (NEGATION.test(before) || LIST_NEGATION.test(normalized.slice(Math.max(0, idx - 60), idx))) continue;
    }
    return idx;
  }
  return -1;
}

export interface RuleMatch {
  rule: Rule;
  index: number;
}

/** Chế độ `patterns`: khớp trong một tin. */
export function matchRule(rule: Rule, normalized: string): RuleMatch | null {
  if (!rule.patterns || rule.exclude?.some((re) => re.test(normalized))) return null;
  for (const re of rule.patterns) {
    const idx = firstMatch(re, normalized, !!rule.negatable);
    if (idx >= 0) return { rule, index: idx };
  }
  return null;
}

/** Chế độ `groups`: trả về chỉ số các nhóm khớp trong một tin. */
export function matchGroups(rule: Rule, normalized: string): number[] {
  if (!rule.groups || rule.exclude?.some((re) => re.test(normalized))) return [];
  const hit: number[] = [];
  rule.groups.forEach((group, gi) => {
    const negatable = !!rule.negatable && (!rule.negatableGroups || rule.negatableGroups.includes(gi));
    if (group.some((re) => firstMatch(re, normalized, negatable) >= 0)) hit.push(gi);
  });
  return hit;
}

/** Tập nhóm đã khớp có đủ điều kiện kích hoạt luật không. */
export function groupsSatisfied(rule: Rule, hit: Set<number>): boolean {
  if (hit.size < (rule.minGroups ?? 2)) return false;
  return !rule.requireOneOf || rule.requireOneOf.some((i) => hit.has(i));
}
