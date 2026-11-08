import raw from './scenarios.json';
import type { ChatMessage, RiskLevel, Sender } from '@safechat/core/types';

export interface Scenario {
  id: string;
  title: string;
  messages: ChatMessage[];
  expected: { level: RiskLevel; signals: string[]; forbidden?: string[] };
  /** Đang chờ luật mới: không tính vào chỉ số chính, test chỉ bỏ qua (it.todo). */
  pending?: boolean;
  /** Nguồn kịch bản (vd. "tonghopkichban TC_01"). */
  source?: string;
}

export const scenarios: Scenario[] = (
  raw as {
    id: string;
    title: string;
    messages: { sender: Sender; text: string; qr?: string[] }[];
    expected: Scenario['expected'];
    pending?: boolean;
    source?: string;
  }[]
).map((s) => ({
  ...s,
  messages: s.messages.map((m, i) => ({
    id: `msg-${String(i + 1).padStart(3, '0')}`,
    seq: i + 1,
    sender: m.sender,
    text: m.text,
    ...(m.qr ? { qr: m.qr } : {}),
  })),
}));
