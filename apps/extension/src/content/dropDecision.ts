/** Việc cần làm khi người dùng thả mèo vào một khung chat. Hàm thuần để kiểm thử, không đụng DOM. */
export type DropAction =
  /** Thả lại đúng chat đang theo dõi: chỉ bám lại. */
  | 'redock'
  /** Đang theo dõi chat khác: phải hỏi trước vì đổi chat sẽ xóa phiên hiện tại. */
  | 'confirm_switch'
  /** Chưa từng đồng ý trong widget: mở bảng có lời đồng ý và cách đọc, chưa đọc gì. */
  | 'ask_consent'
  /** Đã đồng ý trước đó: khóa ngay theo cách đọc đã lưu. */
  | 'lock';

export function decideDrop(input: { sessionThreadId: string | null; targetThreadId: string; consented: boolean }): DropAction {
  if (input.sessionThreadId === input.targetThreadId) return 'redock';
  if (input.sessionThreadId) return 'confirm_switch';
  return input.consented ? 'lock' : 'ask_consent';
}

export function switchChatPrompt(currentLabel: string, targetLabel: string, currentLevel: string): string {
  return `Chuyển sang theo dõi "${targetLabel}"?\n\nKết quả và bằng chứng của "${currentLabel}" (mức ${currentLevel}) trên máy này sẽ bị xóa. Nếu cần giữ lại, hãy bấm Hủy rồi lưu phiên trước.`;
}
