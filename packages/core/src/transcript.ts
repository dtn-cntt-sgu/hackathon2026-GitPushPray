import type { ChatMessage, Sender } from './types';

export const DEFAULT_MAX_MESSAGES = 300;
/** Chữ thay cho tin chỉ có ảnh mã QR. */
export const QR_ONLY_TEXT = '[Ảnh mã QR]';

/** Tin nhắn thô do adapter đọc từ giao diện, theo thứ tự hiển thị. */
export interface ObservedMessage {
  sender: Sender;
  text: string;
  /** ID ổn định từ DOM nếu có (ví dụ data-id). */
  domId?: string;
  timestamp?: string;
  /** Địa chỉ thật của các link trong tin. */
  links?: string[];
  /** Nội dung mã QR đọc được từ ảnh trong tin. */
  qr?: string[];
}

export interface TranscriptState {
  messages: ChatMessage[];
  /** Khóa nội dung (sender|text) hoặc domId, song song với messages. */
  keys: string[];
  nextSeq: number;
}

export function emptyTranscript(): TranscriptState {
  return { messages: [], keys: [], nextSeq: 1 };
}

const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
/** Tin chỉ có ảnh QR đều cùng một chữ, nên khóa phải có nội dung mã để phân biệt các ảnh khác nhau. */
const keyOf = (o: ObservedMessage) =>
  o.domId ? `d:${o.domId}` : `c:${o.sender}|${clean(o.text)}${clean(o.text) === QR_ONLY_TEXT ? `|${o.qr?.[0] ?? ''}` : ''}`;

/**
 * Xác định phần tin MỚI trong một lô quan sát. Giao diện chat thường render lại hoặc chỉ giữ một
 * "cửa sổ" tin trong DOM, nên mỗi lô là toàn bộ tin đang hiển thị chứ không chỉ tin mới.
 *  1. Tin có domId: mới khi domId chưa gặp VÀ nằm sau tin đã biết cuối cùng trong lô (tin chưa gặp nằm
 *     trước đó là lịch sử cũ hiện ra khi cuộn lên → bỏ, để bản nháp không bị đảo thứ tự).
 *  2. Còn lại: tìm đoạn dài nhất trong lô trùng với phần ĐUÔI của bản nháp; tin sau đoạn đó là mới.
 *  3. Không có đoạn trùng: chỉ nhận tin có nội dung chưa từng gặp (tránh nhân đôi khi cuộn lên xem lịch sử).
 * Giới hạn: tin cũ hơn thời điểm bắt đầu theo dõi (cuộn lên) không được bổ sung vào bản nháp.
 */
function newPart(state: TranscriptState, batch: ObservedMessage[]): ObservedMessage[] {
  if (batch.some((o) => o.domId)) {
    const seen = new Set(state.keys);
    let lastKnown = -1;
    batch.forEach((o, i) => {
      if (seen.has(keyOf(o))) lastKnown = i;
    });
    return batch.slice(lastKnown + 1).filter((o) => !seen.has(keyOf(o)));
  }
  const E = state.keys;
  const B = batch.map(keyOf);
  if (E.length === 0) return batch;

  let bestK = 0;
  let bestEnd = -1;
  for (let end = 0; end < B.length; end++) {
    let k = 0;
    while (k <= end && k < E.length && B[end - k] === E[E.length - 1 - k]) k++;
    // Ưu tiên đoạn dài nhất; hòa thì lấy vị trí muộn hơn (an toàn, tránh trùng)
    if (k > 0 && k >= bestK) {
      bestK = k;
      bestEnd = end;
    }
  }
  if (bestEnd >= 0) return batch.slice(bestEnd + 1);

  const seen = new Set(E);
  return batch.filter((o) => !seen.has(keyOf(o)));
}

/**
 * Gộp hai lần đọc khi đang cuộn lên: `next` có thể chứa thêm tin cũ hơn và có thể đã mất tin mới nhất
 * vì giao diện chỉ giữ một phần trong DOM. Trả về danh sách từ cũ tới mới, không trùng.
 */
export function mergeOlder(acc: ObservedMessage[], next: ObservedMessage[]): ObservedMessage[] {
  const filtered = next.filter((o) => clean(o.text));
  if (acc.length === 0) return filtered;
  const firstKey = keyOf(acc[0]!);
  const at = filtered.findIndex((o) => keyOf(o) === firstKey);
  if (at === 0) return acc;
  if (at > 0) return [...filtered.slice(0, at), ...acc];
  // Không có tin chung: chỉ nhận tin chưa gặp và coi là cũ hơn, vì đang cuộn lên.
  const seen = new Set(acc.map(keyOf));
  const known = filtered.some((o) => seen.has(keyOf(o)));
  return known ? acc : [...filtered, ...acc];
}

/** Ảnh trong tin đã có có thể tải xong muộn hơn chữ: bổ sung mã QR vào đúng tin đó. Trả true nếu có thay đổi. */
export function mergeLateQr(state: TranscriptState, batch: ObservedMessage[]): boolean {
  let changed = false;
  for (const o of batch) {
    if (!o.qr?.length) continue;
    const at = state.keys.lastIndexOf(keyOf(o));
    const m = at >= 0 ? state.messages[at] : undefined;
    if (m && !m.qr?.length) {
      m.qr = o.qr;
      changed = true;
    }
  }
  return changed;
}

/**
 * Ghép các tin quan sát được vào bản nháp (khử trùng lặp, giữ tối đa `max` tin gần nhất).
 * Trả về các tin mới được thêm.
 */
export function appendObserved(
  state: TranscriptState,
  batch: ObservedMessage[],
  max = DEFAULT_MAX_MESSAGES,
): ChatMessage[] {
  const filtered = batch.filter((o) => clean(o.text));
  const added: ChatMessage[] = [];
  for (const o of newPart(state, filtered)) {
    const msg: ChatMessage = {
      id: `msg-${String(state.nextSeq).padStart(3, '0')}`,
      sender: o.sender,
      text: clean(o.text),
      seq: state.nextSeq,
      timestamp: o.timestamp,
      ...(o.links?.length ? { links: o.links } : {}),
      ...(o.qr?.length ? { qr: o.qr } : {}),
    };
    state.nextSeq++;
    state.messages.push(msg);
    state.keys.push(keyOf(o));
    added.push(msg);
  }
  if (state.messages.length > max) {
    const drop = state.messages.length - max;
    state.messages.splice(0, drop);
    state.keys.splice(0, drop);
  }
  return added;
}
