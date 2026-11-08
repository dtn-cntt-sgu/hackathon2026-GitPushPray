// Trạng thái phiên và giao thức nhắn tin giữa side panel ⇄ background ⇄ content script.
import type { AiRequest, AiTier } from '@safechat/core/ai';
import type { ObservedMessage, TranscriptState } from '@safechat/core/transcript';
import type { StabilityState } from '@safechat/core/stability';
import type { AiInsight, AiNextStep, AnalysisResult, RiskLevel, Signal, UserMark } from '@safechat/core/types';

export type SessionStatus = 'idle' | 'tracking' | 'paused' | 'stopped';
export type PauseReason = 'user' | 'tab_closed' | 'thread_changed' | 'page_unsupported';
export type AiProvider = 'nano' | 'gateway';

// Địa chỉ gateway có thể được "nướng" lúc build bằng VITE_SAFECHAT_GATEWAY_URL.
// Khi để trống, người dùng tự nhập URL gateway trong Cài đặt (không cần khóa model).
const BUILD_ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
export const DEFAULT_GATEWAY_URL = BUILD_ENV?.VITE_SAFECHAT_GATEWAY_URL?.trim() ?? '';

export interface AiState {
  status: 'off' | 'idle' | 'running' | 'ok' | 'error';
  error?: string;
  /** Tóm tắt cuộn do AI viết (đã che PII), gửi kèm lần sau thay vì cả cuộc trò chuyện. */
  summary: string;
  lastSeq: number;
  lastAt: number;
  /** Số lần máy chủ AI lỗi liên tiếp. */
  failures?: number;
  /** Đã ngừng thử lại máy chủ AI tại tin này, chờ tin mới hoặc người dùng đổi cài đặt. */
  gaveUpAtSeq?: number;
  lastLevel: RiskLevel;
  /** Các loại tín hiệu quy tắc đã biết ở lần gọi trước. */
  lastRuleTypes: string[];
  signals: Signal[];
  uncertainties: string[];
  /** AI đề nghị hạ 1 bậc, gắn với mức quy tắc lúc AI đánh giá (mức đổi thì hết hiệu lực). */
  downgrade?: { reason: string; fromLevel: RiskLevel };
  detectedStage?: string;
  /** Gợi ý bước tiếp theo của AI ở lượt gần nhất. */
  nextStep?: AiNextStep;
  /** Nhận định ngữ cảnh của AI ở lượt gần nhất. */
  insight?: AiInsight;
  calls: number;
  lastProvider?: AiProvider;
  lastTier?: AiTier;
  /** Model gateway báo đã dùng (chỉ tên model, không có nội dung). */
  lastModel?: string;
  lastReason?: string;
  /** Yêu cầu đang chờ side panel chạy bằng Gemini Nano. */
  pending?: { id: string; tier: AiTier; request: AiRequest; createdAt: number };
}

export interface TimelinePoint {
  seq: number;
  messageId: string;
  level: RiskLevel;
  score: number;
  /** Tín hiệu mới xuất hiện tại thời điểm này. */
  newSignals: string[];
  /** Ghi chú chống dao động (giữ mức / chờ xác nhận). */
  note?: string;
}

export interface Session {
  status: SessionStatus;
  pauseReason?: PauseReason;
  tabId: number;
  threadId: string;
  threadLabel: string;
  platform: 'messenger' | 'mock';
  startedAt: number;
  /** Tiến độ quét ban đầu: đang tải lịch sử, hoặc đã đọc được bao nhiêu tin. */
  scan?: { state: 'loading' | 'done'; target: number; scroll?: boolean; read?: number; complete?: boolean };
  /** Thời điểm nhận tin gần nhất, để biết hội thoại đã dừng bao lâu. Thiếu thì tính từ startedAt. */
  lastMessageAt?: number;
  maxMessages: number;
  transcript: TranscriptState;
  result: AnalysisResult | null;
  ai: AiState;
  /** Diễn biến mức cảnh báo (chỉ ghi khi có thay đổi). */
  timeline: TimelinePoint[];
  /** Trạng thái chống dao động (mức hiển thị, mức cao nhất, chờ xác nhận/hạ). Thiếu ở phiên cũ → khởi tạo lại. */
  stability?: StabilityState;
  /** Phiên được tiếp tục từ file bản nháp (Context Manager). */
  resumedFrom?: { savedAt: string; threadLabel: string; startedAt: number };
  /** Đánh dấu của người dùng theo khóa tín hiệu (type + tin bằng chứng đầu tiên). */
  marks: Record<string, UserMark>;
  /** Thread mới phát hiện khi người dùng chuyển chat (chờ xác nhận). */
  pendingThread?: { threadId: string; threadLabel: string };
  /** Khung chat đã chọn đang đóng/không hiển thị: giữ phiên, chờ mở lại đúng cuộc này. */
  waiting?: boolean;
  /** Bộ đọc từ chối đọc vì không xác minh được phạm vi (vd. mã tin không khớp người đã chọn). */
  readerError?: string;
}

