import { describe, expect, it } from 'vitest';
import { buildAiRequest, decideAiRun, parseAiResponse, sanitizeInsight, URGENT_MIN_INTERVAL_MS } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import type { ChatMessage, Signal } from '@safechat/core/types';

const chat = (rows: [ChatMessage['sender'], string][]): ChatMessage[] =>
  rows.map(([sender, text], i) => ({ id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender, text }));

const m = chat([
  ['other', 'Bạn chọn mẫu rồi đăng ký ở link bit.ly/dangky-mau nhé'],
  ['self', 'Sao phải đăng nhập Facebook vậy chị?'],
  ['other', 'Em yên tâm, đây là quy trình nội bộ, em cứ đăng nhập rồi gửi chị mã xác nhận'],
  ['self', 'Vậy để em làm thử xem sao'],
]);

describe('đọc nhận định của AI', () => {
  it('trạng thái nạn nhân chỉ được tin khi trích dẫn khớp tin của người dùng', () => {
    const ok = sanitizeInsight({ victim_state: 'about_to_comply', victim_message_id: 'msg-004', victim_quote: 'để em làm thử' }, m)!;
    expect(ok.victim_evidence_ok).toBe(true);
    const wrongQuote = sanitizeInsight({ victim_state: 'about_to_comply', victim_message_id: 'msg-004', victim_quote: 'em chuyển rồi' }, m)!;
    expect(wrongQuote.victim_evidence_ok).toBe(false);
    const otherMsg = sanitizeInsight({ victim_state: 'complied', victim_message_id: 'msg-003', victim_quote: 'em cứ đăng nhập' }, m)!;
    expect(otherMsg.victim_evidence_ok).toBe(false);
  });
  it('bỏ lời cảnh báo khuyên làm việc nguy hiểm, giữ lời khuyên dừng lại', () => {
    expect(sanitizeInsight({ warning: 'Bạn cứ đăng nhập để nhận mã là an toàn' }, m)?.warning).toBeUndefined();
    expect(sanitizeInsight({ warning: 'Đừng gửi mã cho ai, chị ấy đã né câu hỏi của bạn' }, m)?.warning).toContain('Đừng gửi mã');
  });
  it('bỏ câu có link, số dài; che dữ liệu cá nhân', () => {
    expect(sanitizeInsight({ warning: 'Vào https://evil.top để kiểm tra' }, m)?.warning).toBeUndefined();
    expect(sanitizeInsight({ happening: 'Gọi số 0912345678 để xác minh' }, m)?.happening ?? '').not.toContain('0912345678');
  });
  it('chiêu lạ bị bỏ, chiêu hợp lệ được giữ', () => {
    expect(sanitizeInsight({ tactics: ['evasion', 'reassurance', 'hack he thong'] }, m)?.tactics).toEqual(['evasion', 'reassurance']);
  });
  it('đọc từ phản hồi model; thiếu insight vẫn chạy bình thường', () => {
    const req = buildAiRequest(m, 0, '', []);
    const parsed = parseAiResponse(JSON.stringify({ signals: [], summary: 'x', insight: { happening: 'Đối phương dẫn đăng nhập để lấy mã', tactics: ['evasion'], victim_state: 'about_to_comply', victim_message_id: 'msg-004', victim_quote: 'để em làm thử', warning: 'Bạn đã hỏi nhưng chưa được trả lời rõ' } }), req, m, 't');
    expect(parsed.insight?.victim_evidence_ok).toBe(true);
    expect(parseAiResponse(JSON.stringify({ signals: [], summary: 'x' }), req, m, 't').insight).toBeUndefined();
  });
});

describe('kết hợp AI với luật', () => {
  it('AI thấy nạn nhân sắp làm theo, luật đã có tín hiệu → Nghiêm trọng, bằng chứng là tin của đối phương', () => {
    const insight = sanitizeInsight({ victim_state: 'about_to_comply', victim_message_id: 'msg-004', victim_quote: 'để em làm thử', happening: 'Dẫn đăng nhập để lấy mã' }, m)!;
    const before = analyze(m);
    expect(before.risk_level).not.toBe('critical');
    const r = analyze(m, { aiInsight: insight });
    expect(r.risk_level).toBe('critical');
    const s = r.signals.find((x) => x.type === 'ai_victim_compliance')!;
    expect(s.evidence_message_ids.every((id) => m.find((x) => x.id === id)!.sender !== 'self')).toBe(true);
  });
  it('AI một mình, không có tín hiệu luật → không lên Nghiêm trọng', () => {
    const plain = chat([['other', 'Tối nay đi ăn không'], ['self', 'Để em đi luôn']]);
    const insight = sanitizeInsight({ victim_state: 'about_to_comply', victim_message_id: 'msg-002', victim_quote: 'để em đi luôn' }, plain)!;
    expect(analyze(plain, { aiInsight: insight }).risk_level).toBe('low');
  });
  it('trích dẫn không khớp → không dùng để nâng mức', () => {
    const insight = sanitizeInsight({ victim_state: 'complied', victim_message_id: 'msg-004', victim_quote: 'em gửi mã rồi' }, m)!;
    expect(analyze(m, { aiInsight: insight }).risk_level).toBe(analyze(m).risk_level);
  });
  it('tín hiệu AI trùng loại với luật: không tính điểm hai lần nhưng giữ phần giải thích', () => {
    const scam = chat([['other', 'Em đóng phí kích hoạt 500k nhé']]);
    const ai: Signal = { type: 'ai_fee_upfront', category: 'finance', severity: 'high', title: 'Đòi phí', explanation: 'Đòi phí trước khi nhận việc, kiểu thường gặp ở tin tuyển dụng giả (AI: t)', evidence_message_ids: ['msg-001'], evidence_quotes: ['đóng phí kích hoạt'], recommended_action: 'x', source: 'ai' };
    const plain = analyze(scam);
    const r = analyze(scam, { aiSignals: [ai] });
    expect(r.score).toBe(plain.score);
    expect(r.signals.find((s) => s.type === 'upfront_fee')?.ai_note).toContain('tuyển dụng giả');
    expect(r.signals.some((s) => s.type === 'ai_fee_upfront')).toBe(false);
  });
  it('lời cảnh báo và bước tiếp theo của AI đi vào gợi ý', () => {
    const insight = sanitizeInsight({ warning: 'Chị ấy né câu hỏi của bạn 2 lần', likely_next: 'Sẽ xin ảnh chụp mã' }, m)!;
    const a = analyze(m, { aiInsight: insight }).advice;
    expect(a.ai_warning).toContain('né câu hỏi');
    expect(a.likely_next).toContain('ảnh chụp mã');
  });
});

describe('gọi AI ngay lúc quan trọng', () => {
  const base = { now: 100_000, messages: m, lastAiSeq: 3, lastAiAt: 0, currentLevel: 'high' as const, budgetLeft: 5, minIntervalMs: 30_000, batchSize: 5, lastMessageAt: 100_000, idleFlushMs: 20_000 };
  it('không chờ đủ lô khi có cờ gấp', () => {
    expect(decideAiRun(base).run).toBe(false);
    const d = decideAiRun({ ...base, urgent: true });
    expect(d.run && d.tier).toBe('large');
  });
  it('vẫn giữ khoảng cách tối thiểu giữa hai lượt gấp', () => {
    const d = decideAiRun({ ...base, urgent: true, lastAiAt: base.now - URGENT_MIN_INTERVAL_MS + 1000 });
    expect(d.run).toBe(false);
  });
});
