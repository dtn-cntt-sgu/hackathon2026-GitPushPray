// Chế độ PHÁT LẠI TỪNG TIN: mô phỏng đúng cách sản phẩm chạy trong phiên thật.
//  - mỗi tin mới → chạy lại bộ luật trên toàn bản nháp (như background/runtime.ts recompute);
//  - nếu bật AI → hỏi chính sách decideAiRun của sản phẩm (trigger, giãn cách, lô N tin), gửi DELTA + tóm tắt,
//    gộp tín hiệu/đề nghị hạ mức như background/ai.ts (giả định AI trả lời xong trước tin kế tiếp);
//  - áp lớp chống dao động của sản phẩm (core/stability.ts) như background recompute — tắt bằng stability: false
//    để so sánh với mức "thô";
//  - ghi mức sau từng tin của đối phương để chấm theo mốc, đo độ trễ phát hiện, dao động, số lượt gọi AI.
import { buildAiRequest, decideAiRun, mergeAiSignals, parseAiResponse, type AiRequest } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import { stabilize, type StabilityState } from '@safechat/core/stability';
import type { AnalysisResult, ChatMessage, RiskLevel, Signal } from '@safechat/core/types';
import { RISK_LEVEL_ORDER } from '@safechat/core/types';
import { DEFAULT_SETTINGS } from '../../apps/extension/src/shared/protocol';
import { DailyCapReached } from '../providers/openrouter';
import type { BenchCase } from './dataset';

export interface ReplayOptions {
  /** Gọi AI: nhận yêu cầu (đã che PII), trả nội dung thô. Bỏ trống = chỉ bộ luật. */
  callAi?: (req: AiRequest) => Promise<string>;
  /** Khoảng cách giả lập giữa 2 tin (giây) — dùng cho giãn cách gọi AI. */
  gapSec?: number;
  minIntervalSec?: number;
  batchSize?: number;
  /** Hội thoại dừng lâu chừng này thì gọi nốt tin lẻ. Phát lại chỉ có khoảng dừng ở cuối ca. 0 = tắt. */
  idleFlushSec?: number;
  /** Áp lớp chống dao động như sản phẩm (mặc định true). false = mức thô sau analyze. */
  stability?: boolean;
}

export interface ReplayTurn {
  /** Thứ tự tin DP (bắt đầu từ 1). */
  dpTurn: number;
  /** Mức hiển thị (sau chống dao động nếu bật). */
  level: RiskLevel;
  /** Mức thô sau analyze. */
  rawLevel: RiskLevel;
  aiCalled: boolean;
  aiReason?: string;
}

export interface ReplayResult {
  turns: ReplayTurn[];
  finalLevel: RiskLevel;
  aiCalls: number;
  aiErrors: number;
}