export interface Settings {
  maxMessages: number;
  /** AI trên máy (Chrome Prompt API / Gemini Nano) — chạy trong side panel. */
  nanoEnabled: boolean;
  /** AI qua gateway SafeChat (AWS). Không cần khóa model trong extension. */
  gatewayEnabled: boolean;
  /** URL gốc của gateway, ví dụ https://abc.execute-api.ap-northeast-1.amazonaws.com/prod */
  gatewayUrl: string;
  /** Số lượt gọi gateway tối đa mỗi ngày trên thiết bị này (giữ chi phí/hạn mức). */
  dailyBudget: number;
  /** Gọi AI khi đủ N tin mới (cả hai phía), có ít nhất 1 tin của đối phương. */
  batchSize: number;
  /** Khi bắt đầu quét: true tự cuộn khung chat để tải tối đa 50 tin; false không cuộn, chỉ đọc các tin đang có trên trang. */
  historyScroll: boolean;
  /** false: không đọc mã QR trong ảnh. Không đặt nghĩa là có đọc. */
  qrScan?: boolean;
  /** Người dùng đã đọc và đồng ý trong bảng của widget. Chưa có thì thả mèo chỉ mở bảng, không đọc gì. */
  scanConsent?: boolean;
  /** Phiên bản mặc định của lịch gọi AI, để đổi một lần cho máy đã lưu cài đặt cũ. */
  policyVersion?: number;
  /** Hội thoại dừng lâu chừng này thì gọi nốt tin lẻ chưa đủ lô. 0 = tắt. */
  idleFlushSec: number;
  minIntervalSec: number;
}

export const DEFAULT_SETTINGS: Settings = {
  maxMessages: 300,
  nanoEnabled: false,
  gatewayEnabled: false,
  gatewayUrl: DEFAULT_GATEWAY_URL,
  dailyBudget: 200,
  batchSize: 2,
  historyScroll: true,
  policyVersion: 2,
  idleFlushSec: 20,
  minIntervalSec: 30,
};

/** Máy đã lưu lịch gọi AI cũ (5 tin, 60 giây) nhận mặc định mới đúng một lần; sau đó giữ giá trị người dùng đặt. */
export function migrateSettings(stored: Record<string, unknown>): { settings: Record<string, unknown>; changed: boolean } {
  if (Object.keys(stored).length === 0 || stored.policyVersion === DEFAULT_SETTINGS.policyVersion) return { settings: stored, changed: false };
  const { batchSize: _b, idleFlushSec: _i, minIntervalSec: _m, ...rest } = stored;
  return { settings: { ...rest, policyVersion: DEFAULT_SETTINGS.policyVersion }, changed: true };
}

export function emptyAiState(): AiState {
  return { status: 'off', summary: '', lastSeq: 0, lastAt: 0, lastLevel: 'low', lastRuleTypes: [], signals: [], uncertainties: [], calls: 0 };
}

export const SESSION_KEY = 'safechat_session';
export const SETTINGS_KEY = 'safechat_settings';
export const USAGE_KEY = 'safechat_ai_usage';

export function signalKey(s: Signal): string {
  return `${s.type}:${s.evidence_message_ids[0] ?? ''}`;
}

export interface ThreadInfo {
  threadId: string;
  threadLabel: string;
}

export interface ProbeResult {
  supported: boolean;
  platform?: Session['platform'];
  /** Có khi chỉ có đúng một cuộc trò chuyện đang mở. */
  threadId?: string;
  threadLabel?: string;
  /** Mọi cuộc trò chuyện đang mở (chỉ tên + mã, không có nội dung tin) để người dùng chọn. */
  threads?: ThreadInfo[];
  reason?: string;
}

/** Danh sách cuộc trò chuyện từ kết quả dò (tương thích kết quả cũ chỉ có threadId). */
export function probeThreads(p: ProbeResult | null | undefined): ThreadInfo[] {
  if (!p?.supported) return [];
  if (p.threads?.length) return p.threads;
  return p.threadId ? [{ threadId: p.threadId, threadLabel: p.threadLabel ?? '' }] : [];
}

/** Side panel → background */
export type PanelRequest =
  | { kind: 'probe'; tabId: number }
  /** allowScroll: lựa chọn cách đọc từ widget, được lưu lại vào cài đặt. Không có thì dùng cài đặt đã lưu. */
  | { kind: 'start'; tabId: number; threadId?: string; allowScroll?: boolean }
  | { kind: 'set_scan_consent'; value: boolean }
  | { kind: 'set_qr_scan'; value: boolean }
  /** Context Manager: khôi phục phiên từ file ảnh chụp (chuỗi JSON) và gắn vào cuộc chat đang mở ở tab. */
  | { kind: 'resume_snapshot'; tabId: number; snapshot: string; threadId?: string }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'stop_and_clear' }
  | { kind: 'switch_to_pending' }
  | { kind: 'mark'; key: string; mark: UserMark | null }
  | { kind: 'reanalyze' }
  | { kind: 'panel_status'; nanoReady: boolean }
  | { kind: 'ai_result'; id: string; ok: true; content: string }
  | { kind: 'ai_result'; id: string; ok: false; error: string };

export interface StopResult {
  ok: boolean;
  remainingKeys: string[];
}

/** Background → content script */
export type ContentRequest =
  | { kind: 'cs_probe' }
  /** loadHistory: lần quét đầu của phiên, gom tin một lần. allowScroll: được tự cuộn để tải thêm. */
  | { kind: 'cs_start'; threadId: string; loadHistory?: boolean; allowScroll?: boolean; readQr?: boolean }
  | { kind: 'cs_stop' };

/** Content script → background */
export type ContentEvent =
  | { kind: 'cs_ready' }
  | { kind: 'cs_scan_started'; threadId: string; target: number; scroll: boolean }
  | { kind: 'cs_messages'; threadId: string; batch: ObservedMessage[]; error?: string; initial?: { target: number; complete: boolean } }
  /** Khung chat đã chọn bị đóng (waiting=true) hoặc đã mở lại (false). */
  | { kind: 'cs_thread_waiting'; threadId: string; waiting: boolean }
  | { kind: 'cs_thread_changed'; threadId: string | null; threadLabel: string };
