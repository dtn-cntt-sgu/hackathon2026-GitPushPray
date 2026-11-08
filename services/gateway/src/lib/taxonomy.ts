import type { RiskLevel, Severity, Signal, SignalCategory } from '@safechat/core/types';
import { RISK_LEVEL_ORDER } from '@safechat/core/types';
import {
  canonicalSignalType,
  isDangerousSignalType,
  type CanonicalType,
} from '@safechat/core/taxonomy';

export { CANONICAL_TYPES, type CanonicalType } from '@safechat/core/taxonomy';

export const canonicalType = canonicalSignalType;
export const isDangerousType = isDangerousSignalType;

const SEVERITY_ORDER: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Loại thật sự thuộc nhóm cô lập/di chuyển; các loại khác không được gắn category "isolation". */
const ISOLATION_TYPES = new Set<CanonicalType>([
  'isolation_control',
  'secrecy_demand',
  'location_control',
  'overseas_transport',
  'forced_labor',
  'trafficking_recruitment',
  'organ_trade',
]);

/** Category hiển thị/điểm cho từng loại chuẩn khi AI gắn nhầm "isolation". */
const CATEGORY_BY_TYPE: Partial<Record<CanonicalType, SignalCategory>> = {
  job_bait: 'job_terms',
  fee_upfront: 'finance',
  debt_bondage: 'finance',
  withdrawal_fee: 'finance',
  account_freeze_threat: 'finance',
  mule_account: 'finance',
  loan_shark: 'finance',
  sunk_cost: 'finance',
  investment_bait: 'investment',
  threat_direct: 'pressure',
  threat_indirect: 'pressure',
  romance_bait: 'pressure',
  love_bombing: 'pressure',
  sextortion: 'pressure',
  intimate_image_threat: 'pressure',
  minor_grooming: 'pressure',
  urgency_pressure: 'pressure',
  gaslighting: 'pressure',
  contradiction: 'contradiction',
  account_control: 'account',
  otp_request: 'account',
  authority_impersonation: 'impersonation',
  bank_impersonation: 'impersonation',
  remote_access_request: 'technical',
  suspicious_link: 'technical',
  meta_warning: 'contradiction',
};

function signalCategory(type: CanonicalType, category: SignalCategory): SignalCategory {
  if (category !== 'isolation' || ISOLATION_TYPES.has(type)) return category;
  // Chặn AI tự đạt mức Nghiêm trọng bằng hai tín hiệu bất kỳ cùng gắn nhãn "isolation".
  return CATEGORY_BY_TYPE[type] ?? 'pressure';
}

/**
 * Chuẩn hoá type/category, khử trùng theo (type, evidence ids), sắp severity giảm dần, cắt tối đa N.
 */
export function normalizeSignals(signals: Signal[], maxSignals: number): Signal[] {
  const deduped = new Map<string, Signal>();
  for (const s of signals) {
    const type = canonicalType(s.type);
    const ids = [...new Set(s.evidence_message_ids)].sort();
    const key = `${type}|${ids.join(',')}`;
    const normalized: Signal = {
      ...s,
      type,
      category: signalCategory(type, s.category),
      confidence:
        typeof s.confidence === 'number' && Number.isFinite(s.confidence)
          ? Math.max(0, Math.min(1, s.confidence))
          : undefined,
    };
    const prev = deduped.get(key);
    if (!prev || SEVERITY_ORDER[normalized.severity] > SEVERITY_ORDER[prev.severity]) deduped.set(key, normalized);
  }
  return [...deduped.values()]
    .sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (bySeverity) return bySeverity;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    })
    .slice(0, maxSignals);
}

/**
 * Bỏ tín hiệu AI trùng ý nghĩa với tín hiệu bộ luật (kể cả khác tên, ví dụ money_transfer ≈ fee_upfront).
 * Bộ luật đã đóng góp điểm cho dấu hiệu đó; giữ lại sẽ tính hai lần và đẩy mức lên sai.
 */
export function dropRuleDuplicates(signals: Signal[], ruleTypes: string[]): { signals: Signal[]; dropped: number } {
  const ruleCanonical = new Set(ruleTypes.map((t) => canonicalType(t)));
  if (ruleCanonical.size === 0) return { signals, dropped: 0 };
  const kept = signals.filter((s) => !ruleCanonical.has(canonicalType(s.type)));
  return { signals: kept, dropped: signals.length - kept.length };
}

/** Mức tối đa AI được gán cho tín hiệu không nguy hiểm khi bộ luật còn thấp. */
const CALIBRATION_CAP: Partial<Record<RiskLevel, Severity>> = { low: 'low', attention: 'medium' };

/**
 * Hạ severity của tín hiệu không nguy hiểm theo mức hiện tại của bộ luật.
 * Khi luật chưa thấy rủi ro, một tín hiệu "medium" của AI không đủ để đẩy cảnh báo lên;
 * tín hiệu nguy hiểm (OTP, đe dọa, giấy tờ, mạo danh...) được giữ nguyên.
 */
export function calibrateSignals(
  signals: Signal[],
  currentLevel: RiskLevel,
): { signals: Signal[]; calibrated: number } {
  const cap = CALIBRATION_CAP[currentLevel];
  if (!cap) return { signals, calibrated: 0 };
  let calibrated = 0;
  const out = signals.map((s) => {
    if (isDangerousType(s.type) || SEVERITY_ORDER[s.severity] <= SEVERITY_ORDER[cap]) return s;
    calibrated += 1;
    return { ...s, severity: cap };
  });
  return { signals: out, calibrated };
}

function deaccent(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const OTP_HINT = /(ma otp|ma pin|\botp\b|\bpin\b)/;
const OTP_WARNING = /khong\s+(?:duoc\s+|tuyet doi\s+)?(?:cung cap|chia se|tiet lo|doc|gui|nhap|bam|click|tai)/;
const OTP_DEMAND_VERB = /\b(doc|cung cap|chia se|gui|nhap|bam|click|tai)\b/;

/** Tin nhắn chỉ thông báo mã OTP kèm lời dặn không chia sẻ, không hề yêu cầu người dùng đọc/gửi mã. */
function isOtpSafetyNotice(s: Signal): boolean {
  if (canonicalType(s.type) !== 'otp_request') return false;
  const text = deaccent(s.evidence_quotes.join(' '));
  if (!OTP_HINT.test(text) || !OTP_WARNING.test(text)) return false;
  const withoutWarnings = text.replace(/khong\s+(?:duoc\s+|tuyet doi\s+)?(?:cung cap|chia se|tiet lo|doc|gui|nhap|bam|click|tai)[^.;!?]*/g, ' ');
  return !OTP_DEMAND_VERB.test(withoutWarnings);
}

/**
 * Bỏ tín hiệu OTP chỉ là thông báo an toàn khi bộ luật chưa ở mức cao.
 * Không đụng tới trường hợp AI thấy lời yêu cầu đọc/gửi mã.
 */
export function dropBenignWarnings(
  signals: Signal[],
  currentLevel: RiskLevel,
): { signals: Signal[]; dropped: number } {
  if (RISK_LEVEL_ORDER[currentLevel] >= RISK_LEVEL_ORDER.high) return { signals, dropped: 0 };
  const kept = signals.filter((s) => !isOtpSafetyNotice(s));
  return { signals: kept, dropped: signals.length - kept.length };
}
