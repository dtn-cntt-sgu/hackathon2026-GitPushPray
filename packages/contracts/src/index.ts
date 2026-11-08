// Hợp đồng API giữa client (extension) và gateway. Giá trị client 'web' được công cụ đo dùng; 'android' còn trong
// hợp đồng để test kiểm tra token sai loại client, không có app Android.
// Đây là điểm ghép giữa các nhánh: đổi file này phải báo cả nhóm và đi bằng PR riêng vào main.
import type { ChatMessage, RiskLevel, ScamStage, Signal } from '@safechat/core/types';

export const API_VERSION = 'v1';

export type ClientKind = 'extension' | 'android' | 'web';
export type ModelTier = 'small' | 'large';

// ---------- POST /v1/devices ----------
export interface CreateDeviceRequest {
  client: ClientKind;
  clientVersion: string;
}

export interface CreateDeviceResponse {
  /** Gửi lại trong header Authorization: Bearer <token>. */
  token: string;
  /** ISO 8601. */
  expiresAt: string;
}

// ---------- POST /v1/analyses ----------
/** Gợi ý từ bộ luật gửi kèm cho AI. Các trường ngoài type và title là tùy chọn. */
export interface RuleHint {
  type: string;
  title: string;
  evidenceMessageIds?: string[];
}

export interface AnalysisRequest {
  client: ClientKind;
  clientVersion: string;
  /** Tin mới kèm vài tin ngữ cảnh, client đã che PII. Server sẽ che lại lần nữa. */
  messages: ChatMessage[];
  /** seq của tin cuối đã gửi cho AI, 0 nếu chưa gọi. */
  lastAiSeq: number;
  /** Tóm tắt cuộn do lần phân tích trước trả về. */
  summary: string;
  ruleHints: RuleHint[];
  /** Mức do bộ luật chấm ở thiết bị. */
  currentLevel: RiskLevel;
  stage?: ScamStage;
  tier: ModelTier;
}

export interface AnalysisUsage {
  model: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface AnalysisResponse {
  /** Tín hiệu từ AI, đã kiểm tra trích dẫn khớp tin được gửi. */
  signals: Signal[];
  summary: string;
  uncertainties: string[];
  /** Số tín hiệu bị loại vì trích dẫn không khớp. */
  rejected: number;
  /** Có giá trị khi AI đề nghị hạ 1 bậc. Client vẫn áp dụng giới hạn trong core. */
  downgradeReason?: string;
  detectedStage?: ScamStage;
  /** Gợi ý bước tiếp theo, đã qua kiểm tra an toàn. Client kiểm tra lại lần nữa. */
  nextStep?: { question: string | null; reason?: string; assessment: 'answered' | 'evasive' | 'contradictory' | 'not_answered' | 'none' };
  /** Nhận định ngữ cảnh, đã kiểm tra an toàn. Kèm trích dẫn tin người dùng để client xác nhận lại trạng thái nạn nhân. */
  insight?: {
    happening?: string;
    tactics: string[];
    victim_state: 'none' | 'doubting' | 'convinced' | 'about_to_comply' | 'complied';
    victim_message_id?: string;
    victim_quote?: string;
    likely_next?: string;
    warning?: string;
  };
  usage: AnalysisUsage;
}

// ---------- POST /v1/feedback ----------
/** Tuyệt đối không có nội dung tin nhắn. */
export interface FeedbackRequest {
  client: ClientKind;
  level: RiskLevel;
  signalTypes: string[];
  verdict: 'correct' | 'false_alarm' | 'missed';
}

// ---------- GET /v1/metrics/summary ----------
export interface MetricsSummary {
  date: string;
  calls: number;
  costUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  rejectedQuotes: number;
  byModel: Record<string, { calls: number; costUsd: number }>;
}

// ---------- GET /healthz ----------
export interface HealthResponse {
  status: 'ok';
  version: string;
  provider?: string;
  promptVersion?: string;
}

// ---------- Lỗi ----------
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'QUOTA_EXCEEDED'
  | 'BUDGET_EXCEEDED'
  | 'MODEL_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERNAL';

/** Mọi lỗi trả về dạng này. Client gặp lỗi thì giữ nguyên kết quả luật, không hạ mức. */
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    retryAfterSec?: number;
  };
}

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  QUOTA_EXCEEDED: 429,
  BUDGET_EXCEEDED: 503,
  MODEL_UNAVAILABLE: 503,
  TIMEOUT: 504,
  INTERNAL: 500,
};