export async function replayCase(c: BenchCase, o: ReplayOptions = {}): Promise<ReplayResult> {
  const gapMs = (o.gapSec ?? 20) * 1000;
  const minIntervalMs = (o.minIntervalSec ?? DEFAULT_SETTINGS.minIntervalSec) * 1000;
  const batchSize = o.batchSize ?? DEFAULT_SETTINGS.batchSize;
  const idleFlushMs = (o.idleFlushSec ?? DEFAULT_SETTINGS.idleFlushSec) * 1000;
  const ai = {
    summary: '',
    lastSeq: 0,
    lastAt: -Infinity,
    signals: [] as Signal[],
    downgrade: undefined as { reason: string; fromLevel: RiskLevel } | undefined,
  };
  const turns: ReplayTurn[] = [];
  let aiCalls = 0;
  let aiErrors = 0;
  let dp = 0;
  let stab: StabilityState | undefined;
  const useStability = o.stability !== false;
  /** Như background recompute: chỉ tính lần đánh giá mới khi có tin mới hoặc lượt AI mới. */
  const display = (raw: AnalysisResult, seq: number): RiskLevel => {
    if (!useStability) return raw.risk_level;
    const out = stabilize(stab, raw, `${seq}:${aiCalls}`);
    stab = out.state;
    return out.result.risk_level;
  };

  /** Hỏi chính sách gọi AI; nếu được gọi thì phân tích lại với kết quả AI. */
  const askAi = async (msgs: ChatMessage[], now: number, lastMessageAt: number) => {
    let result = analyze(msgs, { aiSignals: ai.signals, aiDowngrade: ai.downgrade });
    if (!o.callAi) return { result, aiCalled: false, aiReason: undefined };
    const ruleSignals = result.signals.filter((s) => s.source !== 'ai');
    const decision = decideAiRun({
      now,
      messages: msgs,
      lastAiSeq: ai.lastSeq,
      lastAiAt: ai.lastAt,
      currentLevel: result.risk_level,
      budgetLeft: Number.POSITIVE_INFINITY,
      minIntervalMs,
      batchSize,
      lastMessageAt,
      idleFlushMs,
    });
    if (!decision.run) return { result, aiCalled: false, aiReason: undefined };
    aiCalls++;
    const req = buildAiRequest(msgs, ai.lastSeq, ai.summary, ruleSignals);
    const levelAtRequest = result.level_before_ai;
    try {
      const parsed = parseAiResponse(await o.callAi(req), req, msgs, 'replay');
      ai.signals = mergeAiSignals(ai.signals, parsed.signals);
      if (parsed.summary) ai.summary = parsed.summary;
      ai.downgrade = parsed.downgradeReason ? { reason: parsed.downgradeReason, fromLevel: levelAtRequest } : undefined;
    } catch (e) {
      if (e instanceof DailyCapReached) throw e; // hết lượt trong ngày → dừng cả lần chạy, không tính là lỗi AI
      aiErrors++; // lỗi AI: giữ kết quả luật, không hạ mức (như sản phẩm)
    }
    ai.lastSeq = req.upToSeq;
    ai.lastAt = now;
    result = analyze(msgs, { aiSignals: ai.signals, aiDowngrade: ai.downgrade });
    return { result, aiCalled: true, aiReason: decision.reason as string | undefined };
  };

  for (let i = 0; i < c.messages.length; i++) {
    const msgs: ChatMessage[] = c.messages.slice(0, i + 1);
    const now = i * gapMs;
    const { result, aiCalled, aiReason } = await askAi(msgs, now, now);
    const shown = display(result, msgs.at(-1)!.seq);
    if (c.messages[i]!.sender === 'other') {
      dp++;
      turns.push({ dpTurn: dp, level: shown, rawLevel: result.risk_level, aiCalled, aiReason });
    } else if (turns.length) {
      // Tin của người dùng (vd. đã xác minh) / lượt AI sau đó → cập nhật mức của tin DP gần nhất
      const last = turns[turns.length - 1]!;
      turns[turns.length - 1] = { ...last, level: shown, rawLevel: result.risk_level, aiCalled: last.aiCalled || aiCalled, aiReason: aiReason ?? last.aiReason };
    }
  }

  // Hết tin: hội thoại dừng, gọi nốt tin lẻ chưa đủ lô như sản phẩm
  const last = turns.at(-1);
  if (last && idleFlushMs > 0) {
    const lastAt = (c.messages.length - 1) * gapMs;
    const end = await askAi(c.messages, lastAt + idleFlushMs, lastAt);
    if (end.aiCalled) {
      const shown = display(end.result, c.messages.at(-1)!.seq);
      turns[turns.length - 1] = { ...last, level: shown, rawLevel: end.result.risk_level, aiCalled: true, aiReason: end.aiReason };
    }
  }
  return { turns, finalLevel: turns.at(-1)?.level ?? 'low', aiCalls, aiErrors };
}

// ---------------------------------------------------------------- chỉ số theo diễn biến

const IDX = RISK_LEVEL_ORDER;
const isDanger = (l: RiskLevel) => IDX[l] >= IDX.high;

