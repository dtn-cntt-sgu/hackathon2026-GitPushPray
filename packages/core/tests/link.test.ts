import { describe, expect, it } from 'vitest';
import { buildAiRequest } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import { analyzeUrl, findUrls, sanitizeUrl, unwrapFacebookLink } from '@safechat/core/link';
import { externalLinks } from '../../../apps/extension/src/content/messengerParse';
import type { ChatMessage } from '@safechat/core/types';

const chat = (rows: [ChatMessage['sender'], string, string[]?][]): ChatMessage[] =>
  rows.map(([sender, text, links], i) => ({ id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender, text, ...(links ? { links } : {}) }));

describe('analyzeUrl', () => {
  it.each([
    ['https://vietcombank-xacthuc.store/login', 'high'],
    ['https://vietcombank-xacthuc.xyz/login', 'high'],
    ['https://vietc0mbank.com/login', 'high'],
    ['https://vietcombank.com.vn@evil-site.top/login', 'high'],
    ['https://tải-về.example.com/a.apk', 'high'],
    ['intent://scan/#Intent;scheme=zxing;end', 'high'],
    ['http://103.45.67.89/login', 'medium'],
    ['https://google.com@evil.example/', 'medium'],
    ['https://xn--vitcmbank-abc.com/login', 'medium'],
    ['https://ho-tro-tai-khoan.ru/verify', 'medium'],
    ['bit.ly/abc123', 'medium'],
    ['https://khuyenmai.vip', 'medium'],
    ['https://nhanqua.top', 'medium'],
    ['https://aothun.shop', 'weak'],
    ['https://bongda.live', 'weak'],
    ['https://nhahang.vn/dang-nhap', 'weak'],
    ['https://vietcombank.com.vn/login', 'none'],
    ['https://portal.vietcombank.com.vn/a', 'none'],
    ['https://dichvucong.gov.vn', 'none'],
    ['https://forms.gle/abc123', 'none'],
    ['nhahang.vn/menu', 'none'],
  ])('%s → %s', (url, level) => {
    expect(analyzeUrl(url)?.level).toBe(level);
  });
  it('tên miền trộn chữ Cyrillic là rất đáng ngờ', () => {
    expect(analyzeUrl('https://vietcоmbank.com/login')?.level).toBe('high');
  });
  it('tách đúng tên miền với .com.vn', () => {
    expect(analyzeUrl('https://a.b.nhahang.com.vn/x')?.domain).toBe('nhahang.com.vn');
  });
  it('link không có scheme không bị coi là thiếu https', () => {
    expect(analyzeUrl('nhahang.vn')?.reasons).toEqual([]);
  });
  it('tel, mailto không phải link web', () => {
    expect(analyzeUrl('tel:0912345678')).toBeNull();
    expect(analyzeUrl('mailto:a@x.vn')).toBeNull();
  });
});

describe('findUrls', () => {
  it('tìm được đuôi lạ, không nhận nhầm chữ thường và email', () => {
    expect(findUrls('Vào https://abc.store/x nhé')).toEqual(['https://abc.store/x']);
    expect(findUrls('vào bit.ly/abc123, nhanh nhé')).toEqual(['bit.ly/abc123']);
    expect(findUrls('Đã xong.Bạn thấy ok.nha, phí 1.5 triệu, mail a@x.vn')).toEqual([]);
  });
});

describe('sanitizeUrl và link bọc', () => {
  it('bỏ query, fragment, thông tin đăng nhập', () => {
    expect(sanitizeUrl('https://u:p@evil.top/a?token=1#b')).toBe('https://evil.top/a');
    expect(sanitizeUrl('bit.ly/abc?x=1')).toBe('bit.ly/abc');
  });
  it('gỡ link bọc của Facebook', () => {
    expect(unwrapFacebookLink('https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.top%2Fa&h=x')).toBe('https://evil.top/a');
    expect(unwrapFacebookLink('https://evil.top/a')).toBe('https://evil.top/a');
  });
  it('externalLinks bỏ link hồ sơ, gỡ link bọc', () => {
    expect(externalLinks(['https://www.facebook.com/nguoi.dung', 'https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.top%2Fa', 'https://evil.top/a'])).toEqual(['https://evil.top/a']);
  });
});

describe('link thật trong thẻ a', () => {
  it('chữ hiển thị trông bình thường, địa chỉ thật mới đáng ngờ', () => {
    const r = analyze(chat([['other', 'Xem chi tiết ở đây nhé', ['https://vietcombank-xacthuc.store/login']]]));
    expect(r.risk_level).toBe('high');
    expect(r.links?.[0]?.domain).toBe('vietcombank-xacthuc.store');
  });
  it('không gửi địa chỉ thật cho AI', () => {
    const m = chat([['other', 'Xem chi tiết ở đây nhé', ['https://evil.top/a?token=abc123']]]);
    const req = buildAiRequest(m, 0, '', []);
    expect(req.sent[0]).not.toHaveProperty('links');
    expect(JSON.stringify(req)).not.toContain('abc123');
  });
  it('link đầy đủ và dòng tên miền của thẻ xem trước chỉ hiện một lần', () => {
    const r = analyze(chat([
      ['other', 'https://vietcombank-xacthuc.store/login vietcombank-xacthuc.store', ['https://vietcombank-xacthuc.store/login']],
      ['other', 'Xem lại ở vietcombank-xacthuc.store nhé'],
    ]));
    expect(r.links?.filter((l) => l.host === 'vietcombank-xacthuc.store')).toHaveLength(1);
    expect(r.links?.[0]?.url).toBe('https://vietcombank-xacthuc.store/login');
  });
  it('kết quả hiển thị đã bỏ query', () => {
    const r = analyze(chat([['other', 'Vào https://evil.top/a?token=abc123 nhé']]));
    expect(JSON.stringify(r.links)).not.toContain('abc123');
  });
});

describe('người dùng đã làm theo', () => {
  it('đổi gợi ý sang việc cần làm ngay, tắt câu hỏi', () => {
    const a = analyze(chat([['other', 'Em đóng phí kích hoạt 500k nhé'], ['self', 'Em chuyển rồi đó chị'], ['other', 'Ok em']])).advice;
    expect(a.questions).toHaveLength(0);
    expect(a.actions[0]).toContain('tổng đài ngân hàng');
  });
  it('tin cuối của người dùng nói đã làm thì không báo đang chờ trả lời', () => {
    const a = analyze(chat([['other', 'Em đọc giúp chị mã OTP nhé'], ['self', 'Em đọc rồi, mã là 482913']])).advice;
    expect(a.waiting_answer).toBeUndefined();
    expect(a.actions[0]).toContain('khóa thẻ');
  });
  it('mức Nghiêm trọng vẫn giữ hướng dẫn an toàn và thêm việc cần làm', () => {
    const a = analyze(chat([['other', 'Anh tải file apk về rồi mở lên là được, bật quyền trợ năng'], ['self', 'Tôi cài xong rồi']])).advice;
    expect(a.actions[0]).toContain('Ngắt mạng');
    expect(a.safety_message).toBeTruthy();
  });
});
