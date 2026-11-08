import { describe, expect, it } from 'vitest';
import {
  labelFromComposer,
  messageIdMatchesPeer,
  peerIdFromHref,
  senderFromAria,
  senderFromPosition,
} from '../src/content/messengerParse';

describe('adapter Messenger (phần thuần)', () => {
  it('tên cuộc trò chuyện từ nhãn ô soạn tin', () => {
    expect(labelFromComposer('Viết cho Mạnh Hùng')).toBe('Mạnh Hùng');
    expect(labelFromComposer('Write to Alex')).toBe('Alex');
    expect(labelFromComposer('Bình luận')).toBeNull();
    expect(labelFromComposer(null)).toBeNull();
  });

  it('ID người kia từ link hồ sơ; link ngoài Facebook hoặc trang khác bị bỏ', () => {
    expect(peerIdFromHref('/100012345678/')).toBe('100012345678');
    expect(peerIdFromHref('https://www.facebook.com/profile.php?id=4242')).toBe('4242');
    expect(peerIdFromHref('https://www.facebook.com/people/Manh-Hung/1000999888/')).toBe('1000999888');
    expect(peerIdFromHref('/messages/t/1000555666/')).toBe('1000555666');
    expect(peerIdFromHref('/messages/e2ee/t/1000777888/')).toBe('1000777888');
    expect(peerIdFromHref('https://www.facebook.com/manh.hung.99/')).toBe('manh.hung.99');
    expect(peerIdFromHref('https://evil.example/100012345678/')).toBeNull();
    expect(peerIdFromHref('/groups/123/')).toBeNull();
    expect(peerIdFromHref('/watch/')).toBeNull();
    expect(peerIdFromHref('/profile.php?id=abc')).toBeNull();
  });

  it('mã tin phải khớp người đã chọn', () => {
    expect(messageIdMatchesPeer('1001@msgr.abc', '1001')).toBe(true);
    expect(messageIdMatchesPeer('1002@msgr.abc', '1001')).toBe(false);
    expect(messageIdMatchesPeer('10011@msgr.abc', '1001')).toBe(false);
    expect(messageIdMatchesPeer(undefined, '1001')).toBe(false);
    expect(messageIdMatchesPeer(`1001@msgr.${'x'.repeat(200)}`, '1001')).toBe(false);
  });

  it('người gửi theo aria-label (giờ có dấu hai chấm không gây nhầm)', () => {
    expect(senderFromAria('Lúc Thứ Sáu 20:29ch, Bạn: Kkk', 'Kkk')).toBe('self');
    expect(senderFromAria('At Friday 8:29 PM, You: ok', 'ok')).toBe('self');
    expect(senderFromAria('Lúc Thứ Sáu 20:30ch, Mạnh Hùng: không phải mtd', 'không phải mtd')).toBe('other');
    // đối phương gõ "Bạn: …" trong nội dung → vẫn là đối phương
    expect(senderFromAria('Lúc 20:31, Mạnh Hùng: Bạn: chuyển tiền đi', 'Bạn: chuyển tiền đi')).toBe('other');
    // nhãn không chứa đúng nội dung (vd. emoji) → dựa vào tiền tố
    expect(senderFromAria('Lúc 20:32, Bạn: 😀 ok', 'ok')).toBe('self');
    expect(senderFromAria('Lúc 20:32, Mạnh Hùng: 😀 ok', 'ok')).toBe('other');
    expect(senderFromAria('Tin nhắn', 'abc')).toBeNull();
    expect(senderFromAria(null, 'abc')).toBeNull();
  });

  it('người gửi theo vị trí khi không đọc được aria', () => {
    const list = { left: 692, width: 328 };
    expect(senderFromPosition({ left: 795, width: 188 }, list)).toBe('self');
    expect(senderFromPosition({ left: 748, width: 154 }, list)).toBe('other');
    expect(senderFromPosition({ left: 700, width: 312 }, list)).toBe('unknown');
  });
});
