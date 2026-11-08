// Tạo hội thoại dài từ ca có sẵn: thêm tin của các ca nhãn Thấp vào trước hoặc sau, nhãn của ca giữ nguyên.
// Dùng để thử quét ban đầu 30–50 tin, vì bộ v2 chỉ có tối đa 13 tin mỗi ca. Không phải dữ liệu thật, không tính là số độc lập.
import { analyze } from '@safechat/core/analyzer';
import type { ChatMessage } from '@safechat/core/types';
import type { BenchCase } from './dataset';

/** position 'before': đoạn gốc nằm cuối. 'after': đoạn gốc nằm đầu, sau đó là chuyện bình thường, để kiểm tra có quên tín hiệu cũ không. */
export function padCases(cases: BenchCase[], target: number, position: 'before' | 'after' = 'before'): BenchCase[] {
  // Chỉ lấy ca bình thường mà luật cũng chấm Thấp, để tin đệm không tự mang tín hiệu vào ca được đệm.
  const filler = cases.filter((c) => c.gold === 'low' && c.kind !== 'scam' && analyze(c.messages).risk_level === 'low').flatMap((c) => c.messages.map((m) => ({ id: c.id, sender: m.sender, text: m.text })));
  if (filler.length === 0) throw new Error('Không có ca nhãn Thấp để làm tin đệm');
  return cases.map((c, caseIndex) => {
    const need = Math.max(0, target - c.messages.length);
    const pad: Pick<ChatMessage, 'sender' | 'text'>[] = [];
    // Xuất phát khác nhau theo ca để các ca không có cùng một đoạn đệm; bỏ tin của chính ca này.
    for (let i = 0, at = caseIndex * 7; pad.length < need && i < filler.length * 2; i++, at++) {
      const f = filler[at % filler.length]!;
      if (f.id !== c.id) pad.push({ sender: f.sender, text: f.text });
    }
    const core = c.messages.map(({ sender, text }) => ({ sender, text }));
    const all = position === 'before' ? [...pad, ...core] : [...core, ...pad];
    const messages: ChatMessage[] = all.map((m, i) => ({ id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender: m.sender, text: m.text }));
    return { ...c, messages };
  });
}
