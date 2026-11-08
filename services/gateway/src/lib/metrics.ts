import type { MetricsSummary } from '@safechat/contracts';
import type { CounterStore } from './ddb';
import type { GatewayConfig } from './config';

const SHARDS = 10;
const METRIC_TTL_DAYS = 90;
const FEEDBACK_TTL_DAYS = 90;

function ttl(now: number, days = METRIC_TTL_DAYS): number {
  return Math.floor(now / 1000) + days * 24 * 3600;
}

function latencyBucket(latencyMs: number): string {
  if (latencyMs < 1000) return 'lat_lt1s';
  if (latencyMs < 2000) return 'lat_1to2s';
  if (latencyMs < 4000) return 'lat_2to4s';
  return 'lat_gt4s';
}

function approximatePercentile(counts: { lt1: number; oneTo2: number; twoTo4: number; gt4: number }, p: number): number {
  const total = counts.lt1 + counts.oneTo2 + counts.twoTo4 + counts.gt4;
  if (total === 0) return 0;
  const target = total * p;
  if (counts.lt1 >= target) return 500;
  if (counts.lt1 + counts.oneTo2 >= target) return 1500;
  if (counts.lt1 + counts.oneTo2 + counts.twoTo4 >= target) return 3000;
  return 5000;
}

export interface CallMetric {
  date: string;
  model: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  rejected: number;
  latencyMs: number;
  error: boolean;
  now?: number;
}

export class Metrics {
  constructor(
    private readonly store: CounterStore,
    private readonly cfg: Pick<GatewayConfig, 'costPer1kInputUsd' | 'costPer1kOutputUsd'>,
  ) {}

  async recordCall(m: CallMetric): Promise<void> {
    const now = m.now ?? Date.now();
    const shard = Math.floor(Math.random() * SHARDS);
    await this.store.incr(
      `METRIC#${m.date}#${shard}`,
      'COUNTER',
      {
        calls: 1,
        inTok: m.inputTokens,
        outTok: m.outputTokens,
        rejected: m.rejected,
        errors: m.error ? 1 : 0,
        [latencyBucket(m.latencyMs)]: 1,
      },
      ttl(now),
    );
    await this.store.incr(
      `METRIC#${m.date}`,
      `MODEL#${m.model}#${m.tier}`,
      { calls: 1, inTok: m.inputTokens, outTok: m.outputTokens },
      ttl(now),
    );
  }

  async recordFeedback(date: string, verdict: string, signalTypes: string[], now = Date.now()): Promise<void> {
    const expires = ttl(now, FEEDBACK_TTL_DAYS);
    await this.store.incr(`FEEDBACK#${date}`, `V#${verdict}`, { count: 1 }, expires);
    for (const type of signalTypes.slice(0, 20)) {
      await this.store.incr(`FEEDBACK#${date}`, `TYPE#${type.slice(0, 64)}`, { count: 1 }, expires);
    }
  }

  async summary(date: string): Promise<MetricsSummary> {
    const counters = await Promise.all(
      Array.from({ length: SHARDS }, (_, i) => this.store.query(`METRIC#${date}#${i}`)),
    );
    const totals = { calls: 0, inTok: 0, outTok: 0, rejected: 0, lt1: 0, oneTo2: 0, twoTo4: 0, gt4: 0 };
    for (const rows of counters) {
      for (const row of rows) {
        totals.calls += Number(row.calls ?? 0);
        totals.inTok += Number(row.inTok ?? 0);
        totals.outTok += Number(row.outTok ?? 0);
        totals.rejected += Number(row.rejected ?? 0);
        totals.lt1 += Number(row.lat_lt1s ?? 0);
        totals.oneTo2 += Number(row.lat_1to2s ?? 0);
        totals.twoTo4 += Number(row.lat_2to4s ?? 0);
        totals.gt4 += Number(row.lat_gt4s ?? 0);
      }
    }

    const byModel: Record<string, { calls: number; costUsd: number }> = {};
    for (const row of await this.store.query(`METRIC#${date}`)) {
      const sk = String(row.SK ?? '');
      if (!sk.startsWith('MODEL#')) continue;
      const [, model = 'unknown', tier = 'unknown'] = sk.split('#');
      const key = `${model} (${tier})`;
      const calls = Number(row.calls ?? 0);
      const inTok = Number(row.inTok ?? 0);
      const outTok = Number(row.outTok ?? 0);
      const costUsd = (inTok / 1000) * this.cfg.costPer1kInputUsd + (outTok / 1000) * this.cfg.costPer1kOutputUsd;
      byModel[key] = { calls: (byModel[key]?.calls ?? 0) + calls, costUsd: (byModel[key]?.costUsd ?? 0) + costUsd };
    }

    const costUsd = Object.values(byModel).reduce((n, v) => n + v.costUsd, 0);
    return {
      date,
      calls: totals.calls,
      costUsd: Math.round(costUsd * 1e6) / 1e6,
      latencyP50Ms: approximatePercentile(totals, 0.5),
      latencyP95Ms: approximatePercentile(totals, 0.95),
      rejectedQuotes: totals.rejected,
      byModel,
    };
  }
}
