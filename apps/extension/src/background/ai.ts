// Điều phối AI phân tầng:
//   quy tắc (luôn chạy, miễn phí)
//   → Gemini Nano trên máy (nếu bật và side panel báo sẵn sàng; không tốn hạn mức, dữ liệu không rời máy)
//   → Gateway SafeChat trên AWS (không cần khóa model trong extension).
// Chỉ gửi DELTA (tin mới + vài tin ngữ cảnh + tóm tắt cuộn), giới hạn số lượt/ngày.
import type { AnalysisRequest, AnalysisResponse } from '@safechat/contracts';
import {
  buildAiRequest,
  decideAiRun,
  maskPii,
  mergeAiSignals,
  parseAiResponse,
  sanitizeInsight,
  sanitizeNextStep,
  type AiParsed,
  type AiRequest,
  type AiTier,
} from '@safechat/core/ai';
import { validateEvidence } from '@safechat/core/evidence';
import type { ChatMessage, RiskLevel, Signal } from '@safechat/core/types';
import { gatewayOriginPattern, GatewayError, callGateway } from './gateway';
import { USAGE_KEY, type AiProvider, type Session, type Settings } from '../shared/protocol';
import { recompute, serial, updateBadge } from './runtime';
import { loadSession, loadSettings, saveSession } from './store';

const NANO_TIMEOUT_MS = 60_000;
const PANEL_FRESH_MS = 45_000;
// Service worker có thể bị tắt khi rảnh nên setTimeout dài không đáng tin; alarm sẽ đánh thức lại.
export const AI_IDLE_ALARM = 'safechat_ai_idle';
const MAX_GATEWAY_FAILURES = 3;

let panelNano = { ready: false, at: 0 };
let nanoFailedUntil = 0;
let gatewayBackoffUntil = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function setPanelNanoStatus(ready: boolean) {
  panelNano = { ready, at: Date.now() };
  if (ready) kickAi(500);
}

export function kickAi(delayMs = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => void step(), delayMs);
}

/** Người dùng vừa đổi cài đặt AI: bỏ thời gian nghỉ của lỗi cũ để thử lại ngay. */
export function resetGatewayBackoff() {
  gatewayBackoffUntil = 0;
}

export function cancelAi() {
  clearTimeout(timer);
  timer = undefined;
  void chrome.alarms.clear(AI_IDLE_ALARM);
}

// ---------- hạn mức theo ngày ----------
const today = () => new Date().toISOString().slice(0, 10);

async function usedToday(): Promise<number> {
  const r = (await chrome.storage.local.get(USAGE_KEY))[USAGE_KEY] as { date: string; count: number } | undefined;
  return r && r.date === today() ? r.count : 0;
}

async function addUsage(n: number) {
  await chrome.storage.local.set({ [USAGE_KEY]: { date: today(), count: (await usedToday()) + n } });
}

async function chooseProvider(settings: Settings): Promise<AiProvider | null> {
  const now = Date.now();
  if (settings.nanoEnabled && panelNano.ready && now - panelNano.at < PANEL_FRESH_MS && now > nanoFailedUntil) return 'nano';
  if (settings.gatewayEnabled && settings.gatewayUrl && now > gatewayBackoffUntil) {
    const granted = await chrome.permissions.contains({ origins: [gatewayOriginPattern(settings.gatewayUrl)] });
    if (granted) return 'gateway';
  }
  return null;
}

function anyAiConfigured(settings: Settings) {
  return settings.nanoEnabled || (settings.gatewayEnabled && !!settings.gatewayUrl);
}

