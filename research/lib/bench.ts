// Ba (bốn) cấu hình so sánh trên cùng một hội thoại:
//  - rules       : chỉ bộ luật (analyze)
//  - ai          : chỉ AI, KHÔNG thấy tín hiệu luật, tự chấm risk_level
//  - hybrid      : luật + tín hiệu AI (từ chính phản hồi của "ai", không gọi thêm) — AI chỉ được BỔ SUNG, không hạ mức
//  - hybrid-veto : như hybrid nhưng AI được hạ ≤ 1 bậc khi tự chấm thấp hơn luật (đo đánh đổi: bớt báo nhầm vs. bỏ sót)
//  - hybrid-hint : AI nhận kèm tín hiệu luật, đề nghị hạ qua level_adjustment (tốn thêm 1 lượt gọi)
//  - gateway     : đúng đường sản phẩm: prompt và lớp bảo vệ của gateway (xem gateway-bench.ts)
//  - gateway-nocal: như gateway nhưng tắt calibrateSignals, dùng lại phản hồi của gateway
import { AI_SYSTEM_PROMPT, buildAiRequest, parseAiResponse, type AiParsed, type AiRequest } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import type { ChatMessage, RiskLevel } from '@safechat/core/types';
import { RISK_LEVEL_ORDER } from '@safechat/core/types';

export type BenchConfig = 'rules' | 'ai' | 'hybrid' | 'hybrid-veto' | 'hybrid-hint' | 'gateway' | 'gateway-nocal' | 'replay-rules' | 'replay-rules-raw' | 'replay-hybrid';
export const PROMPT_VERSION = 'bench-v7';

const LEVEL_INSTRUCTION = `
Ngoài ra, trả thêm trường "risk_level" — đánh giá TỔNG THỂ của bạn về cuộc trò chuyện tới tin cuối:
- "low": không có yêu cầu rủi ro cụ thể;
- "attention": hứa hẹn mơ hồ/bất thường, thiếu thông tin, rủ sang kênh kín, link lạ — chưa đòi tiền/dữ liệu;
- "high": yêu cầu cụ thể có hại: chuyển tiền/đặt cọc/nạp, OTP/mật khẩu, ảnh giấy tờ, đầu tư cam kết lãi, mượn tiền gấp vào tài khoản lạ;
- "critical": đe dọa/cưỡng ép, cô lập/giữ bí mật với gia đình, giữ giấy tờ gốc, đi xa gấp, cài app/bật trợ năng, "kẹt lệnh" ép nạp thêm, mạo danh cơ quan đòi tiền, thu hồi tiền đòi phí.
Giao dịch đời thường rõ ràng (chia tiền ăn, mua hàng có COD, HR hẹn phỏng vấn tại văn phòng) là "low".`;

export const BENCH_SYSTEM_PROMPT = AI_SYSTEM_PROMPT.replace(
  'Trả về DUY NHẤT JSON đúng schema:',
  `${LEVEL_INSTRUCTION.trim()}\nTrả về DUY NHẤT JSON đúng schema (thêm "risk_level": "low"|"attention"|"high"|"critical"):`,
);

export function benchRequest(messages: ChatMessage[], withRuleHints: boolean): AiRequest {
  const hints = withRuleHints ? analyze(messages).signals.filter((s) => s.source !== 'ai' && !s.mitigation) : [];
  const req = buildAiRequest(messages, 0, '', hints);
  return { ...req, system: BENCH_SYSTEM_PROMPT };
}

export interface AiOutcome {
  level: RiskLevel | null;
  parsed: AiParsed | null;
  jsonValid: boolean;
  error?: string;
}

const LEVELS = new Set(['low', 'attention', 'high', 'critical']);

export function readAiOutcome(content: string, req: AiRequest, messages: ChatMessage[], model: string): AiOutcome {
  let parsed: AiParsed;
  try {
    parsed = parseAiResponse(content, req, messages, model);
  } catch (e) {
    return { level: null, parsed: null, jsonValid: false, error: (e as Error).message };
  }
  let level: RiskLevel | null = null;
  try {
    const m = /\{[\s\S]*\}/.exec(content);
    const raw = JSON.parse(m ? m[0] : content) as { risk_level?: unknown };
    const l = String(raw.risk_level ?? '').toLowerCase();
    if (LEVELS.has(l)) level = l as RiskLevel;
  } catch {
    /* đã parse được ở trên nên hiếm khi vào đây */
  }
  return { level, parsed, jsonValid: true, error: level ? undefined : 'Thiếu/không hợp lệ risk_level' };
}

/** Kết hợp luật + AI (không gợi ý luật cho AI); AI chỉ bổ sung tín hiệu. */
export function hybridLevel(messages: ChatMessage[], ai: AiOutcome): RiskLevel {
  if (!ai.parsed) return analyze(messages).risk_level;
  return analyze(messages, { aiSignals: ai.parsed.signals }).risk_level;
}

/** Như hybridLevel nhưng AI được "phủ quyết" hạ 1 bậc khi tự chấm thấp hơn luật. */
export function hybridVetoLevel(messages: ChatMessage[], ai: AiOutcome): RiskLevel {
  const base = analyze(messages);
  if (!ai.parsed) return base.risk_level;
  const ruleLevel = analyze(messages, { aiSignals: ai.parsed.signals }).level_before_ai;
  const downgrade =
    ai.level && RISK_LEVEL_ORDER[ai.level] < RISK_LEVEL_ORDER[ruleLevel]
      ? { reason: `AI tự đánh giá mức ${ai.level}`, fromLevel: ruleLevel }
      : undefined;
  return analyze(messages, { aiSignals: ai.parsed.signals, aiDowngrade: downgrade }).risk_level;
}

/** Như sản phẩm: AI đã thấy tín hiệu luật, đề nghị hạ qua level_adjustment. */
export function hybridHintLevel(messages: ChatMessage[], ai: AiOutcome): RiskLevel {
  if (!ai.parsed) return analyze(messages).risk_level;
  const ruleLevel = analyze(messages, { aiSignals: ai.parsed.signals }).level_before_ai;
  const downgrade = ai.parsed.downgradeReason ? { reason: ai.parsed.downgradeReason, fromLevel: ruleLevel } : undefined;
  return analyze(messages, { aiSignals: ai.parsed.signals, aiDowngrade: downgrade }).risk_level;
}
