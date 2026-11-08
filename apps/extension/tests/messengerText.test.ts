import { describe, expect, it } from 'vitest';
import { cleanBubbleText, isSystemNotice, normalizeDomId } from '../src/content/messengerParse';

describe('đọc chữ trong khung chat Messenger', () => {
  it('bỏ chữ trạng thái dưới tin của mình', () => {
    expect(cleanBubbleText('mình đã từng làm mẫu Đã gửi')).toBe('mình đã từng làm mẫu');
    expect(cleanBubbleText('ok Đã xem')).toBe('ok');
    expect(cleanBubbleText('Đã gửi')).toBe('');
    expect(cleanBubbleText('em đã gửi rồi')).toBe('em đã gửi rồi');
  });
  it('nhận ra thông báo mã hóa đầu cuối', () => {
    expect(isSystemNotice('Tin nhắn và cuộc gọi được bảo mật bằng tính năng mã hóa đầu cuối. Chỉ những người tham gia…')).toBe(true);
    expect(isSystemNotice('Tin nhắn này của em nhé')).toBe(false);
  });
  it('cùng một tin ở hàng ngoài và hàng trong có cùng mã', () => {
    expect(normalizeDomId('100081779011472@msgr.7524953784896791304')).toBe(normalizeDomId('7524953784896791304'));
    expect(normalizeDomId(undefined)).toBeUndefined();
  });
});
