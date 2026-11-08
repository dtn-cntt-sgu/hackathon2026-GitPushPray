// Tải lịch sử khi bắt đầu quét: cuộn khung chat lên, gom tin, rồi trả về đúng vị trí cũ.
// Tách khỏi DOM để kiểm thử được. Chỉ đổi vị trí cuộn, không bấm, không gửi gì.
import { mergeOlder, type ObservedMessage } from '@safechat/core/transcript';

/** Số tin đọc tối đa ở lần quét đầu. */
export const HISTORY_TARGET = 50;

const POLL_MS = 150;
/** Không thấy thêm tin sau chừng này thì coi như lần cuộn đó không tải được gì. */
const WAIT_GROWTH_MS = 1500;
/** Hai lần cuộn liên tiếp không có tin mới thì coi như đã hết lịch sử. */
const MAX_STALE = 2;
const TOTAL_BUDGET_MS = 8000;

export interface HistoryDriver {
  read(): { messages: ObservedMessage[]; error?: string };
  /** Cuộn lên đầu vùng đang tải. Trả false nếu không cuộn được. */
  scrollUp(): boolean;
  restore(): void;
  cancelled(): boolean;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

export interface HistoryResult {
  messages: ObservedMessage[];
  error?: string;
  /** true: đã thấy hết lịch sử hoặc đã đủ số tin; false: dừng vì hết thời gian hoặc bị hủy. */
  complete: boolean;
}

/** Lần quét đầu theo lựa chọn của người dùng: được cuộn thì tải thêm, không thì chỉ đọc tin đang có. Luôn giữ tin mới nhất. */
export async function readInitial(
  source: {
    readMessages(threadId: string): { messages: ObservedMessage[]; error?: string };
    loadHistory?(threadId: string, target: number, cancelled: () => boolean): Promise<HistoryResult>;
  },
  threadId: string,
  allowScroll: boolean,
  cancelled: () => boolean,
  target = HISTORY_TARGET,
): Promise<HistoryResult> {
  const result =
    allowScroll && source.loadHistory
      ? await source.loadHistory(threadId, target, cancelled)
      : { ...source.readMessages(threadId), complete: true };
  return { ...result, messages: result.messages.slice(-target) };
}

export async function collectHistory(d: HistoryDriver, target = HISTORY_TARGET): Promise<HistoryResult> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = d.now ?? Date.now;
  const first = d.read();
  if (first.error) return { messages: [], error: first.error, complete: false };
  let acc = first.messages;
  if (acc.length >= target) return { messages: acc.slice(-target), complete: true };

  const deadline = now() + TOTAL_BUDGET_MS;
  let stale = 0;
  let complete = false;
  try {
    while (!d.cancelled()) {
      if (acc.length >= target || stale >= MAX_STALE) {
        complete = true;
        break;
      }
      if (now() >= deadline) break;
      if (!d.scrollUp()) {
        complete = true; // không có gì để cuộn: chỉ có những tin đang hiển thị
        break;
      }
      const before = acc.length;
      const waitUntil = Math.min(now() + WAIT_GROWTH_MS, deadline);
      while (now() < waitUntil && acc.length === before && !d.cancelled()) {
        await sleep(POLL_MS);
        const r = d.read();
        if (r.error) return { messages: [], error: r.error, complete: false };
        acc = mergeOlder(acc, r.messages);
      }
      stale = acc.length === before ? stale + 1 : 0;
    }
  } finally {
    d.restore();
  }
  return { messages: acc.slice(-target), complete };
}
