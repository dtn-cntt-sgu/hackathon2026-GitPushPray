import { stripDiacritics } from './normalize';
import type { ChatMessage, Signal } from './types';

const loose = (s: string) => stripDiacritics(s.toLowerCase()).replace(/\s+/g, ' ').replace(/…$/, '').trim();

/**
 * Kiểm tra bằng chứng của tín hiệu (đặc biệt là từ AI): mọi evidence_message_id phải tồn tại
 * trong bản nháp và mọi trích dẫn phải xuất hiện nguyên văn (bỏ qua hoa/thường, dấu, khoảng trắng)
 * trong tin nhắn tương ứng. Tín hiệu không đạt bị loại để tránh "bằng chứng bịa".
 * Bằng chứng không được trỏ vào tin của chính người dùng: dấu hiệu là hành vi của đối phương,
 * tin của người dùng chỉ là ngữ cảnh.
 */
export function validateEvidence(
  signals: Signal[],
  messages: ChatMessage[],
): { valid: Signal[]; rejected: { signal: Signal; reason: string }[] } {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const valid: Signal[] = [];
  const rejected: { signal: Signal; reason: string }[] = [];

  for (const s of signals) {
    if (s.evidence_message_ids.length === 0) {
      rejected.push({ signal: s, reason: 'Không có tin nhắn bằng chứng' });
      continue;
    }
    const missing = s.evidence_message_ids.find((id) => !byId.has(id));
    if (missing) {
      rejected.push({ signal: s, reason: `Không tìm thấy tin nhắn ${missing}` });
      continue;
    }
    const own = s.evidence_message_ids.find((id) => byId.get(id)!.sender === 'self');
    if (own) {
      rejected.push({ signal: s, reason: `Bằng chứng trỏ vào tin của chính người dùng (${own})` });
      continue;
    }
    const badQuote = s.evidence_quotes.findIndex((q, i) => {
      if (!q) return false;
      const msg = byId.get(s.evidence_message_ids[i] ?? s.evidence_message_ids[0]!);
      return !msg || !loose(msg.text).includes(loose(q));
    });
    if (badQuote >= 0) {
      rejected.push({ signal: s, reason: 'Trích dẫn không khớp tin nhắn gốc' });
      continue;
    }
    valid.push(s);
  }
  return { valid, rejected };
}
