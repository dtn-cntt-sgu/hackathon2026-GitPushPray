// Kiểu dữ liệu dùng chung giữa core, background, content và side panel.
// core/ là logic thuần: không gọi chrome.* để có thể chạy trong Vitest.

/** self = người dùng; other = đối phương; unknown = adapter không xác định chắc chắn. */
export type Sender = 'self' | 'other' | 'unknown';

export interface ChatMessage {
  /** ID ổn định trong phiên, dạng "msg-001". */
  id: string;
  sender: Sender;
  text: string;
  /** Thứ tự quan sát trong phiên (bắt đầu từ 1). */
  seq: number;
  /** Thời điểm hiển thị nếu đọc được đáng tin cậy từ giao diện. */
  timestamp?: string;
  /** Địa chỉ thật của các link trong tin. Chỉ phân tích trên máy, không gửi cho AI. */
  links?: string[];
  /** Nội dung mã QR đọc được từ ảnh trong tin. Chỉ phân tích trên máy, không gửi cho AI. */
  qr?: string[];
}

export type VictimState = 'none' | 'doubting' | 'convinced' | 'about_to_comply' | 'complied';

/** Nhận định ngữ cảnh của AI, đã qua kiểm tra an toàn. Chỉ để hiển thị và kết hợp với luật. */
export interface AiInsight {
  /** Chuyện gì đang xảy ra, một câu. */
  happening?: string;
  /** Chiêu thao túng đối phương đang dùng. */
  tactics: string[];
  victim_state: VictimState;
  /** Trích dẫn từ tin của người dùng khớp thật, dùng để xác nhận trạng thái nạn nhân. */
  victim_evidence_ok: boolean;
  /** Bước tiếp theo đối phương có thể làm. */
  likely_next?: string;
  /** Lời cảnh báo viết riêng cho tình huống, gửi người dùng. */
  warning?: string;
  /** seq của tin cuối AI đã đọc. */
  atSeq?: number;
}

export type QrKind = 'url' | 'payment' | 'wifi' | 'contact' | 'vcard' | 'install' | 'crypto' | 'text';

/** Kết quả phân tích một mã QR. Số tài khoản đã che, chỉ còn 4 số cuối. */
export interface QrFinding {
  kind: QrKind;
  label: string;
  level: LinkLevel;
  reasons: string[];
  details: { label: string; value: string }[];
  url?: string;
  crcValid?: boolean;
  purpose?: string;
}

export type LinkLevel = 'none' | 'weak' | 'medium' | 'high';

/** Kết quả phân tích một đường link. `url` đã bỏ query và thông tin đăng nhập. */
export interface LinkFinding {
  url: string;
  host: string;
  domain: string | null;
  level: LinkLevel;
  reasons: string[];
  official: boolean;
  shortener: boolean;
  brand?: string;
}

export type RiskLevel = 'low' | 'attention' | 'high' | 'critical';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type SignalCategory =
  | 'finance'
  | 'account'
  | 'identity'
  | 'job_terms'
  | 'pressure'
  | 'isolation'
  | 'contradiction'
  | 'impersonation'
  | 'technical'
  | 'investment';

/** Giai đoạn kịch bản lừa đảo (tonghopkichban.md): suy ra từ tín hiệu, chỉ để hiển thị tiến trình + cộng điểm có trần. */
export type ScamStage = 'S0' | 'S1' | 'S2' | 'S3' | 'S4';

export type UserMark = 'verified' | 'not_relevant' | 'review';

export interface Signal {
  /** Loại tín hiệu, ví dụ "upfront_fee", "possible_contradiction". */
  type: string;
  category: SignalCategory;
  severity: Severity;
  title: string;
  explanation: string;
  evidence_message_ids: string[];
  /** Trích dẫn nguyên văn từ tin nhắn nguồn (cùng thứ tự với evidence_message_ids). */
  evidence_quotes: string[];
  recommended_action: string;
  source: 'rule' | 'ledger' | 'ai';
  /** Tín hiệu nguy hiểm trực tiếp → ưu tiên an toàn, mức Nghiêm trọng. */
  direct_danger?: boolean;
  /** Mức độ chắc chắn do AI tự đánh giá (0–1); rules không đặt trường này. */
  confidence?: number;
  /** Đã được hạ mức do ngữ cảnh hợp lệ (vd. chia tiền ăn, mua hàng có COD) — lý do hiển thị cho người dùng. */
  mitigation?: string;
  /** Mã luật trong tài liệu kịch bản (vd. R04). */
  ref?: string;
  /** Phần AI giải thích cho tín hiệu của luật cùng loại, theo ngữ cảnh. */
  ai_note?: string;
}

export type ClaimType = 'fee' | 'salary' | 'company' | 'location' | 'contract';
export type ClaimStatus = 'unverified' | 'consistent' | 'possible_contradiction' | 'explained';

