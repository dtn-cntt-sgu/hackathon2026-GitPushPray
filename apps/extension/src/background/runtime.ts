// Tiện ích dùng chung trong service worker.
import { analyze } from '@safechat/core/analyzer';
import { stabilize } from '@safechat/core/stability';
import type { RiskLevel } from '@safechat/core/types';
import type { ContentRequest, Session } from '../shared/protocol';

// Mọi thay đổi phiên đi qua hàng đợi để tránh ghi đè lẫn nhau khi sự kiện đến dồn dập.
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

export async function sendToTab(tabId: number, req: ContentRequest): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, req);
  } catch {
    return undefined; // content script chưa có trên tab (trang không hỗ trợ)
  }
}

const BADGE: Record<RiskLevel, { text: string; color: string }> = {
  low: { text: '', color: '#5f6b7a' },
  attention: { text: '!', color: '#b08a00' },
  high: { text: '!!', color: '#c25e00' },
  critical: { text: '!!!', color: '#b3261e' },
};

export async function updateBadge(s: Session | null) {
  const b = BADGE[s?.result?.risk_level ?? 'low'];
  await chrome.action.setBadgeText({ text: s ? b.text : '' });
  await chrome.action.setBadgeBackgroundColor({ color: b.color });
}

/** Phân tích lại toàn bộ bản nháp (quy tắc + tín hiệu AI đã có) và ghi diễn biến nếu có thay đổi. */
export function recompute(s: Session) {
  const before = s.result;
  const aiStatus =
    s.ai.status === 'off' ? 'off' : s.ai.status === 'ok' ? 'ok' : s.ai.status === 'error' ? 'error' : 'pending';
  const raw = analyze(s.transcript.messages, {
    aiSignals: s.ai.signals,
    aiUncertainties: s.ai.uncertainties,
    aiStatus,
    aiError: s.ai.error,
    aiDowngrade: s.ai.downgrade,
    // AI lỗi thì về gợi ý theo luật, không giữ câu hỏi cũ.
    aiNextStep: s.ai.status === 'error' ? undefined : s.ai.nextStep,
    // Nhận định cũ vẫn có ích khi AI lỗi lượt sau, nhưng chỉ dùng khi chưa có tin mới quá xa.
    aiInsight: s.ai.insight,
  });
  const last = s.transcript.messages.at(-1);
  // Chống dao động: chỉ tính là "lần đánh giá mới" khi có tin mới hoặc lượt AI mới
  const stable = stabilize(s.stability, raw, `${last?.seq ?? 0}:${s.ai.calls}`);
  s.stability = stable.state;
  s.result = stable.result;
  if (!last) return;
  const known = new Set(before?.signals.map((x) => x.type) ?? []);
  const fresh = s.result.signals.filter((x) => !known.has(x.type)).map((x) => x.title);
  if (
    !before ||
    before.risk_level !== s.result.risk_level ||
    before.score !== s.result.score ||
    before.stability_note !== s.result.stability_note ||
    fresh.length
  ) {
    const prev = s.timeline.at(-1);
    if (prev && prev.seq === last.seq) s.timeline.pop();
    s.timeline.push({
      seq: last.seq,
      messageId: last.id,
      level: s.result.risk_level,
      score: s.result.score,
      newSignals: fresh,
      note: stable.note,
    });
    if (s.timeline.length > 100) s.timeline.splice(0, s.timeline.length - 100);
  }
}
