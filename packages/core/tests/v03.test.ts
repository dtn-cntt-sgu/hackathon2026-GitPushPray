import { describe, expect, it } from 'vitest';
import { FINANCIAL_SAFETY_MESSAGE, SAFETY_MESSAGE } from '@safechat/core/advice';
import { buildAiRequest, parseAiResponse } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import { extractEntities } from '@safechat/core/entities';
import { normalizeForMatch } from '@safechat/core/normalize';
import type { ChatMessage } from '@safechat/core/types';

const msgs = (...texts: (string | [ChatMessage['sender'], string])[]): ChatMessage[] =>
  texts.map((t, i) => {
    const [sender, text] = typeof t === 'string' ? (['other', t] as const) : t;
    return { id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender, text };
  });

describe('hạ mức theo ngữ cảnh gần bằng chứng', () => {
  const chat = (lines: string[]): ChatMessage[] => lines.map((text, i) => ({ id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender: 'other' as const, text }));
  const talk = ['Hôm qua đi đá bóng vui ghê', 'Cuối tuần có về quê không', 'Mẹ tao vừa làm bánh ngon lắm', 'Phim đó xem chán thật', 'Chiều nay trời mưa to quá', 'Xe tao mới thay lốp xong'];
  const lunch = ['Tiền cơm trưa nay 50k nhé', 'Chuyển khoản 50k cho t nha', 'Đi ăn trưa thôi'];
  it('chuyện ở xa không làm mất ngữ cảnh tiền cơm', () => {
    const r = analyze(chat(['Tháng trước tao mua xe hết 300 triệu', 'Công ty tao tuần sau phỏng vấn đó', ...talk, ...lunch]));
    expect(r.signals.find((s) => s.type === 'money_transfer')?.mitigation).toBeTruthy();
    expect(r.risk_level).toBe('low');
  });
  it('khoản tiền cho mục đích khác ngay gần thì không hạ', () => {
    const r = analyze(chat([...talk, 'Tiền cơm 50k với 30 triệu tiền hàng', 'Chuyển khoản cho t nha']));
    expect(r.signals.find((s) => s.type === 'money_transfer')?.mitigation).toBeUndefined();
  });
  it('chốt chặn: tín hiệu nguy hiểm ở xa thì không hạ', () => {
    const r = analyze(chat(['Nhớ giữ bí mật, đừng nói với gia đình', ...talk, ...talk, ...lunch]));
    expect(r.signals.find((s) => s.type === 'money_transfer')?.mitigation).toBeUndefined();
  });
  it('chốt chặn: lừa việc làm ở xa thì không hạ', () => {
    const r = analyze(chat(['Bên chị tuyển cộng tác viên, việc nhẹ lương cao', ...talk, ...talk, 'Tiền cơm trưa nay 50k nhé', 'Em đóng phí 50k vào cho chị', 'Đi ăn trưa thôi']));
    expect(r.signals.find((s) => s.type === 'upfront_fee')?.mitigation).toBeUndefined();
    expect(r.risk_level).toBe('high');
  });
});

describe('chuẩn hóa v0.3', () => {
  it('gỡ chữ ngắt quãng, leetspeak, viết tắt chấm', () => {
    expect(normalizeForMatch('c.h.u.y.ể.n s-t-k ti3n v0n')).toBe('chuyen so tai khoan tien von');
    expect(normalizeForMatch('c.a gọi, v.k.s')).toBe('cong an goi , vien kiem sat');
  });
  it('không phá số tiền, tên miền, mp3/4g', () => {
    expect(normalizeForMatch('1.000.000đ t.me/abc mp3 4g')).toBe('1.000.000d t . me / abc mp3 4g');
  });
  it('"nv" là nhiệm vụ trong ngữ cảnh làm/nhận, còn lại là nhân viên', () => {
    expect(normalizeForMatch('làm nv đầu tiên')).toBe('lam nhiem vu dau tien');
    expect(normalizeForMatch('nv kinh doanh')).toBe('nhan vien kinh doanh');
  });
});

describe('bóc tách thực thể', () => {
  it('tách SĐT với STK; bỏ qua số tiền', () => {
    const e = extractEntities('Gọi 0912 345 678, chuyển STK 19038472910, tổng 15.000.000đ');
    expect(e.phones).toEqual(['0912345678']);
    expect(e.bankAccounts).toEqual(['19038472910']);
  });
  it('link rút gọn, giả thương hiệu là đáng ngờ; trang chính thức và email thì không', () => {
    expect(extractEntities('vào bit.ly/abc').suspiciousUrls).toHaveLength(1);
    expect(extractEntities('vneid-capnhat.top').suspiciousUrls[0]!.reason).toContain('vneid');
    expect(extractEntities('https://dichvucong.gov.vn').suspiciousUrls).toHaveLength(0);
    expect(extractEntities('gửi CV tới tuyendung@saomai.vn').urls).toHaveLength(0);
  });
  it('ví TRC20 và link kênh kín', () => {
    const e = extractEntities('ví TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7 hoặc t.me/hr_job');
    expect(e.cryptoWallets).toHaveLength(1);
    expect(e.channelLinks).toEqual(['t.me/hr_job']);
  });
});

