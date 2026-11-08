import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/lib/ddb';
import { Metrics } from '../src/lib/metrics';
import { makeConfig } from './helpers';

const DATE = '2026-01-02';

describe('Metrics', () => {
  it('tổng hợp calls, token, rejected, latency bucket và byModel', async () => {
    const store = new MemoryStore();
    const metrics = new Metrics(store, makeConfig());
    await metrics.recordCall({
      date: DATE,
      model: 'small-model',
      tier: 'small',
      inputTokens: 100,
      outputTokens: 50,
      rejected: 1,
      latencyMs: 500,
      error: false,
    });
    await metrics.recordCall({
      date: DATE,
      model: 'small-model',
      tier: 'small',
      inputTokens: 100,
      outputTokens: 50,
      rejected: 0,
      latencyMs: 1500,
      error: false,
    });
    await metrics.recordCall({
      date: DATE,
      model: 'large-model',
      tier: 'large',
      inputTokens: 100,
      outputTokens: 50,
      rejected: 2,
      latencyMs: 5000,
      error: true,
    });

    const summary = await metrics.summary(DATE);
    expect(summary.calls).toBe(3);
    expect(summary.rejectedQuotes).toBe(3);
    expect(summary.latencyP50Ms).toBe(1500);
    expect(summary.latencyP95Ms).toBe(5000);
    expect(summary.byModel['small-model (small)']?.calls).toBe(2);
    expect(summary.byModel['large-model (large)']?.calls).toBe(1);
  });

  it('không lưu chuỗi nội dung, chỉ bộ đếm số', async () => {
    const store = new MemoryStore();
    const metrics = new Metrics(store, makeConfig());
    await metrics.recordCall({
      date: DATE,
      model: 'm',
      tier: 'small',
      inputTokens: 1,
      outputTokens: 1,
      rejected: 0,
      latencyMs: 10,
      error: false,
    });
    for (let i = 0; i < 10; i++) {
      for (const row of await store.query(`METRIC#${DATE}#${i}`)) {
        for (const [k, v] of Object.entries(row)) {
          if (k === 'PK' || k === 'SK' || k === 'ttl') continue;
          expect(typeof v).toBe('number');
        }
      }
    }
  });

  it('ghi feedback theo verdict và signal type', async () => {
    const store = new MemoryStore();
    const metrics = new Metrics(store, makeConfig());
    await metrics.recordFeedback(DATE, 'correct', ['otp_request', 'fee_upfront']);
    const verdict = await store.get(`FEEDBACK#${DATE}`, 'V#correct');
    expect(verdict?.count).toBe(1);
    const type = await store.get(`FEEDBACK#${DATE}`, 'TYPE#otp_request');
    expect(type?.count).toBe(1);
  });
});
