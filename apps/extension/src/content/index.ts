// Content script: thụ động cho tới khi background gửi cs_start (sau khi người dùng đồng ý).
// Chỉ đọc văn bản tin nhắn và mã QR trong ảnh của cuộc trò chuyện đã chọn; không gửi tin, không bấm gì.
// Lần quét đầu có thể tự cuộn khung chat để tải lịch sử rồi trả về vị trí cũ, nếu người dùng không tắt tùy chọn này.
import type { ContentEvent, ContentRequest, ProbeResult } from '../shared/protocol';
import type { ChatAdapter } from './adapter';
import { initFloatingWidget } from './floatingWidget';
import { HISTORY_TARGET, readInitial } from './history';
import { messengerAdapter } from './messengerAdapter';
import { mockAdapter } from './mockAdapter';
import { qrMadeProgress, qrPending, setQrEnabled } from './qrDecode';

const DEBOUNCE_MS = 400;
const CHECK_MS = 1000;
const QR_RETRY_MS = 800;
const QR_MAX_RETRIES = 8;

function pickAdapter(): ChatAdapter | null {
  if (document.querySelector('[data-safechat-mock-thread]')) return mockAdapter;
  if (/(^|\.)facebook\.com$|(^|\.)messenger\.com$/.test(location.hostname)) return messengerAdapter;
  return null;
}

let observer: MutationObserver | null = null;
let checkTimer: ReturnType<typeof setInterval> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let trackedThread: string | null = null;
let waiting = false;
let startRun = 0;
let qrRetry: ReturnType<typeof setTimeout> | undefined;
let qrRetries = 0;

function send(ev: ContentEvent) {
  chrome.runtime.sendMessage(ev).catch(() => {
    // Extension bị tải lại/gỡ: dừng hẳn để không chạy mồ côi
    stop();
  });
}

function flush(adapter: ChatAdapter) {
  if (!trackedThread || waiting) return;
  const { messages, error } = adapter.readMessages(trackedThread);
  if (error) send({ kind: 'cs_messages', threadId: trackedThread, batch: [], error });
  else if (messages.length) send({ kind: 'cs_messages', threadId: trackedThread, batch: messages });
  scheduleQrRetry(adapter);
}

/** Ảnh có thể tải xong sau chữ, và sự kiện tải ảnh không kích hoạt MutationObserver. */
function scheduleQrRetry(adapter: ChatAdapter) {
  clearTimeout(qrRetry);
  // Giới hạn chỉ tính lần không tiến triển, để đoạn chat nhiều ảnh vẫn đọc hết.
  if (qrMadeProgress()) qrRetries = 0;
  if (!qrPending() || qrRetries >= QR_MAX_RETRIES) return;
  qrRetries++;
  qrRetry = setTimeout(() => flush(adapter), QR_RETRY_MS);
}

function checkThread(adapter: ChatAdapter) {
  if (!trackedThread) return;
  const list = adapter.listThreads();
  if (list.some((t) => t.threadId === trackedThread)) {
    if (waiting) {
      waiting = false;
      send({ kind: 'cs_thread_waiting', threadId: trackedThread, waiting: false });
    }
    // Trang có thể thay phần tử gốc khi render lại → gắn lại observer nếu cần
    if (attachObserver(adapter)) flush(adapter);
    return;
  }
  if (adapter.keepsSelection) {
    // Khung chat bị đóng/thu nhỏ: giữ lựa chọn, chờ mở lại đúng cuộc này (không đọc cuộc khác)
    if (!waiting) {
      waiting = true;
      detachObserver();
      send({ kind: 'cs_thread_waiting', threadId: trackedThread, waiting: true });
    }
    return;
  }
  const next = list.length === 1 ? list[0]! : null;
  send({ kind: 'cs_thread_changed', threadId: next?.threadId ?? null, threadLabel: next?.threadLabel ?? '' });
  stop();
}

let observedRoot: Node | null = null;
/** Trả true khi vừa gắn observer vào phần tử gốc mới. */
function attachObserver(adapter: ChatAdapter): boolean {
  const root = trackedThread ? adapter.observeRoot(trackedThread) : null;
  if (!root || root === observedRoot) return false;
  detachObserver();
  observedRoot = root;
  observer = new MutationObserver(() => {
    clearTimeout(debounce);
    qrRetries = 0;
    debounce = setTimeout(() => flush(adapter), DEBOUNCE_MS);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return true;
}

function detachObserver() {
  observer?.disconnect();
  observer = null;
  observedRoot = null;
}

function beginWatching(adapter: ChatAdapter) {
  attachObserver(adapter);
  checkTimer = setInterval(() => checkThread(adapter), CHECK_MS);
}

function start(adapter: ChatAdapter, threadId: string, loadHistory = false, allowScroll = false) {
  stop();
  trackedThread = threadId;
  const run = startRun;
  if (!loadHistory) {
    beginWatching(adapter);
    flush(adapter);
    return;
  }
  void initialScan(adapter, threadId, run, allowScroll);
}

/** Lần quét đầu: gom tối đa HISTORY_TARGET tin rồi gửi một lần, sau đó mới theo dõi tin mới. */
async function initialScan(adapter: ChatAdapter, threadId: string, run: number, allowScroll: boolean) {
  send({ kind: 'cs_scan_started', threadId, target: HISTORY_TARGET, scroll: allowScroll });
  const cancelled = () => run !== startRun;
  const result = await readInitial(adapter, threadId, allowScroll, cancelled);
  if (cancelled()) return;
  send({ kind: 'cs_messages', threadId, batch: result.messages, error: result.error, initial: { target: HISTORY_TARGET, complete: result.complete } });
  beginWatching(adapter);
  scheduleQrRetry(adapter);
}

function stop() {
  startRun++;
  detachObserver();
  clearInterval(checkTimer);
  clearTimeout(debounce);
  clearTimeout(qrRetry);
  qrRetries = 0;
  trackedThread = null;
  waiting = false;
}

function probeLocal(): ProbeResult {
  const adapter = pickAdapter();
  if (!adapter) return { supported: false, reason: 'Trang này chưa được hỗ trợ.' };
  const threads = adapter.listThreads();
  const one = threads.length === 1 ? threads[0]! : null;
  return threads.length
    ? { supported: true, platform: adapter.platform, threads, threadId: one?.threadId, threadLabel: one?.threadLabel }
    : {
        supported: false,
        reason: adapter.whyNotDetected?.() ?? 'Chưa nhận diện chắc chắn cuộc trò chuyện. Hãy mở một đoạn chat cụ thể.',
      };
}

chrome.runtime.onMessage.addListener((req: ContentRequest, _sender, sendResponse) => {
  const adapter = pickAdapter();
  switch (req.kind) {
    case 'cs_probe':
      sendResponse(probeLocal());
      return false;
    case 'cs_start':
      setQrEnabled(req.readQr !== false);
      if (adapter) start(adapter, req.threadId, req.loadHistory, req.allowScroll);
      sendResponse({ ok: !!adapter });
      return false;
    case 'cs_stop':
      stop();
      sendResponse({ ok: true });
      return false;
  }
});

function getThreadRect(threadId: string): DOMRect | null {
  const adapter = pickAdapter();
  return adapter?.getThreadRect?.(threadId) ?? null;
}

// Khởi tạo Widget nổi SafeChat AI LIVE (Shadow DOM cô lập) trên trang được hỗ trợ
if (pickAdapter()) {
  initFloatingWidget(probeLocal, getThreadRect);
  // Nếu đang có phiên ở tab này, background gửi lại cs_start để đọc tiếp sau khi tải lại trang.
  send({ kind: 'cs_ready' });
}
