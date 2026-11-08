import { describe, expect, it } from 'vitest';
import type { ObservedMessage } from '@safechat/core/transcript';
import { collectHistory, readInitial, type HistoryDriver } from '../src/content/history';

const msg = (i: number): ObservedMessage => ({ sender: 'other', text: `tin ${i}`, domId: `d${i}` });

/** Khung chat giả: mỗi lần cuộn tải thêm `step` tin cũ hơn, chỉ giữ `windowSize` tin trong DOM như giao diện ảo hóa. */
function fakeChat(total: number, loaded: number, step: number, windowSize = Infinity) {
  let start = total - loaded;
  let clock = 0;
  const state = { scrolls: 0, restored: 0 };
  const driver: HistoryDriver = {
    read: () => {
      const end = Math.min(total, start + windowSize);
      return { messages: Array.from({ length: end - start }, (_, i) => msg(start + i)) };
    },
    scrollUp: () => {
      state.scrolls++;
      start = Math.max(0, start - step);
      return true;
    },
    restore: () => {
      state.restored++;
    },
    cancelled: () => false,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { driver, state };
}

describe('readInitial: lựa chọn cách đọc', () => {
  const many = Array.from({ length: 80 }, (_, i) => msg(i));
  const make = () => {
    const calls = { load: 0 };
    return {
      calls,
      source: {
        readMessages: () => ({ messages: many.slice(-20) }),
        loadHistory: async () => {
          calls.load++;
          return { messages: many, complete: true };
        },
      },
    };
  };
  it('không cuộn: không gọi tải lịch sử, chỉ trả tin đang có', async () => {
    const { source, calls } = make();
    const r = await readInitial(source, 't', false, () => false);
    expect(calls.load).toBe(0);
    expect(r.messages).toHaveLength(20);
    expect(r.messages.at(-1)?.text).toBe('tin 79');
  });
  it('được cuộn: gọi tải lịch sử và giữ tối đa 50 tin mới nhất', async () => {
    const { source, calls } = make();
    const r = await readInitial(source, 't', true, () => false);
    expect(calls.load).toBe(1);
    expect(r.messages).toHaveLength(50);
    expect(r.messages[0]?.text).toBe('tin 30');
  });
  it('không cuộn mà trang có quá 50 tin: vẫn chỉ giữ 50 tin mới nhất', async () => {
    const r = await readInitial({ readMessages: () => ({ messages: many }) }, 't', false, () => false);
    expect(r.messages).toHaveLength(50);
    expect(r.messages.at(-1)?.text).toBe('tin 79');
  });
  it('trang không hỗ trợ cuộn: đọc tin đang có dù đã chọn tự cuộn', async () => {
    const r = await readInitial({ readMessages: () => ({ messages: many.slice(-5) }) }, 't', true, () => false);
    expect(r.messages).toHaveLength(5);
  });
});

describe('collectHistory', () => {
  it('đã đủ tin thì không cuộn và lấy đúng các tin mới nhất', async () => {
    const { driver, state } = fakeChat(80, 80, 10);
    const r = await collectHistory(driver, 50);
    expect(r.messages).toHaveLength(50);
    expect(r.messages[0]?.text).toBe('tin 30');
    expect(r.messages.at(-1)?.text).toBe('tin 79');
    expect(state.scrolls).toBe(0);
    expect(state.restored).toBe(0);
  });
  it('thiếu tin thì cuộn đến khi đủ, đúng thứ tự, trả về vị trí cũ', async () => {
    const { driver, state } = fakeChat(200, 20, 10);
    const r = await collectHistory(driver, 50);
    expect(r.messages).toHaveLength(50);
    expect(r.messages.map((m) => m.text)).toEqual(Array.from({ length: 50 }, (_, i) => `tin ${150 + i}`));
    expect(r.complete).toBe(true);
    expect(state.scrolls).toBe(3);
    expect(state.restored).toBe(1);
  });
  it('giao diện ảo hóa bỏ tin cuối khi cuộn lên: vẫn gom đủ', async () => {
    const { driver } = fakeChat(200, 20, 15, 20);
    const r = await collectHistory(driver, 50);
    expect(r.messages).toHaveLength(50);
    expect(r.messages.at(-1)?.text).toBe('tin 199');
    expect(new Set(r.messages.map((m) => m.domId)).size).toBe(50);
  });
  it('hội thoại ít tin: dừng sau 2 lần không có tin mới', async () => {
    const { driver, state } = fakeChat(12, 12, 10);
    const r = await collectHistory(driver, 50);
    expect(r.messages).toHaveLength(12);
    expect(r.complete).toBe(true);
    expect(state.scrolls).toBe(2);
    expect(state.restored).toBe(1);
  });
  it('không cuộn được thì trả tin đang có', async () => {
    const { driver } = fakeChat(10, 10, 5);
    driver.scrollUp = () => false;
    const r = await collectHistory(driver, 50);
    expect(r.messages).toHaveLength(10);
  });
  it('bị hủy giữa chừng vẫn trả về vị trí cũ', async () => {
    const { driver, state } = fakeChat(200, 20, 10);
    let cancelled = false;
    driver.cancelled = () => cancelled;
    const scroll = driver.scrollUp;
    driver.scrollUp = () => {
      cancelled = true;
      return scroll();
    };
    const r = await collectHistory(driver, 50);
    expect(r.complete).toBe(false);
    expect(state.restored).toBe(1);
  });
  it('đọc lỗi (mã tin không khớp) thì không trả tin nào và vẫn trả về vị trí cũ', async () => {
    const { driver, state } = fakeChat(200, 20, 10);
    let n = 0;
    const read = driver.read;
    driver.read = () => (++n > 1 ? { messages: [], error: 'Mã tin nhắn không khớp' } : read());
    const r = await collectHistory(driver, 50);
    expect(r.messages).toHaveLength(0);
    expect(r.error).toContain('không khớp');
    expect(state.restored).toBe(1);
  });
  it('hết thời gian thì dừng, báo chưa đủ', async () => {
    const { driver } = fakeChat(10_000, 5, 1);
    const r = await collectHistory(driver, 5000);
    expect(r.complete).toBe(false);
    expect(r.messages.length).toBeLessThan(5000);
    expect(r.messages.length).toBeGreaterThan(5);
  });
});
