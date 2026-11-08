import type { GatewayConfig } from './config';
import type { CounterStore } from './ddb';

export interface LimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export function dateKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function minuteKey(now: number): string {
  return String(Math.floor(now / MINUTE_MS));
}

function secondsToNextMinute(now: number): number {
  return Math.max(1, Math.ceil((MINUTE_MS - (now % MINUTE_MS)) / 1000));
}

function secondsToNextUtcDay(now: number): number {
  return Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));
}

function ttlSeconds(now: number, extraSec: number): number {
  return Math.floor(now / 1000) + extraSec;
}

export class Limits {
  constructor(
    private readonly store: CounterStore,
    private readonly cfg: GatewayConfig,
  ) {}

  async deviceRate(deviceHash: string, now = Date.now()): Promise<LimitResult> {
    const r = await this.store.incrUnder(
      `DEV#${deviceHash}`,
      `RATE#${minuteKey(now)}`,
      'count',
      this.cfg.deviceRpm,
      ttlSeconds(now, 120),
    );
    return r.allowed ? { allowed: true } : { allowed: false, retryAfterSec: secondsToNextMinute(now) };
  }

  async deviceIssueRate(ipHash: string, now = Date.now()): Promise<LimitResult> {
    const r = await this.store.incrUnder(
      `IP#${ipHash}`,
      `ISSUE#${minuteKey(now)}`,
      'count',
      this.cfg.deviceIssueRpm,
      ttlSeconds(now, 120),
    );
    return r.allowed ? { allowed: true } : { allowed: false, retryAfterSec: secondsToNextMinute(now) };
  }

  async globalRate(now = Date.now()): Promise<LimitResult> {
    const r = await this.store.incrUnder(
      'GLOBAL',
      `RATE#${minuteKey(now)}`,
      'count',
      this.cfg.globalRpm,
      ttlSeconds(now, 120),
    );
    return r.allowed ? { allowed: true } : { allowed: false, retryAfterSec: secondsToNextMinute(now) };
  }

  async deviceDaily(deviceHash: string, now = Date.now()): Promise<LimitResult> {
    const r = await this.store.incrUnder(
      `DEV#${deviceHash}`,
      `DAY#${dateKey(now)}`,
      'calls',
      this.cfg.deviceDailyCalls,
      ttlSeconds(now, 2 * 24 * 3600),
    );
    return r.allowed ? { allowed: true } : { allowed: false, retryAfterSec: secondsToNextUtcDay(now) };
  }

  /** Giữ chỗ cả lượt gọi và token ước lượng trong một điều kiện nguyên tử. */
  async reserveGlobal(calls: number, estimatedTokens: number, now = Date.now()): Promise<LimitResult> {
    const ok = await this.store.incrManyUnder(
      'GLOBAL',
      `DAY#${dateKey(now)}`,
      { calls, inTok: estimatedTokens },
      { calls: this.cfg.globalDailyCalls, inTok: this.cfg.globalDailyTokens },
      ttlSeconds(now, 2 * 24 * 3600),
    );
    return ok ? { allowed: true } : { allowed: false, retryAfterSec: secondsToNextUtcDay(now) };
  }

  /** Cộng bù chênh lệch token thật so với token đã giữ chỗ (có thể âm). */
  async adjustGlobalTokens(delta: number, now = Date.now()): Promise<void> {
    if (!delta) return;
    await this.store.incr('GLOBAL', `DAY#${dateKey(now)}`, { inTok: delta }, ttlSeconds(now, 2 * 24 * 3600));
  }
}
