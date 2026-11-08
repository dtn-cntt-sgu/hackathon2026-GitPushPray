import { describe, expect, it } from 'vitest';
import { analyze } from '@safechat/core/analyzer';
import { validateEvidence } from '@safechat/core/evidence';
import { normalizeForMatch } from '@safechat/core/normalize';
import { appendObserved, emptyTranscript, mergeOlder } from '@safechat/core/transcript';
import type { ChatMessage, Signal } from '@safechat/core/types';

describe('normalizeForMatch: chữ bị che', () => {
  it('gỡ gạch dưới và đổi j thành i, giữ từ bắt đầu bằng j', () => {
    expect(normalizeForMatch('tj_e_n')).toBe('tien');
    expect(normalizeForMatch('ch0j t0j')).toBe('choi toi');
    expect(normalizeForMatch('job')).toBe('job');
  });
});

describe('mergeOlder: gộp khi cuộn lên', () => {
  const m = (t: string, domId?: string) => ({ sender: 'other' as const, text: t, domId });
  it('thêm tin cũ vào đầu, không trùng', () => {
    expect(mergeOlder([m('c', 'c'), m('d', 'd')], [m('a', 'a'), m('b', 'b'), m('c', 'c'), m('d', 'd')]).map((x) => x.text)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('lần đọc mới đã mất tin mới nhất: vẫn giữ', () => {
    expect(mergeOlder([m('c', 'c'), m('d', 'd')], [m('a', 'a'), m('b', 'b'), m('c', 'c')]).map((x) => x.text)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('không có gì mới thì giữ nguyên', () => {
    const acc = [m('c', 'c'), m('d', 'd')];
    expect(mergeOlder(acc, [m('c', 'c'), m('d', 'd')])).toBe(acc);
  });
  it('không có domId: so theo nội dung', () => {
    expect(mergeOlder([m('c'), m('d')], [m('b'), m('c')]).map((x) => x.text)).toEqual(['b', 'c', 'd']);
  });
  it('lần đọc không chạm tin đang có: coi là cũ hơn', () => {
    expect(mergeOlder([m('c', 'c')], [m('a', 'a'), m('b', 'b')]).map((x) => x.text)).toEqual(['a', 'b', 'c']);
  });
});

describe('normalizeForMatch', () => {
  it('bỏ dấu, mở rộng teencode, tách đơn vị tiền', () => {
    expect(normalizeForMatch('E ck trc 500k nhé')).toBe('e chuyen khoan truoc 500 nghin nhe');
    expect(normalizeForMatch('Lương 1.5tr/ngày')).toBe('luong 1.5 trieu / ngay');
    expect(normalizeForMatch('Đừng nói với bố mẹ.')).toBe('dung noi voi bo me .');
  });
  it('"cấm" không bị hiểu nhầm thành viết tắt', () => {
    expect(normalizeForMatch('cấm liên lạc')).toBe('cam lien lac');
  });
});

describe('phủ định', () => {
  const msg = (text: string): ChatMessage[] => [{ id: 'msg-001', seq: 1, sender: 'other', text }];
  it('"không cần đặt cọc" không bị gắn cờ phí', () => {
    expect(analyze(msg('Bên chị không cần đặt cọc gì đâu em')).signals.map((s) => s.type)).not.toContain('upfront_fee');
  });
  it('"đặt cọc 2 triệu" bị gắn cờ', () => {
    expect(analyze(msg('Em đặt cọc 2 triệu để giữ chỗ nhé')).signals.map((s) => s.type)).toContain('upfront_fee');
  });
  it('tin của người gửi chưa xác định vẫn được phân tích', () => {
    const r = analyze([{ id: 'msg-001', seq: 1, sender: 'unknown', text: 'Gửi chị mã OTP nhé' }]);
    expect(r.signals.map((s) => s.type)).toContain('otp_password_request');
  });
});

describe('transcript — khử trùng lặp khi DOM render lại', () => {
  it('cùng lô tin quan sát 2 lần chỉ thêm 1 lần', () => {
    const st = emptyTranscript();
    const batch = [
      { sender: 'other' as const, text: 'Chào em' },
      { sender: 'self' as const, text: 'Dạ' },
      { sender: 'other' as const, text: 'Chào em' },
    ];
    expect(appendObserved(st, batch)).toHaveLength(3);
    expect(appendObserved(st, batch)).toHaveLength(0);
    // Lô mới có thêm 1 tin ở cuối
    expect(appendObserved(st, [...batch, { sender: 'other', text: 'Em đóng phí nhé' }])).toHaveLength(1);
    expect(st.messages.map((m) => m.id)).toEqual(['msg-001', 'msg-002', 'msg-003', 'msg-004']);
  });
  it('cửa sổ DOM trượt (tin cũ bị gỡ, tin mới xuất hiện) chỉ thêm tin mới', () => {
    const st = emptyTranscript();
    const m = (text: string) => ({ sender: 'other' as const, text });
    appendObserved(st, [m('A'), m('B'), m('C')]);
    expect(appendObserved(st, [m('B'), m('C'), m('D')]).map((x) => x.text)).toEqual(['D']);
    // Cuộn lên xem lịch sử: lô toàn tin đã biết → không thêm gì
    expect(appendObserved(st, [m('A'), m('B')])).toHaveLength(0);
    // Tin lặp nội dung hợp lệ ở cuối ("ok" gửi 2 lần) vẫn được ghi nhận
    appendObserved(st, [m('C'), m('D'), m('ok')]);
    expect(appendObserved(st, [m('D'), m('ok'), m('ok')]).map((x) => x.text)).toEqual(['ok']);
  });
  it('ưu tiên domId khi có', () => {
    const st = emptyTranscript();
    appendObserved(st, [{ sender: 'other', text: 'A', domId: 'x1' }]);
    expect(appendObserved(st, [{ sender: 'other', text: 'A (đã sửa)', domId: 'x1' }])).toHaveLength(0);
  });
  it('giữ tối đa N tin gần nhất', () => {
    const st = emptyTranscript();
    appendObserved(
      st,
      Array.from({ length: 10 }, (_, i) => ({ sender: 'other' as const, text: `tin ${i}` })),
      5,
    );
    expect(st.messages).toHaveLength(5);
    expect(st.messages[0]!.text).toBe('tin 5');
  });
});

describe('transcript — mã tin từ DOM (Messenger)', () => {
  const d = (id: string, text = id) => ({ sender: 'other' as const, text, domId: id });
  it('hai tin trùng nội dung nhưng khác mã vẫn được giữ', () => {
    const st = emptyTranscript();
    expect(appendObserved(st, [d('a', 'ok'), d('b', 'ok')])).toHaveLength(2);
    expect(appendObserved(st, [d('a', 'ok'), d('b', 'ok')])).toHaveLength(0);
  });
  it('tin cũ hiện ra khi cuộn lên không bị nối vào cuối bản nháp', () => {
    const st = emptyTranscript();
    appendObserved(st, [d('m5'), d('m6')]);
    expect(appendObserved(st, [d('m3'), d('m4'), d('m5'), d('m6'), d('m7')]).map((m) => m.text)).toEqual(['m7']);
    expect(st.messages.map((m) => m.text)).toEqual(['m5', 'm6', 'm7']);
  });
});

describe('validateEvidence', () => {
  const messages: ChatMessage[] = [{ id: 'msg-001', seq: 1, sender: 'other', text: 'Em đóng phí kích hoạt 500k nhé' }];
  const base: Signal = {
    type: 'x',
    category: 'finance',
    severity: 'high',
    title: '',
    explanation: '',
    evidence_message_ids: ['msg-001'],
    evidence_quotes: ['phí kích hoạt 500k'],
    recommended_action: '',
    source: 'ai',
  };
  it('chấp nhận trích dẫn khớp', () => {
    expect(validateEvidence([base], messages).valid).toHaveLength(1);
  });
  it('loại trích dẫn bịa hoặc id không tồn tại', () => {
    const r = validateEvidence(
      [
        { ...base, evidence_quotes: ['chuyển 10 triệu'] },
        { ...base, evidence_message_ids: ['msg-999'] },
      ],
      messages,
    );
    expect(r.valid).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });
  it('loại bằng chứng trỏ vào tin của chính người dùng', () => {
    const msgs: ChatMessage[] = [...messages, { id: 'msg-002', seq: 2, sender: 'self', text: 'Em chuyển 500k rồi ạ' }];
    const r = validateEvidence([{ ...base, evidence_message_ids: ['msg-002'], evidence_quotes: ['chuyển 500k'] }], msgs);
    expect(r.valid).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('chính người dùng');
  });
  it('analyze bỏ tín hiệu AI không có bằng chứng hợp lệ', () => {
    const r = analyze(messages, { aiSignals: [{ ...base, type: 'ai_only', evidence_quotes: ['bịa'] }] });
    expect(r.signals.map((s) => s.type)).not.toContain('ai_only');
  });
});
