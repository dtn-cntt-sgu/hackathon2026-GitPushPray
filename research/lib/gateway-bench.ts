// Đo đúng đường sản phẩm: prompt của gateway, lớp bảo vệ của gateway, rồi analyze như client.
// Khác hybrid-hint ở chỗ dùng prompt gateway và applyGuards. Không thấy risk_level của AI vì gateway không yêu cầu.
import type { AnalysisRequest } from '@safechat/contracts';
import type { AiParsed } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import type { ChatMessage, RiskLevel } from '@safechat/core/types';
import { RISK_LEVEL_ORDER } from '@safechat/core/types';
import type { GatewayConfig } from '../../services/gateway/src/lib/config';
import { applyGuards } from '../../services/gateway/src/lib/guards';
import { buildGatewayPrompt, type PromptResult } from '../../services/gateway/src/lib/prompt';

/** Cùng giá trị với mặc định trong services/gateway/src/lib/config.ts và infra/template.yaml. */
const BENCH_GATEWAY_CFG = {
  aiContextMessages: 8,
  aiMaxNewMessages: 50,
  aiMaxInputChars: 20000,
  aiMaxInputTokens: 7500,
  aiMaxSignals: 8,
  summaryMaxChars: 800,
} as GatewayConfig;

/** Gửi cả hội thoại như lượt đầu của phiên. Ném lỗi nếu vượt giới hạn đầu vào của gateway. */
export function gatewayBenchRequest(messages: ChatMessage[]): PromptResult {
  const rule = analyze(messages);
  const tier = RISK_LEVEL_ORDER[rule.risk_level] >= RISK_LEVEL_ORDER.attention ? 'large' : 'small';
  const req: AnalysisRequest = {
    client: 'web',
    clientVersion: 'bench',
    messages,
    lastAiSeq: 0,
    summary: '',
    ruleHints: rule.signals
      .filter((s) => s.source !== 'ai' && !s.mitigation)
      .map((s) => ({ type: s.type, title: s.title, evidenceMessageIds: s.evidence_message_ids })),
    currentLevel: rule.risk_level,
    stage: rule.stage,
    tier,
  };
  return buildGatewayPrompt(req, BENCH_GATEWAY_CFG, tier);
}

/** Mức cuối như client nhận được. calibrate=false để đo riêng tác dụng của calibrateSignals. */
export function gatewayLevel(messages: ChatMessage[], parsed: AiParsed | null, calibrate = true): RiskLevel {
  const rule = analyze(messages);
  if (!parsed) return rule.risk_level; // AI lỗi: giữ kết quả luật
  const guarded = applyGuards({
    parsed,
    currentLevel: rule.risk_level,
    clientStage: rule.stage,
    clientSummary: '',
    ruleHintTypes: rule.signals.filter((s) => s.source !== 'ai').map((s) => s.type),
    cfg: BENCH_GATEWAY_CFG,
    calibrate,
  });
  return analyze(messages, {
    aiSignals: guarded.signals,
    aiDowngrade: guarded.downgradeReason ? { reason: guarded.downgradeReason, fromLevel: rule.risk_level } : undefined,
    aiInsight: guarded.insight,
  }).risk_level;
}
