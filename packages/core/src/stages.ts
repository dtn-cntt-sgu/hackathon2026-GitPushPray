// Giai đoạn kịch bản S0–S4 (tonghopkichban.md, Phần 3). Suy ra MỘT CHIỀU từ tín hiệu đã phát hiện
// (không dùng giai đoạn để kích hoạt luật → không vòng lặp). Dùng để hiển thị tiến trình và cộng
// điểm có trần khi kịch bản đi qua nhiều giai đoạn — không nhân hệ số như công thức gốc.
import type { ChatMessage, ScamStage, Signal } from './types';

const STAGE_OF: Record<string, ScamStage> = {
  unrealistic_pay: 'S1',
  task_recruitment: 'S1',
  channel_migration: 'S2',
  suspicious_link: 'S2',
  apk_install_request: 'S2',
  account_takeover_code: 'S3',
  withdrawal_fee: 'S4',
  bait_then_demand: 'S4',
  qr_install: 'S2',
  qr_payment_context: 'S3',
  qr_invalid_crc: 'S3',
  claim_link_mismatch: 'S3',
  link_with_pressure: 'S3',
  loan_offer_app: 'S2',
  refund_link_info: 'S3',
  bank_alert_callback: 'S3',
  card_cash_service: 'S3',
  parcel_fee_scam: 'S3',
  debt_collection_threat: 'S4',
  malware_apk: 'S2',
  upfront_fee: 'S3',
  money_transfer: 'S3',
  task_deposit: 'S3',
  money_request_phrase: 'S3',
  money_request_context: 'S3',
  repeated_money_request: 'S3',
  money_request_threat: 'S4',
  otp_password_request: 'S3',
  otp_institution_pressure: 'S3',
  bank_credentials: 'S3',
  id_document_request: 'S3',
  intimate_image_request: 'S3',
  investment_scam: 'S3',
  loan_app_trap: 'S3',
  romance_customs_gift: 'S3',
  recovery_scam: 'S3',
  authority_impersonation: 'S3',
  account_takeover_borrow: 'S3',
  phishing_vote_qr: 'S3',
  crypto_wallet: 'S3',
  possible_contradiction: 'S3',
  task_freeze_extortion: 'S4',
  task_escalating_deposit: 'S4',
  hold_deposit_deadline: 'S3',
  threat_coercion: 'S4',
  original_documents: 'S4',
  communication_control: 'S4',
};

const ORDER: ScamStage[] = ['S0', 'S1', 'S2', 'S3', 'S4'];
const seqOf = (id: string) => Number(id.replace(/\D/g, '')) || 0;

export interface StageResult {
  stage: ScamStage;
  stages_reached: { stage: ScamStage; first_message_id: string }[];
  /** Điểm cộng thêm (0–15) khi đi qua ≥ 2 giai đoạn S1–S4. */
  bonus: number;
}

export function deriveStages(signals: Signal[], messages: ChatMessage[]): StageResult {
  const first = new Map<ScamStage, number>();
  for (const s of signals) {
    if (s.mitigation || s.source === 'ai') continue;
    const st = STAGE_OF[s.type];
    if (!st) continue;
    const seq = Math.min(...s.evidence_message_ids.map(seqOf));
    if (!first.has(st) || seq < first.get(st)!) first.set(st, seq);
  }
  const byId = new Map(messages.map((m) => [m.seq, m.id]));
  const stages_reached = ORDER.filter((st) => first.has(st)).map((st) => ({
    stage: st,
    first_message_id: byId.get(first.get(st)!) ?? `msg-${String(first.get(st)).padStart(3, '0')}`,
  }));
  const stage = stages_reached.at(-1)?.stage ?? 'S0';
  const n = stages_reached.length;
  return { stage, stages_reached, bonus: n >= 2 ? Math.min(15, 5 * (n - 1)) : 0 };
}
