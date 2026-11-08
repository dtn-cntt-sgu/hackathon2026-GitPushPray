// Đo độ chính xác mức cảnh báo của đường gateway thật (prompt + Groq + guards + analyze)
// trên một bộ ca cố định trong fixtures/scenarios.json.
// Chạy: npx tsx scripts/groq-accuracy.ts --label baseline --ids 19,20,41,46,47,50,63,72,03,04,07,11,30,56
// Kết quả ghi vào research/results/groq-${label}.json (đã gitignore).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '@safechat/core/analyzer';
import { parseAiResponse } from '@safechat/core/ai';
import type { AnalysisRequest } from '@safechat/contracts';
import { RISK_LEVEL_ORDER, type ChatMessage, type RiskLevel } from '@safechat/core/types';
import { loadConfig } from '../services/gateway/src/lib/config';
import { applyGuards } from '../services/gateway/src/lib/guards';
import { buildGatewayPrompt } from '../services/gateway/src/lib/prompt';
import { callGroq } from '../services/gateway/src/lib/providers/groq';
import { ProviderError } from '../services/gateway/src/lib/errors';

const ROOT = resolve(import.meta.dirname, '..');
process.loadEnvFile(resolve(ROOT, 'services/gateway/.env'));
// Chỉ phục vụ benchmark cục bộ: .env không chứa TOKEN_SECRET và có thể đang tắt AI.
process.env.AI_PROVIDER = 'groq';
process.env.TOKEN_SECRET ||= randomBytes(32).toString('hex');

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

interface RawScenario {
  id: string;
  title: string;
  messages: { sender: 'self' | 'other' | 'unknown'; text: string }[];
  expected: { level: RiskLevel; signals: string[]; forbidden?: string[] };
}