// ---------- một bước điều phối ----------
async function step() {
  if (running) return;
  const settings = await loadSettings();
  const s = await loadSession();
  if (!s || s.status !== 'tracking' || !s.result) return;

  if (!anyAiConfigured(settings)) {
    if (s.ai.status !== 'off') await serial(async () => setStatus('off'));
    return;
  }

  if (s.ai.pending) {
    if (Date.now() - s.ai.pending.createdAt < NANO_TIMEOUT_MS) return; // side panel đang xử lý
    nanoFailedUntil = Date.now() + 5 * 60_000;
    await serial(async () => {
      const cur = await loadSession();
      if (cur) {
        cur.ai.pending = undefined;
        await saveSession(cur);
      }
    });
  }

  const provider = await chooseProvider(settings);
  if (!provider) {
    if (s.ai.status === 'off') await serial(async () => setStatus('idle'));
    return;
  }

  if (provider === 'gateway' && s.ai.gaveUpAtSeq === s.transcript.messages.at(-1)?.seq) return;

  const budget = provider === 'gateway' ? settings.dailyBudget - (await usedToday()) : Number.POSITIVE_INFINITY;
  const ruleSignals = s.result.signals.filter((x) => x.source !== 'ai');
  const ruleTypes = ruleSignals.map((x) => x.type);
  const decision = decideAiRun({
    now: Date.now(),
    messages: s.transcript.messages,
    lastAiSeq: s.ai.lastSeq,
    lastAiAt: s.ai.lastAt,
    currentLevel: s.result.risk_level,
    budgetLeft: budget,
    minIntervalMs: settings.minIntervalSec * 1000,
    batchSize: settings.batchSize,
    lastMessageAt: s.lastMessageAt ?? s.startedAt,
    idleFlushMs: settings.idleFlushSec * 1000,
    urgent: isUrgent(s),
  });

  if (!decision.run) {
    if (decision.reason === 'throttle') kickAi(decision.retryInMs ?? 2000);
    if (decision.reason === 'waiting_batch' && decision.retryInMs !== undefined)
      await chrome.alarms.create(AI_IDLE_ALARM, { when: Date.now() + decision.retryInMs });
    if (decision.reason === 'budget')
      await serial(async () => setStatus('error', `Đã dùng hết ${settings.dailyBudget} lượt AI hôm nay; vẫn phân tích bằng quy tắc.`));
    if (s.ai.status === 'off') await serial(async () => setStatus('idle'));
    return;
  }

  const request = buildAiRequest(s.transcript.messages, s.ai.lastSeq, s.ai.summary, ruleSignals);
  const meta = { startedAt: s.startedAt, level: s.result.level_before_ai, ruleTypes, reason: decision.reason };

  if (provider === 'nano') {
    await serial(async () => {
      const cur = await loadSession();
      if (!cur || cur.startedAt !== meta.startedAt) return;
      cur.ai.pending = { id: crypto.randomUUID(), tier: decision.tier, request, createdAt: Date.now() };
      cur.ai.status = 'running';
      cur.ai.lastReason = decision.reason;
      await saveSession(cur);
    });
    return; // side panel nhận yêu cầu qua storage.onChanged và trả lời bằng ai_result
  }

  running = true;
  await serial(async () => setStatus('running'));
  try {
    const body: AnalysisRequest = {
      client: 'extension',
      clientVersion: clientVersion(),
      messages: request.sent,
      lastAiSeq: s.ai.lastSeq,
      summary: maskPii(s.ai.summary),
      ruleHints: ruleSignals.map((x) => ({ type: x.type, title: x.title, evidenceMessageIds: x.evidence_message_ids })),
      currentLevel: s.result.risk_level,
      stage: s.result.stage,
      tier: decision.tier,
    };
    const res = await callGateway(settings.gatewayUrl, body);
    await addUsage(1);
    const parsed = parsedFromGateway(res, request, s.transcript.messages);
    await applyResult(meta, request, parsed.result, 'gateway', parsed.tier, res.usage?.model);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Mọi lỗi gateway đều tạm nghỉ một lúc; alarm đánh thức lại vì service worker có thể đã tắt.
    if (e instanceof GatewayError) {
      gatewayBackoffUntil = Date.now() + gatewayBackoffMs(e);
      await chrome.alarms.create(AI_IDLE_ALARM, { when: gatewayBackoffUntil + 1000 });
    }
    await serial(async () => {
      const cur = await loadSession();
      if (!cur || cur.startedAt !== meta.startedAt) return;
      cur.ai.status = 'error';
      cur.ai.error = msg;
      cur.ai.lastAt = Date.now();
      cur.ai.failures = (cur.ai.failures ?? 0) + 1;
      if (cur.ai.failures >= MAX_GATEWAY_FAILURES) {
        cur.ai.gaveUpAtSeq = cur.transcript.messages.at(-1)?.seq;
        cur.ai.error = `${msg}. Đã tạm dừng AI sau ${cur.ai.failures} lần lỗi liên tiếp, vẫn phân tích bằng quy tắc. Sẽ thử lại khi có tin mới hoặc khi đổi cài đặt AI.`;
      }
      recompute(cur); // giữ nguyên kết quả quy tắc, KHÔNG hạ mức
      await saveSession(cur);
    });
  } finally {
    running = false;
  }
  kickAi(1000); // có thể đã có tin mới trong lúc chờ
}

