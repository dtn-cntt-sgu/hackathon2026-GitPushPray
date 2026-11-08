import type { ObservedMessage } from '@safechat/core/transcript';
import type { ThreadInfo } from '../shared/protocol';
import type { HistoryResult } from './history';

/** Mỗi nền tảng/trang chat có một adapter riêng; mọi chi tiết DOM nằm trong adapter. */
export interface ChatAdapter {
  platform: 'messenger' | 'mock';
  /** Các cuộc trò chuyện đang mở và xác minh được — CHỈ siêu dữ liệu (tên, mã), không đọc nội dung tin. */
  listThreads(): ThreadInfo[];
  /** Lý do không có cuộc nào (hiển thị cho người dùng), nếu adapter biết rõ hơn thông báo chung. */
  whyNotDetected?(): string;
  /** Đọc tin văn bản của đúng cuộc `threadId`. Có `error` → phạm vi không an toàn, không trả tin nào. */
  readMessages(threadId: string): { messages: ObservedMessage[]; error?: string };
  /** Cuộn khung chat để tải thêm tin cũ, trả về đúng vị trí cũ. Không có thì chỉ đọc tin đang có. */
  loadHistory?(threadId: string, target: number, cancelled: () => boolean): Promise<HistoryResult>;
  /** Phần tử gốc để MutationObserver theo dõi cuộc `threadId`. */
  observeRoot(threadId: string): Node | null;
  /** Tọa độ khung bao của cuộc trò chuyện `threadId` trên màn hình (chỉ đọc, phục vụ neo thanh thu nhỏ). */
  getThreadRect?(threadId: string): DOMRect | null;
  /**
   * true: cuộc đã chọn biến mất (đóng khung chat popup) thì giữ phiên và chờ mở lại đúng cuộc đó.
   * false: coi là người dùng chuyển sang cuộc khác (trang một cuộc như chat giả lập).
   */
  keepsSelection: boolean;
}