const scenarios = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/scenarios.json'), 'utf8')) as RawScenario[];
const ids = arg('ids', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const label = arg('label', 'run');
const intervalMs = Number(arg('interval-ms', '2500'));
const repeats = Math.max(1, Number(arg('repeat', '1')));
const only = ids.length ? scenarios.filter((s) => ids.some((id) => s.id === id || s.id.startsWith(`${id}_`))) : scenarios;

function toMessages(s: RawScenario): ChatMessage[] {
  return s.messages.map((m, i) => ({
    id: `msg-${String(i + 1).padStart(3, '0')}`,
    seq: i + 1,
    sender: m.sender,
    text: m.text,
  }));
}

function buildRequest(s: RawScenario, rule: ReturnType<typeof analyze>): AnalysisRequest {
  const hints = rule.signals
    .filter((x) => x.source !== 'ai' && !x.mitigation)
    .map((x) => ({ type: x.type, title: x.title, evidenceMessageIds: x.evidence_message_ids }));
  const tier = RISK_LEVEL_ORDER[rule.risk_level] >= RISK_LEVEL_ORDER.attention ? 'large' : 'small';
  return {
    client: 'web',
    clientVersion: 'bench',
    messages: toMessages(s),
    lastAiSeq: 0,
    summary: '',
    ruleHints: hints,
    currentLevel: rule.risk_level,
    stage: rule.stage,
    tier,
  };
}

const cfg = await loadConfig();
if (cfg.provider !== 'groq' || !cfg.groqApiKey) throw new Error('Cần AI_PROVIDER=groq và GROQ_API_KEY trong services/gateway/.env');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function completeWithRetry(req: ReturnType<typeof buildGatewayPrompt>, tier: 'small' | 'large') {
  const model = tier === 'large' ? cfg.groqModelLarge : cfg.groqModelSmall;
  for (let attempt = 0; ; attempt++) {
    try {
      return await callGroq(req.request, {
        apiKey: cfg.groqApiKey!,
        model,
        timeoutMs: tier === 'large' ? cfg.aiTimeoutLargeMs : cfg.aiTimeoutSmallMs,
        maxOutputTokens: tier === 'large' ? cfg.aiMaxOutputTokensLarge : cfg.aiMaxOutputTokensSmall,
      });
    } catch (e) {
      const err = e as ProviderError;
      if (err.code === 'QUOTA_EXCEEDED' && attempt < 4) {
        const wait = Math.min(60_000, ((err.retryAfterSec ?? 20) + 2) * 1000);
        console.log(`  … 429, chờ ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

interface Row {
  id: string;
  title: string;
  gold: RiskLevel;
  rule: RiskLevel;
  pred: RiskLevel;
  ok: boolean;
  benignFalseAlarm: boolean;
  dangerMissed: boolean;
  ruleSignals: string[];
  aiSignals: { type: string; severity: string; confidence?: number }[];
  rejected: number;
  latencyMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

const rows: Row[] = [];
for (const s of only) {
  const messages = toMessages(s);
  const rule = analyze(messages);
  const request = buildRequest(s, rule);
  for (let rep = 0; rep < repeats; rep++) {
    const started = Date.now();
    try {
      const prompt = buildGatewayPrompt(request, cfg, request.tier);
      const completion = await completeWithRetry(prompt, request.tier);
      const parsed = parseAiResponse(completion.content, prompt.request, messages, `Groq ${completion.model}`);
      const guarded = applyGuards({
        parsed,
        currentLevel: rule.risk_level,
        clientStage: rule.stage,
        clientSummary: '',
        ruleHintTypes: request.ruleHints.map((h) => h.type),
        cfg,
      });
      const final = analyze(messages, {
        aiSignals: guarded.signals,
        aiDowngrade: guarded.downgradeReason
          ? { reason: guarded.downgradeReason, fromLevel: rule.risk_level }
          : undefined,
      });
      const pred = final.risk_level;
      const row: Row = {
        id: s.id,
        title: s.title,
        gold: s.expected.level,
        rule: rule.risk_level,
        pred,
        ok: pred === s.expected.level,
        benignFalseAlarm: s.expected.level === 'low' && pred !== 'low',
        dangerMissed: RISK_LEVEL_ORDER[s.expected.level] >= RISK_LEVEL_ORDER.high && RISK_LEVEL_ORDER[pred] < RISK_LEVEL_ORDER.high,
        ruleSignals: rule.signals.map((x) => x.type),
        aiSignals: guarded.signals.map((x) => ({ type: x.type, severity: x.severity, confidence: x.confidence })),
        rejected: guarded.rejected,
        latencyMs: Date.now() - started,
        model: completion.model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      };
      rows.push(row);
      console.log(
        `${row.ok ? 'OK' : 'XX'} ${s.id.padEnd(28)} luật ${rule.risk_level.padEnd(9)} → Groq ${pred.padEnd(9)} (kỳ vọng ${s.expected.level}) AI: [${row.aiSignals.map((x) => `${x.type}/${x.severity}`).join(', ')}]`,
      );
    } catch (e) {
      const row: Row = {
        id: s.id,
        title: s.title,
        gold: s.expected.level,
        rule: rule.risk_level,
        pred: rule.risk_level,
        ok: rule.risk_level === s.expected.level,
        benignFalseAlarm: false,
        dangerMissed: false,
        ruleSignals: rule.signals.map((x) => x.type),
        aiSignals: [],
        rejected: 0,
        latencyMs: Date.now() - started,
        model: '',
        inputTokens: 0,
        outputTokens: 0,
        error: (e as Error).message.slice(0, 200),
      };
      rows.push(row);
      console.log(`!! ${s.id.padEnd(28)} lỗi: ${row.error}`);
    }
    if (intervalMs) await sleep(intervalMs);
  }
}

const counted = rows.filter((r) => !r.error);
const levelOk = counted.filter((r) => r.ok).length;
const benignTotal = counted.filter((r) => r.gold === 'low').length;
const benignFlagged = counted.filter((r) => r.benignFalseAlarm).length;
const dangerTotal = counted.filter((r) => RISK_LEVEL_ORDER[r.gold] >= RISK_LEVEL_ORDER.high).length;
const dangerMissed = counted.filter((r) => r.dangerMissed).length;
const summary = {
  label,
  at: new Date().toISOString(),
  model: cfg.groqModelLarge,
  cases: counted.length,
  levelOk,
  levelAccuracy: counted.length ? levelOk / counted.length : 0,
  benignFlagged,
  benignTotal,
  dangerMissed,
  dangerTotal,
  totalInputTokens: counted.reduce((n, r) => n + r.inputTokens, 0),
  totalOutputTokens: counted.reduce((n, r) => n + r.outputTokens, 0),
  p50LatencyMs: median(counted.map((r) => r.latencyMs)),
  maxLatencyMs: Math.max(0, ...counted.map((r) => r.latencyMs)),
  rows,
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

mkdirSync(resolve(ROOT, 'research/results'), { recursive: true });
const out = resolve(ROOT, `research/results/groq-${label}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
console.log(
  `\n${levelOk}/${counted.length} đúng mức (${(summary.levelAccuracy * 100).toFixed(1)}%) · báo nhầm lành tính ${benignFlagged}/${benignTotal} · bỏ sót nguy hiểm ${dangerMissed}/${dangerTotal} · token ${summary.totalInputTokens}/${summary.totalOutputTokens} · p50 ${summary.p50LatencyMs} ms\n→ ${out}`,
);
