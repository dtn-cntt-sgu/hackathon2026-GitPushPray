import { describe, expect, it } from 'vitest';
import { decideDrop, switchChatPrompt } from '../src/content/dropDecision';

describe('thả mèo vào khung chat', () => {
  it('chưa đồng ý và chưa có phiên: chỉ mở bảng đồng ý, không khóa', () => {
    expect(decideDrop({ sessionThreadId: null, targetThreadId: 'a', consented: false })).toBe('ask_consent');
  });
  it('đã đồng ý và chưa có phiên: khóa ngay', () => {
    expect(decideDrop({ sessionThreadId: null, targetThreadId: 'a', consented: true })).toBe('lock');
  });
  it('đang theo dõi chat khác: luôn hỏi, kể cả khi đã đồng ý', () => {
    expect(decideDrop({ sessionThreadId: 'a', targetThreadId: 'b', consented: true })).toBe('confirm_switch');
    expect(decideDrop({ sessionThreadId: 'a', targetThreadId: 'b', consented: false })).toBe('confirm_switch');
  });
  it('thả lại đúng chat đang theo dõi: chỉ bám lại, không hỏi, không xóa', () => {
    expect(decideDrop({ sessionThreadId: 'a', targetThreadId: 'a', consented: false })).toBe('redock');
  });
  it('lời hỏi nói rõ chat nào, mức nào sẽ bị xóa', () => {
    const text = switchChatPrompt('Chat A', 'Chat B', 'Nghiêm trọng');
    expect(text).toContain('Chat A');
    expect(text).toContain('Chat B');
    expect(text).toContain('Nghiêm trọng');
    expect(text).toContain('bị xóa');
  });
});
