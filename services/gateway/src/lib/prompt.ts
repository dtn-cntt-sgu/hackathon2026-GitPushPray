import { buildAiRequest, type AiRequest, type AiTier } from '@safechat/core/ai';
import type { AnalysisRequest } from '@safechat/contracts';
import type { ChatMessage } from '@safechat/core/types';
import type { GatewayConfig } from './config';
import { badRequest } from './errors';
import { cleanForModel, estimateTokens, maskPii, truncateChars } from './text';

const SMALL_ADDENDUM = `LƯỢT NHANH. Teencode: k/ko/khum/hok = không; mk/mik = mình; bn = bạn; ib = nhắn tin; ck/stk = chuyển khoản/số tài khoản; tr = triệu; k = nghìn; cmnd/cccd = giấy tờ; tele/zalo = kênh liên lạc.`;

const LARGE_ADDENDUM = `LƯỢT SÂU.
Dễ nhầm, không nâng mức nếu không có lời nhắm trực tiếp kèm tiền/OTP/giấy tờ/bí mật: HR thật yêu cầu CCCD, khám sức khỏe tại văn phòng; ngân hàng/nhà mạng KYC không hỏi OTP; công an mời đến trụ sở, không đòi tiền; chủ nhà đòi cọc; nhắc nợ thông thường; cha mẹ mắng con, bạn bè trêu nhau; trích dẫn phim, châm biếm.
Ngôn ngữ: tiếng Việt không dấu, tiếng địa phương, viết cách chữ (l.ư.ơ.n.g), leetspeak (0TP): hiểu theo ngữ cảnh, nhập nhằng thì ghi uncertainties. [Ảnh], [Sticker], emoji không phải bằng chứng.
Bí mật + tiền + giấy tờ + kênh kín cùng lúc là dấu hiệu mạnh. Xác minh độc lập qua số tra cứu chính thức, địa chỉ, hợp đồng làm giảm mức.`;

export function systemForTier(tier: AiTier): string {
  return tier === 'large' ? LARGE_ADDENDUM : SMALL_ADDENDUM;
}

export interface PromptResult {
  request: AiRequest;
  tier: AiTier;
  inputChars: number;
  estimatedInputTokens: number;
}

export function hasNewOtherMessages(req: AnalysisRequest): boolean {
  return req.messages.some((m) => m.seq > req.lastAiSeq && m.sender !== 'self');
}

export function buildGatewayPrompt(req: AnalysisRequest, cfg: GatewayConfig, tier: AiTier): PromptResult {
  const cleaned: ChatMessage[] = req.messages.map((m) => ({
    ...m,
    text: maskPii(cleanForModel(m.text)),
  }));
  const summary = truncateChars(maskPii(cleanForModel(req.summary)), cfg.summaryMaxChars);
  const ruleSignals = req.ruleHints.map((h) => ({ type: h.type, title: maskPii(h.title) }));
  const core = buildAiRequest(cleaned, req.lastAiSeq, summary, ruleSignals, {
    contextMessages: cfg.aiContextMessages,
    maxNewMessages: cfg.aiMaxNewMessages,
    state: { level: req.currentLevel, stage: req.stage },
  });

  const system = `${core.system}\n\n${systemForTier(tier)}`;
  const inputChars =
    core.sent.reduce((n, m) => n + m.text.length, 0) +
    summary.length +
    JSON.stringify(ruleSignals).length +
    system.length;
  const estimatedInputTokens = estimateTokens(inputChars);
  if (inputChars > cfg.aiMaxInputChars) {
    throw badRequest('Tổng văn bản gửi AI vượt giới hạn; hãy giảm batch');
  }
  if (estimatedInputTokens > cfg.aiMaxInputTokens) {
    throw badRequest('Ước lượng token gửi AI vượt giới hạn; hãy giảm batch');
  }

  return {
    request: { ...core, system },
    tier,
    inputChars,
    estimatedInputTokens,
  };
}