/** Nạn nhân sắp hoặc đã làm theo, hoặc luật vừa thấy dấu hiệu Nghiêm trọng mà AI chưa đọc. */
function isUrgent(s: Session): boolean {
  const lastSeq = s.transcript.messages.at(-1)?.seq ?? 0;
  if (lastSeq <= s.ai.lastSeq) return false;
  return (s.result?.signals ?? []).some((x) => x.source !== 'ai' && (/^user_(intends|complied)_/.test(x.type) || x.severity === 'critical'));
}

/** Thời gian nghỉ (ms) sau lỗi gateway: ưu tiên retryAfterSec do máy chủ báo. */
function gatewayBackoffMs(e: GatewayError): number {
  if (e.retryAfterSec && e.retryAfterSec > 0) return e.retryAfterSec * 1000;
  switch (e.code) {
    case 'QUOTA_EXCEEDED':
    case 'BUDGET_EXCEEDED':
      return 10 * 60_000;
    case 'UNAUTHORIZED':
    case 'BAD_REQUEST':
      return 5 * 60_000;
    default:
      return e.status === 429 ? 60_000 : 30_000;
  }
}

function clientVersion(): string {
  try {
    return chrome.runtime.getManifest().version || '0.5.0';
  } catch {
    return '0.5.0';
  }
}

/** Đổi phản hồi gateway sang dạng core dùng, vẫn kiểm tra trích dẫn lần cuối ở client. */
/** Kiểm tra lại câu hỏi ở client, không tin hoàn toàn vào máy chủ. Trích dẫn của phần đánh giá đã được gateway kiểm tra. */
function checkedNextStep(res: AnalysisResponse, request: AiRequest) {
  if (!res.nextStep) return undefined;
  const { question, reason, assessment } = res.nextStep;
  const checked = sanitizeNextStep({ question, reason, answer_assessment: 'none' }, request.sent);
  return checked && { ...checked, assessment };
}

function parsedFromGateway(
  res: AnalysisResponse,
  request: AiRequest,
  original: ChatMessage[],
): { result: AiParsed; tier: AiTier } {
  if (!res || !Array.isArray(res.signals)) throw new GatewayError('Máy chủ trả kết quả không hợp lệ.', 500, 'INTERNAL');
  const raw: Signal[] = res.signals.map((s) => ({ ...s, source: 'ai' }));
  const { valid, rejected } = validateEvidence(raw, request.sent);
  const byId = new Map(original.map((m) => [m.id, m]));
  const signals = valid.map((s) => ({
    ...s,
    evidence_quotes: s.evidence_message_ids.map(
      (id, i) => byId.get(id)?.text.slice(0, 220) ?? s.evidence_quotes[i] ?? '',
    ),
  }));
  return {
    tier: res.usage?.tier === 'large' ? 'large' : 'small',
    result: {
      signals,
      summary: maskPii(String(res.summary ?? '')).slice(0, 800),
      uncertainties: (Array.isArray(res.uncertainties) ? res.uncertainties : []).map(String).slice(0, 5),
      rejected: (Number.isFinite(res.rejected) ? res.rejected : 0) + rejected.length,
      downgradeReason: res.downgradeReason ? maskPii(String(res.downgradeReason)).slice(0, 200) : undefined,
      detectedStage: res.detectedStage,
      nextStep: checkedNextStep(res, request),
      // Kiểm tra lại ở client: trích dẫn tin người dùng phải khớp đúng bản đã gửi.
      insight: res.insight ? sanitizeInsight(res.insight, request.sent) : undefined,
    },
  };
}

