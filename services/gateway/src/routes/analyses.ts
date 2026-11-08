import { Hono } from 'hono';
import { mergeAiSignals, parseAiResponse, shouldEscalate, type AiParsed, type AiTier } from '@safechat/core/ai';
import type { AnalysisRequest, AnalysisResponse } from '@safechat/contracts';
import { bearerToken, verifyDeviceToken } from '../lib/auth';
import type { AppEnv } from '../lib/deps';
import { budgetExceeded, modelUnavailable, quotaExceeded, toApiError } from '../lib/errors';
import { applyGuards } from '../lib/guards';
import { dateKey } from '../lib/limits';
import { hashDevice } from '../lib/log';
import { buildGatewayPrompt, hasNewOtherMessages } from '../lib/prompt';
import { readJson } from '../lib/request';
import { maskPii, truncateChars } from '../lib/text';
import { validateAnalysisRequest } from '../lib/validate';

/** Gửi kèm trích dẫn tin người dùng để client tự xác nhận lại trạng thái nạn nhân, không tin hoàn toàn vào máy chủ. */
function insightForClient(i: import('@safechat/core/types').AiInsight, messages: { id: string; sender: string; text: string }[]) {
  const { victim_evidence_ok: _ok, atSeq: _at, ...rest } = i;
  const self = i.victim_evidence_ok ? [...messages].reverse().find((m) => m.sender === 'self') : undefined;
  return { ...rest, ...(self ? { victim_message_id: self.id, victim_quote: self.text.slice(0, 160) } : {}) };
}

export const analysesRoute = new Hono<AppEnv>();

function emptyResponse(req: AnalysisRequest): AnalysisResponse {
  return {
    signals: [],
    summary: truncateChars(maskPii(req.summary), 800),
    uncertainties: [],
    rejected: 0,
    usage: { model: 'none', tier: req.tier, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 },
  };
}