/** Mức đúng tại tin DP t theo mốc (hàm bậc thang: mức của mốc gần nhất ≤ t); trước mốc đầu = không xác định. */
export function goldAt(checkpoints: { dpTurn: number; level: RiskLevel }[], t: number): RiskLevel | undefined {
  let g: RiskLevel | undefined;
  for (const cp of checkpoints) if (cp.dpTurn <= t) g = cp.level;
  return g;
}

/** Mốc dùng để chấm: cột moc_muc nếu có; không thì 1 mốc ở tin DP cuối = muc_chot. */
export function effectiveCheckpoints(c: BenchCase): { dpTurn: number; level: RiskLevel }[] {
  if (c.checkpoints?.length) return c.checkpoints;
  const dpCount = c.messages.filter((m) => m.sender === 'other').length;
  return [{ dpTurn: dpCount, level: c.gold }];
}

/** Tin DP đầu tiên mà mức đúng ≥ Cao (từ mốc, hoặc tin_nguy_hiem của bộ đề v1). */
export function goldDangerTurn(c: BenchCase): number | undefined {
  const fromCp = c.checkpoints?.find((cp) => isDanger(cp.level))?.dpTurn;
  return fromCp ?? (isDanger(c.gold) ? c.dangerTurn : undefined);
}

export interface CaseReplayStats {
  checkpointsTotal: number;
  checkpointsCorrect: number;
  checkpointsUnder: number;
  checkpointsOver: number;
  /** Mốc có nhãn ≥ Cao mà hệ thống < Cao. */
  checkpointDangerMiss: number;
  checkpointDanger: number;
  /** Số tin DP chậm hơn nhãn khi lên ≥ Cao (âm = sớm hơn); undefined nếu không áp dụng. */
  detectionDelay?: number;
  /** Ca nguy hiểm mà hệ thống không bao giờ lên ≥ Cao. */
  neverDetected: boolean;
  /** Số tin DP hệ thống ≥ Cao trong khi nhãn (theo mốc) còn < Cao. */
  prematureAlarmTurns: number;
  /** Số lần đổi chiều (lên→xuống hoặc xuống→lên) trong chuỗi mức dự đoán. */
  directionChanges: number;
  /** Số lần hạ mức khi nhãn không hạ. */
  unwarrantedDrops: number;
  aiCalls: number;
}

export function caseReplayStats(c: BenchCase, r: ReplayResult): CaseReplayStats {
  const cps = effectiveCheckpoints(c);
  let correct = 0;
  let under = 0;
  let over = 0;
  let dangerMiss = 0;
  let danger = 0;
  for (const cp of cps) {
    const pred = r.turns.find((t) => t.dpTurn === cp.dpTurn)?.level ?? 'low';
    if (pred === cp.level) correct++;
    else if (IDX[pred] < IDX[cp.level]) under++;
    else over++;
    if (isDanger(cp.level)) {
      danger++;
      if (!isDanger(pred)) dangerMiss++;
    }
  }

  const gTurn = goldDangerTurn(c);
  const pTurn = r.turns.find((t) => isDanger(t.level))?.dpTurn;
  const detectionDelay = gTurn !== undefined && pTurn !== undefined ? pTurn - gTurn : undefined;

  let premature = 0;
  if (c.checkpoints?.length) {
    for (const t of r.turns) {
      const g = goldAt(c.checkpoints, t.dpTurn);
      if (g && !isDanger(g) && isDanger(t.level)) premature++;
    }
  }

  let changes = 0;
  let lastDir = 0;
  let drops = 0;
  for (let i = 1; i < r.turns.length; i++) {
    const d = Math.sign(IDX[r.turns[i]!.level] - IDX[r.turns[i - 1]!.level]);
    if (d === 0) continue;
    if (lastDir !== 0 && d !== lastDir) changes++;
    lastDir = d;
    if (d < 0) {
      const gPrev = c.checkpoints ? goldAt(c.checkpoints, r.turns[i - 1]!.dpTurn) : undefined;
      const gNow = c.checkpoints ? goldAt(c.checkpoints, r.turns[i]!.dpTurn) : undefined;
      if (!(gPrev && gNow && IDX[gNow] < IDX[gPrev])) drops++;
    }
  }

  return {
    checkpointsTotal: cps.length,
    checkpointsCorrect: correct,
    checkpointsUnder: under,
    checkpointsOver: over,
    checkpointDangerMiss: dangerMiss,
    checkpointDanger: danger,
    detectionDelay,
    neverDetected: gTurn !== undefined && pTurn === undefined,
    prematureAlarmTurns: premature,
    directionChanges: changes,
    unwarrantedDrops: drops,
    aiCalls: r.aiCalls,
  };
}

