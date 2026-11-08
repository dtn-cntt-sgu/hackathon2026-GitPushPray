// npm run bench:sentences -- --file <csv> --threats 10 --model openai/gpt-oss-120b --reasoning-effort low --run-id <mã>
// Đo bộ câu đơn ngoài repo qua đường gateway. File có cột tin_nhan, nhan. N câu đầu là nhóm đe dọa, còn lại là nhóm bình thường.
// Chỉ in số và mã câu, không in nội dung. Kết quả ghi vào research/results (không lên repo).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAiResponse, type AiParsed } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import { RISK_LEVEL_ORDER as O, type ChatMessage, type RiskLevel } from '@safechat/core/types';
import { parseCsv } from './lib/csv';
import { gatewayBenchRequest, gatewayLevel } from './lib/gateway-bench';
import { arg, CACHE_DIR, loadEnv, RESULTS_DIR } from './lib/io';
import { GROQ_LABEL, GROQ_URL } from './providers/groq';
import { DailyCapReached, OpenRouterClient } from './providers/openrouter';

loadEnv();
const file = arg('file');
const model = arg('model', 'openai/gpt-oss-120b')!;
const runId = arg('run-id');
const threats = Number(arg('threats', '10'));
const effort = arg('reasoning-effort') as 'low' | 'medium' | 'high' | undefined;
const apiKey = process.env.GROQ_API_KEY;
if (!file || !runId || !apiKey) throw new Error('Cần --file, --run-id và GROQ_API_KEY');

const MAP: Record<string, RiskLevel> = { thap: 'low', can_chu_y: 'attention', cao: 'high', nghiem_trong: 'critical' };
const { header, rows } = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (!header.includes('tin_nhan') || !header.includes('nhan')) throw new Error('File cần cột tin_nhan và nhan');
const items = rows.filter((r) => r.values.tin_nhan?.trim()).map((r, i) => {
  const gold = MAP[r.values.nhan?.trim() ?? ''];
  if (!gold) throw new Error(`Dòng ${r.line}: nhãn không hợp lệ`);
  return {
    id: i < threats ? `A${String(i + 1).padStart(2, '0')}` : `B${String(i - threats + 1).padStart(2, '0')}`,
    threat: i < threats,
    gold,
    messages: [{ id: 'msg-001', seq: 1, sender: 'other', text: r.values.tin_nhan! }] as ChatMessage[],
  };
});
if (items.length === 0) throw new Error('Không đọc được câu nào trong file');

const client = new OpenRouterClient({
  apiKey, cacheDir: join(CACHE_DIR, 'groq'), dailyCap: 950, minIntervalMs: Number(arg('interval-ms', '20000')), timeoutMs: 60_000,
  baseUrl: GROQ_URL, label: GROQ_LABEL, disableJsonFallback: true, maxCompletionTokens: 2048, reasoningEffort: effort,
});

interface Row {
  id: string;
  threat: boolean;
  gold: RiskLevel;
  rule: RiskLevel;
  gateway: RiskLevel;
  nocal: RiskLevel;
  aiSignals: string[];
  aiCritical: boolean;
  rejected: number;
  inTok?: number;
  outTok?: number;
  error?: string;
}
const out: Row[] = [];
let stopped: string | undefined;
for (const it of items) {
  const rule = analyze(it.messages).risk_level;
  let parsed: AiParsed | null = null;
  let error: string | undefined;
  let inTok: number | undefined, outTok: number | undefined;
  try {
    const p = gatewayBenchRequest(it.messages);
    const res = await client.chat({ model, system: p.request.system, user: p.request.user });
    inTok = res.promptTokens; outTok = res.completionTokens;
    parsed = parseAiResponse(res.content, p.request, it.messages, model);
  } catch (e) {
    // Hết hạn mức không phải kết quả của AI: dừng, không tính các câu chưa chạy là lỗi.
    if (e instanceof DailyCapReached) {
      stopped = (e as Error).message.slice(0, 300);
      break;
    }
    error = (e as Error).message.slice(0, 160);
  }
  const row = {
    id: it.id, threat: it.threat, gold: it.gold, rule,
    gateway: gatewayLevel(it.messages, parsed), nocal: gatewayLevel(it.messages, parsed, false),
    aiSignals: parsed?.signals.map((s) => `${s.type.replace(/^ai_/, '')}/${s.severity}`) ?? [],
    aiCritical: parsed?.signals.some((s) => s.severity === 'critical') ?? false,
    rejected: (parsed?.rejected ?? 0) + (parsed?.schemaDropped ?? 0), inTok, outTok, error,
  };
  out.push(row);
  console.log(`${row.id} nhan=${row.gold} luat=${row.rule} gateway=${row.gateway} tat_calibrate=${row.nocal} loai=${row.rejected} ai=[${row.aiSignals.join(', ')}]${error ? ` LOI ${error}` : ''}`);
}

const hi = (l: RiskLevel) => O[l] >= O.high;
const sum = (key: 'rule' | 'gateway' | 'nocal') => {
  const A = out.filter((r) => r.threat), B = out.filter((r) => !r.threat), C = A.filter((r) => r.gold === 'critical');
  return { threatHigh: `${A.filter((r) => hi(r[key])).length}/${A.length}`, criticalHit: `${C.filter((r) => r[key] === 'critical').length}/${C.length}`, benignHigh: `${B.filter((r) => hi(r[key])).length}/${B.length}`, accuracy: `${out.filter((r) => r[key] === r.gold).length}/${out.length}` };
};
const summary = {
  model, effort, done: `${out.length}/${items.length}`, stopped, rules: sum('rule'), gateway: sum('gateway'), noCalibrate: sum('nocal'),
  aiFlaggedCritical: `${out.filter((r) => r.threat && r.gold === 'critical' && r.aiCritical).length}/${out.filter((r) => r.threat && r.gold === 'critical').length}`,
  aiCriticalOnBenign: `${out.filter((r) => !r.threat && r.aiCritical).length}/${out.filter((r) => !r.threat).length}`,
  errors: out.filter((r) => r.error).length, rejected: out.reduce((n, r) => n + r.rejected, 0),
  avgIn: Math.round(out.reduce((n, r) => n + (r.inTok ?? 0), 0) / out.length), avgOut: Math.round(out.reduce((n, r) => n + (r.outTok ?? 0), 0) / out.length),
};
console.log(JSON.stringify(summary, null, 1));
mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(join(RESULTS_DIR, `${runId}.sentences.json`), JSON.stringify({ summary, rows: out }, null, 1));