analysesRoute.post('/', async (c) => {
  const deps = c.get('deps');
  const cfg = deps.cfg;
  const body = await readJson(c);
  const req = validateAnalysisRequest(body, cfg);
  const claims = verifyDeviceToken(bearerToken(c.req.header('authorization')), req.client, cfg, deps.now());
  const deviceHash = hashDevice(claims.d, cfg.tokenSecret);

  c.set('logExtra', {
    ...c.get('logExtra'),
    client: req.client,
    deviceHash,
    tier: req.tier,
    provider: cfg.provider,
    promptVersion: cfg.promptVersion,
  });

  // Không có tin mới của đối phương: trả 200 rỗng, không gọi AI, không trừ quota.
  if (!hasNewOtherMessages(req)) {
    return c.json(emptyResponse(req), 200);
  }

  // Kill switch: không đụng rate/quota/ngân sách khi AI đang tắt.
  if (cfg.provider === 'none') throw modelUnavailable();

  const rate = await deps.limits.deviceRate(deviceHash, deps.now());
  if (!rate.allowed) throw quotaExceeded('Thiết bị gửi quá nhanh; thử lại sau.', rate.retryAfterSec);

  // Trần toàn cục theo phút để tránh Groq free tier trả 429 dây chuyền.
  const globalRate = await deps.limits.globalRate(deps.now());
  if (!globalRate.allowed) throw budgetExceeded('Hệ thống đang giới hạn tốc độ; thử lại sau.', globalRate.retryAfterSec);

  const daily = await deps.limits.deviceDaily(deviceHash, deps.now());
  if (!daily.allowed) throw quotaExceeded('Đã hết lượt phân tích AI hôm nay.', daily.retryAfterSec);

  const prompt = buildGatewayPrompt(req, cfg, req.tier);
  const reserved = await deps.limits.reserveGlobal(1, prompt.estimatedInputTokens, deps.now());
  if (!reserved.allowed) throw budgetExceeded('Ngân sách AI dùng chung đã hết.', reserved.retryAfterSec);

  let reservedTokens = prompt.estimatedInputTokens;
  let actualInputTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let model = req.tier === 'large' ? cfg.groqModelLarge : cfg.groqModelSmall;
  let tier: AiTier = req.tier;
  let escalation = false;
  const aiStarted = Date.now();

  try {
    let parsed: AiParsed;
    const first = await deps.ai.complete(prompt.request, req.tier);
    model = first.model;
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    actualInputTokens = first.inputTokens;
    try {
      parsed = parseAiResponse(first.content, prompt.request, req.messages, `Groq ${first.model}`);
    } catch (e) {
      throw modelUnavailable('Không đọc được kết quả AI', (e as Error).message);
    }

    // Cùng một model cho hai tầng thì leo tầng chỉ gọi lại đúng model đó: tốn gấp đôi token mà không thêm
    // thông tin, và lệch với cách đã đo trên tune (mỗi ca một lượt). Chỉ leo khi model lớn thật sự khác.
    const canEscalate = cfg.aiEscalation && cfg.groqModelLarge !== cfg.groqModelSmall;
    if (req.tier === 'small' && canEscalate && shouldEscalate(parsed.signals, 1)) {
      let largePrompt: ReturnType<typeof buildGatewayPrompt> | undefined;
      try {
        largePrompt = buildGatewayPrompt(req, cfg, 'large');
      } catch {
        parsed.uncertainties = [...parsed.uncertainties, 'Không dựng được prompt cho lượt phân tích sâu; giữ kết quả lượt nhanh.'];
      }
      const extra = largePrompt
        ? await deps.limits.reserveGlobal(1, largePrompt.estimatedInputTokens, deps.now())
        : { allowed: false };
      if (largePrompt && extra.allowed) {
        reservedTokens += largePrompt.estimatedInputTokens;
        try {
          const second = await deps.ai.complete(largePrompt.request, 'large');
          let parsedSecond: AiParsed;
          try {
            parsedSecond = parseAiResponse(second.content, largePrompt.request, req.messages, `Groq ${second.model}`);
          } catch (e) {
            throw modelUnavailable('Không đọc được kết quả AI', (e as Error).message);
          }
          parsed = {
            signals: mergeAiSignals(parsed.signals, parsedSecond.signals),
            summary: parsedSecond.summary || parsed.summary,
            uncertainties: parsedSecond.uncertainties,
            rejected: parsed.rejected + parsedSecond.rejected,
            downgradeReason: parsedSecond.downgradeReason,
            detectedStage: parsedSecond.detectedStage ?? parsed.detectedStage,
            nextStep: parsedSecond.nextStep ?? parsed.nextStep,
            insight: parsedSecond.insight ?? parsed.insight,
          };
          model = second.model;
          tier = 'large';
          escalation = true;
          inputTokens += second.inputTokens;
          outputTokens += second.outputTokens;
          actualInputTokens += second.inputTokens;
        } catch {
          // Leo tầng thất bại sau khi tầng nhỏ thành công: giữ kết quả nhỏ + uncertainty.
          parsed.uncertainties = [...parsed.uncertainties, 'Không leo được model lớn; giữ kết quả model nhỏ.'];
        }
      } else if (largePrompt) {
        parsed.uncertainties = [...parsed.uncertainties, 'Hết ngân sách cho lượt phân tích sâu; giữ kết quả lượt nhanh.'];
      }
    }

    const guarded = applyGuards({
      parsed,
      currentLevel: req.currentLevel,
      clientStage: req.stage,
      clientSummary: req.summary,
      ruleHintTypes: req.ruleHints.map((h) => h.type),
      cfg,
    });

    const latencyMs = Date.now() - aiStarted;
    const costUsd =
      (inputTokens / 1000) * cfg.costPer1kInputUsd + (outputTokens / 1000) * cfg.costPer1kOutputUsd;
    const response: AnalysisResponse = {
      signals: guarded.signals,
      summary: guarded.summary,
      uncertainties: guarded.uncertainties,
      rejected: guarded.rejected,
      ...(guarded.downgradeReason ? { downgradeReason: guarded.downgradeReason } : {}),
      ...(guarded.detectedStage ? { detectedStage: guarded.detectedStage } : {}),
      ...(guarded.nextStep ? { nextStep: guarded.nextStep } : {}),
      ...(guarded.insight ? { insight: insightForClient(guarded.insight, req.messages) } : {}),
      usage: { model, tier, inputTokens, outputTokens, costUsd: Math.round(costUsd * 1e6) / 1e6, latencyMs },
    };

    await deps.metrics
      .recordCall({
        date: dateKey(deps.now()),
        model,
        tier,
        inputTokens,
        outputTokens,
        rejected: guarded.rejected,
        latencyMs,
        error: false,
        now: deps.now(),
      })
      .catch(() => undefined);

    c.set('logExtra', {
      ...c.get('logExtra'),
      model,
      tier,
      inputTokens,
      outputTokens,
      rejected: guarded.rejected,
      signals: guarded.signals.length,
      stage: guarded.detectedStage,
      downgrade: Boolean(guarded.downgradeReason),
      escalation,
      ...(guarded.promptLeakSuspected ? { reason: 'prompt_leak_suspected' } : {}),
    });
    return c.json(response, 200);
  } catch (e) {
    const err = toApiError(e);
    await deps.metrics
      .recordCall({
        date: dateKey(deps.now()),
        model,
        tier,
        inputTokens: 0,
        outputTokens: 0,
        rejected: 0,
        latencyMs: Date.now() - aiStarted,
        error: true,
        now: deps.now(),
      })
      .catch(() => undefined);
    c.set('logExtra', { ...c.get('logExtra'), model, errorCode: err.code });
    throw err;
  } finally {
    const actual = actualInputTokens || reservedTokens;
    await deps.limits.adjustGlobalTokens(actual - reservedTokens, deps.now()).catch(() => undefined);
  }
});