export interface ReplayMetrics {
  cases: number;
  checkpoints: number;
  checkpointAccuracy: number;
  checkpointUnderRate: number;
  checkpointOverRate: number;
  checkpointDangerMissRate: number;
  /** Trong các ca nguy hiểm có tin nguy hiểm xác định: tỷ lệ phát hiện đúng lúc hoặc sớm (độ trễ ≤ 0). */
  onTimeRate: number;
  lateRate: number;
  neverRate: number;
  medianDelay?: number;
  meanDelay?: number;
  /** Tỷ lệ ca có báo động ≥ Cao trước khi nhãn lên ≥ Cao (chỉ ca có mốc). */
  prematureCaseRate: number;
  /** Tỷ lệ ca có ít nhất 1 lần đổi chiều. */
  oscillationCaseRate: number;
  meanDirectionChanges: number;
  unwarrantedDropCaseRate: number;
  aiCallsPerCase: number;
  aiCallsPer10Turns: number;
}

export function computeReplayMetrics(stats: CaseReplayStats[], dpTurnsTotal: number, withCheckpoints: number): ReplayMetrics {
  const n = stats.length;
  const sum = (f: (s: CaseReplayStats) => number) => stats.reduce((a, s) => a + f(s), 0);
  const r = (a: number, b: number) => (b ? a / b : 0);
  const cps = sum((s) => s.checkpointsTotal);
  const dangerCps = sum((s) => s.checkpointDanger);
  const timed = stats.filter((s) => s.detectionDelay !== undefined || s.neverDetected);
  const delays = stats.map((s) => s.detectionDelay).filter((d): d is number => d !== undefined).sort((a, b) => a - b);
  return {
    cases: n,
    checkpoints: cps,
    checkpointAccuracy: r(sum((s) => s.checkpointsCorrect), cps),
    checkpointUnderRate: r(sum((s) => s.checkpointsUnder), cps),
    checkpointOverRate: r(sum((s) => s.checkpointsOver), cps),
    checkpointDangerMissRate: r(sum((s) => s.checkpointDangerMiss), dangerCps),
    onTimeRate: r(timed.filter((s) => s.detectionDelay !== undefined && s.detectionDelay <= 0).length, timed.length),
    lateRate: r(timed.filter((s) => s.detectionDelay !== undefined && s.detectionDelay > 0).length, timed.length),
    neverRate: r(timed.filter((s) => s.neverDetected).length, timed.length),
    medianDelay: delays.length ? delays[Math.floor(delays.length / 2)] : undefined,
    meanDelay: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : undefined,
    prematureCaseRate: r(stats.filter((s) => s.prematureAlarmTurns > 0).length, withCheckpoints),
    oscillationCaseRate: r(stats.filter((s) => s.directionChanges > 0).length, n),
    meanDirectionChanges: r(sum((s) => s.directionChanges), n),
    unwarrantedDropCaseRate: r(stats.filter((s) => s.unwarrantedDrops > 0).length, n),
    aiCallsPerCase: r(sum((s) => s.aiCalls), n),
    aiCallsPer10Turns: r(sum((s) => s.aiCalls) * 10, dpTurnsTotal),
  };
}
