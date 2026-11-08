// Tóm tắt kết quả một lần chạy AI thành số để ghi sổ. Không giữ nội dung chat.
import type { RiskLevel } from '@safechat/core/types';
import { partMetrics, type PartMetrics, type Prediction } from './metrics';

export interface AiRunRow {
  caseId: string;
  gold: RiskLevel;
  kind: string;
  group: number;
  tags: string[];
  config: string;
  model: string;
  repeat: number;
  pred: RiskLevel | null;
  jsonValid?: boolean;
  aiLevel?: RiskLevel | null;
  rejected?: number;
  schemaDropped?: number;
  latencyMs?: number;
  cached?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

export interface AiCallStats {
  calls: number;
  jsonValidRate: number | null;
  errors: number;
  totalRejected: number;
  totalSchemaDropped: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  promptTokensPerCall: number | null;
  completionTokensPerCall: number | null;
}

/**
 * Chạy lại sau khi hết hạn mức sẽ ghi thêm dòng cho cùng một ca, nên chỉ giữ dòng mới nhất.
 * Lần gọi model tính theo cấu hình `ai` hoặc `hybrid-hint`, vì `hybrid`, `hybrid-veto` dùng lại phản hồi của `ai`.
 */
export function aiRunSummary(rows: AiRunRow[], model: string): { byConfig: Record<string, PartMetrics>; calls: Record<string, AiCallStats> } {
  const latest = new Map<string, AiRunRow>();
  for (const r of rows) {
    if (r.model === model || r.model === '-') latest.set(`${r.config}|${r.model}|${r.repeat}|${r.caseId}`, r);
  }
  const groups = new Map<string, AiRunRow[]>();
  for (const r of latest.values()) groups.set(r.config, [...(groups.get(r.config) ?? []), r]);

  const byConfig: Record<string, PartMetrics> = {};
  const calls: Record<string, AiCallStats> = {};
  for (const [config, list] of groups) {
    const preds: Prediction[] = list.map((r) => ({ caseId: r.caseId, gold: r.gold, pred: r.pred, kind: r.kind, group: r.group, tags: r.tags }) as Prediction);
    byConfig[config] = partMetrics(preds);
    if (config !== 'ai' && config !== 'hybrid-hint') continue;
    const latency = list.filter((r) => r.latencyMs !== undefined).map((r) => r.latencyMs!).sort((a, b) => a - b);
    const answered = list.filter((r) => r.promptTokens !== undefined);
    const avg = (f: (r: AiRunRow) => number) => (answered.length ? Math.round(answered.reduce((s, r) => s + f(r), 0) / answered.length) : null);
    calls[config] = {
      calls: list.length,
      jsonValidRate: list.length ? list.filter((r) => r.jsonValid).length / list.length : null,
      errors: list.filter((r) => r.error).length,
      totalRejected: list.reduce((s, r) => s + (r.rejected ?? 0), 0),
      totalSchemaDropped: list.reduce((s, r) => s + (r.schemaDropped ?? 0), 0),
      latencyP50Ms: percentile(latency, 0.5),
      latencyP95Ms: percentile(latency, 0.95),
      promptTokensPerCall: avg((r) => r.promptTokens ?? 0),
      completionTokensPerCall: avg((r) => r.completionTokens ?? 0),
    };
  }
  return { byConfig, calls };
}