async function applyResult(
  meta: { startedAt: number; level: RiskLevel; ruleTypes: string[]; reason: string },
  request: AiRequest,
  parsed: AiParsed,
  provider: AiProvider,
  tier: AiTier,
  model?: string,
) {
  await serial(async () => {
    const cur = await loadSession();
    if (!cur || cur.startedAt !== meta.startedAt) return; // phiên đã bị xóa/đổi
    cur.ai.signals = mergeAiSignals(cur.ai.signals, parsed.signals);
    if (parsed.summary) cur.ai.summary = parsed.summary;
    cur.ai.uncertainties = parsed.uncertainties;
    cur.ai.downgrade = parsed.downgradeReason ? { reason: parsed.downgradeReason, fromLevel: meta.level } : undefined;
    cur.ai.detectedStage = parsed.detectedStage;
    cur.ai.nextStep = parsed.nextStep ? { ...parsed.nextStep, atSeq: request.upToSeq } : undefined;
    cur.ai.insight = parsed.insight ? { ...parsed.insight, atSeq: request.upToSeq } : undefined;
    cur.ai.lastSeq = request.upToSeq;
    cur.ai.lastAt = Date.now();
    cur.ai.failures = undefined;
    cur.ai.gaveUpAtSeq = undefined;
    cur.ai.lastLevel = meta.level;
    cur.ai.lastRuleTypes = meta.ruleTypes;
    cur.ai.calls++;
    cur.ai.status = 'ok';
    cur.ai.error = parsed.rejected ? `Đã loại ${parsed.rejected} tín hiệu AI có trích dẫn không khớp tin gốc` : undefined;
    cur.ai.lastProvider = provider;
    cur.ai.lastTier = tier;
    cur.ai.lastModel = model;
    cur.ai.lastReason = meta.reason;
    cur.ai.pending = undefined;
    recompute(cur);
    await saveSession(cur);
    await updateBadge(cur);
  });
}

async function setStatus(status: Session['ai']['status'], error?: string) {
  const cur = await loadSession();
  if (!cur || (cur.ai.status === status && cur.ai.error === error)) return;
  cur.ai.status = status;
  cur.ai.error = error;
  recompute(cur);
  await saveSession(cur);
}

/** Side panel trả kết quả chạy Gemini Nano. */
export async function handleNanoResult(id: string, ok: boolean, payload: string) {
  const s = await loadSession();
  const pending = s?.ai.pending;
  if (!s || !pending || pending.id !== id) return;
  if (!ok) {
    nanoFailedUntil = Date.now() + 5 * 60_000;
    await serial(async () => {
      const cur = await loadSession();
      if (!cur) return;
      cur.ai.pending = undefined;
      cur.ai.status = 'error';
      cur.ai.error = `AI trên máy lỗi: ${payload}. Chuyển sang dự phòng nếu có.`;
      recompute(cur);
      await saveSession(cur);
    });
    kickAi(500);
    return;
  }
  try {
    const parsed = parseAiResponse(payload, pending.request, s.transcript.messages, 'Gemini Nano trên máy');
    await applyResult(
      {
        startedAt: s.startedAt,
        level: s.result?.level_before_ai ?? 'low',
        ruleTypes: s.result?.signals.filter((x) => x.source !== 'ai').map((x) => x.type) ?? [],
        reason: s.ai.lastReason ?? '',
      },
      pending.request,
      parsed,
      'nano',
      pending.tier,
    );
  } catch (e) {
    await handleNanoResult(id, false, (e as Error).message);
    return;
  }
  kickAi(1000);
}