describe('ANY_2 theo cửa sổ nhiều tin', () => {
  it('ghép nhóm từ các tin khác nhau, bằng chứng gồm mọi tin đóng góp', () => {
    const r = analyze(msgs('Đây là cơ quan điều tra.', 'Anh liên quan đường dây rửa tiền.'));
    const s = r.signals.find((x) => x.type === 'authority_impersonation')!;
    expect(s.evidence_message_ids).toEqual(['msg-001', 'msg-002']);
  });
  it('các nhóm cách nhau xa hơn cửa sổ thì không ghép', () => {
    const filler = Array.from({ length: 6 }, (_, i) => `tin thường ${i}`);
    const r = analyze(msgs('Đây là cơ quan điều tra.', ...filler, 'Anh liên quan đường dây rửa tiền.'));
    expect(r.signals.map((x) => x.type)).not.toContain('authority_impersonation');
  });
  it('tin của người dùng không góp nhóm', () => {
    const r = analyze(msgs(['self', 'Có phải cơ quan điều tra không?'], 'Anh liên quan đường dây rửa tiền.'));
    expect(r.signals.map((x) => x.type)).not.toContain('authority_impersonation');
  });
});

describe('luật ngữ cảnh giảm cảnh báo nhầm', () => {
  it('tín hiệu đã hạ mức dùng tiêu đề/lời khuyên trung lập, không nói về tuyển dụng; không ghi nhầm "thu nhập"', () => {
    const r = analyze(msgs('Shop nhận đơn size L rồi ạ, anh chuyển cọc 100k, còn lại nhận hàng kiểm tra rồi thanh toán COD ạ'));
    const s = r.signals.find((x) => x.type === 'upfront_fee')!;
    expect(s.mitigation).toBeTruthy();
    expect(s.title + s.recommended_action).not.toMatch(/tuyển dụng|nhận việc/);
    expect(r.claims.filter((c) => c.claim_type === 'salary')).toHaveLength(0);
    expect(r.level_reason).toContain('mức Thấp');
  });
  it('không hạ mức khi có ngữ cảnh tuyển dụng', () => {
    const r = analyze(msgs('Trúng tuyển rồi, em chuyển cọc 100k giữ chỗ việc làm, nhận hàng đồng phục COD nhé'));
    expect(r.signals.find((x) => x.type === 'upfront_fee')?.mitigation).toBeUndefined();
    expect(r.risk_level).toBe('high');
  });
  it('hạ mức theo ngữ cảnh, không phụ thuộc số tiền', () => {
    const r = analyze(msgs('Tiền cơm tháng này 2 triệu, ck vô stk 9988776655 nha'));
    expect(r.signals.find((x) => x.type === 'money_transfer')?.mitigation).toBe('Ngữ cảnh chia tiền sinh hoạt');
  });
  it('không hạ mức khi có dấu hiệu rủi ro khác', () => {
    const r = analyze(msgs('Tiền cơm 65k ck vô stk này nha, gửi mình mã OTP luôn'));
    expect(r.signals.find((x) => x.type === 'money_transfer')?.mitigation).toBeUndefined();
  });
});

describe('giai đoạn S0–S4', () => {
  it('đi qua nhiều giai đoạn được cộng điểm có trần, ghi tin đầu tiên', () => {
    const r = analyze(msgs('Tuyển cộng tác viên like video, hoa hồng 20%', 'Giờ em nạp 200k để làm nhiệm vụ nhé'));
    expect(r.stages_reached.map((x) => x.stage)).toEqual(['S1', 'S3']);
    expect(r.stage).toBe('S3');
    expect(r.level_reason).toContain('giai đoạn');
  });
});

describe('mức Nghiêm trọng: hướng dẫn theo loại nguy hiểm', () => {
  it('bẫy tài chính → hướng dẫn dừng giao dịch, không phải hướng dẫn di chuyển', () => {
    const r = analyze(msgs('Đơn trước sai cú pháp nên hệ thống đóng băng, em nạp thêm đơn cuối để rút cả gốc lẫn lãi'));
    expect(r.risk_level).toBe('critical');
    expect(r.advice.safety_message).toBe(FINANCIAL_SAFETY_MESSAGE);
    expect(r.advice.questions).toEqual([]);
  });
  it('cô lập/đe dọa → hướng dẫn an toàn thân thể', () => {
    const r = analyze(msgs('Đừng nói với bố mẹ nhé, tối nay có xe đón em'));
    expect(r.advice.safety_message).toBe(SAFETY_MESSAGE);
  });
});

describe('AI hạ tối đa 1 bậc', () => {
  const m = msgs('Ck vô stk 9988776655 giúp mình nhé');
  const base = analyze(m);
  it('áp dụng khi mức vẫn như lúc AI đánh giá', () => {
    expect(base.risk_level).toBe('attention');
    const r = analyze(m, { aiDowngrade: { reason: 'Bạn bè chia tiền', fromLevel: 'attention' } });
    expect(r.risk_level).toBe('low');
    expect(r.score).toBeLessThan(25);
    expect(r.ai_downgrade).toContain('Bạn bè chia tiền');
    expect(r.level_before_ai).toBe('attention');
  });
  it('hết hiệu lực khi mức đã thay đổi, và không bao giờ hạ từ Nghiêm trọng', () => {
    expect(analyze(m, { aiDowngrade: { reason: 'x', fromLevel: 'high' } }).risk_level).toBe('attention');
    const crit = msgs('Đừng nói với bố mẹ nhé');
    expect(analyze(crit, { aiDowngrade: { reason: 'x', fromLevel: 'critical' } }).risk_level).toBe('critical');
  });
  it('đọc level_adjustment và detected_stage từ phản hồi AI', () => {
    const req = buildAiRequest(m, 0, '', []);
    const p = parseAiResponse(
      JSON.stringify({ signals: [], summary: '', detected_stage: 'S3', level_adjustment: { direction: 'down', reason: 'Chia tiền ăn' } }),
      req,
      m,
      'test',
    );
    expect(p.downgradeReason).toBe('Chia tiền ăn');
    expect(p.detectedStage).toBe('S3');
    const none = parseAiResponse(JSON.stringify({ signals: [], summary: '', level_adjustment: { direction: 'down' } }), req, m, 't');
    expect(none.downgradeReason).toBeUndefined();
  });
});