export interface Claim {
  claim_id: string;
  claim_type: ClaimType;
  /** Nội dung rút gọn trung lập, ví dụ "Không thu phí", "Lương ~8.000.000đ/tháng". */
  claim_text: string;
  /** Giá trị đã chuẩn hóa để so sánh (tên công ty không dấu, số tiền/tháng...). */
  value: string;
  source_message_id: string;
  timestamp?: string;
  status: ClaimStatus;
  related_claim_ids: string[];
  evidence_quotes: string[];
}

export type AnswerAssessment = 'answered' | 'evasive' | 'contradictory' | 'not_answered' | 'none';

/** Gợi ý bước tiếp theo của AI, đã qua kiểm tra trong sanitizeNextStep. */
export interface AiNextStep {
  /** null: AI cho rằng lúc này chưa cần hỏi gì. */
  question: string | null;
  reason?: string;
  assessment: AnswerAssessment;
  /** seq của tin cuối AI đã đọc. */
  atSeq?: number;
}

export interface Advice {
  actions: string[];
  /** Câu hỏi xác minh trung lập, câu nên hỏi trước đứng đầu; rỗng khi safety_priority = true. */
  questions: string[];
  /** Vừa hỏi xong, chờ đối phương trả lời nên chưa gợi ý thêm. */
  waiting_answer?: boolean;
  /** Tiêu đề tín hiệu mới nhất, để phần trên khớp với câu hỏi. */
  focus_title?: string;
  /** Lý do AI gợi ý câu hỏi đầu tiên. */
  question_reason?: string;
  /** AI đánh giá câu trả lời vừa rồi. Chỉ để hiển thị, không bao giờ làm hạ mức. */
  answer_assessment?: AnswerAssessment;
  /** Lời cảnh báo AI viết cho đúng tình huống. Hiện làm dòng chính khi có. */
  ai_warning?: string;
  /** Bước tiếp theo đối phương có thể làm, theo AI. */
  likely_next?: string;
  safety_message?: string;
  support_resources?: string[];
}

export interface ScoreBreakdownItem {
  type: string;
  title: string;
  severity: Severity;
  base_points: number;
  weight: number;
  contribution: number;
}

export interface AnalysisResult {
  risk_level: RiskLevel;
  /** Điểm dấu hiệu 0–100 — KHÔNG phải xác suất lừa đảo. */
  score: number;
  /** Đóng góp của từng tín hiệu vào điểm. */
  score_breakdown: ScoreBreakdownItem[];
  /** Giải thích bằng lời vì sao ra mức hiện tại. */
  level_reason: string;
  /** Số tín hiệu theo nhóm. */
  category_counts: Partial<Record<SignalCategory, number>>;
  /** Giai đoạn cao nhất đã thấy và các giai đoạn đã đi qua (theo thứ tự). */
  stage: ScamStage;
  stages_reached: { stage: ScamStage; first_message_id: string }[];
  /** AI đã hạ 1 bậc (nếu có) — lý do. */
  ai_downgrade?: string;
  /** Mức trước khi áp dụng đề nghị hạ của AI (dùng để gắn đề nghị với đúng trạng thái). */
  level_before_ai: RiskLevel;
  /** Mức thô do analyze tính, trước lớp chống dao động (core/stability.ts); không đặt nếu chưa qua lớp đó. */
  raw_level?: RiskLevel;
  /** Lý do mức hiển thị đang được giữ/chờ xác nhận (chống dao động). */
  stability_note?: string;
  signals: Signal[];
  claims: Claim[];
  uncertainties: string[];
  safety_priority: boolean;
  advice: Advice;
  analyzed_message_count: number;
  /** Các link của đối phương, nặng nhất trước. */
  links?: LinkFinding[];
  /** Các mã QR của đối phương, nặng nhất trước. */
  qr?: QrFinding[];
  /** Câu người dùng đã hỏi hoặc nghi ngờ mà đối phương chỉ trấn an, chưa trả lời rõ. */
  open_questions?: string[];
  /** Nhận định ngữ cảnh của AI ở lượt gần nhất. */
  ai_insight?: AiInsight;
  ai_status: 'off' | 'ok' | 'error' | 'pending';
  ai_error?: string;
}

export const CATEGORY_LABEL: Record<SignalCategory, string> = {
  finance: 'Tài chính',
  account: 'Tài khoản & dữ liệu',
  identity: 'Danh tính doanh nghiệp',
  job_terms: 'Điều kiện việc làm',
  pressure: 'Thao túng / áp lực',
  isolation: 'Cô lập / di chuyển',
  contradiction: 'Mâu thuẫn',
  impersonation: 'Mạo danh',
  technical: 'Kỹ thuật / đường link',
  investment: 'Đầu tư',
};

export const STAGE_LABEL: Record<ScamStage, string> = {
  S0: 'Tiếp cận',
  S1: 'Xây dựng lòng tin',
  S2: 'Điều hướng kênh kín',
  S3: 'Kích hoạt bẫy',
  S4: 'Chốt chặn & cưỡng đoạt',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Nghiêm trọng',
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: 'Thấp',
  attention: 'Cần chú ý',
  high: 'Cao',
  critical: 'Nghiêm trọng',
};

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  low: 0,
  attention: 1,
  high: 2,
  critical: 3,
};
