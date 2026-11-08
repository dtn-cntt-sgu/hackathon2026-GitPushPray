import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/lib/ddb';
import { Limits } from '../src/lib/limits';
import { makeConfig } from './helpers';

const NOW = 1_700_000_000_000;

describe('Limits', () => {
  it('rate limit theo phút', async () => {
    const cfg = makeConfig({ deviceRpm: 2 });
    const limits = new Limits(new MemoryStore(), cfg);
    expect((await limits.deviceRate('dev', NOW)).allowed).toBe(true);
    expect((await limits.deviceRate('dev', NOW)).allowed).toBe(true);
    const blocked = await limits.deviceRate('dev', NOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    // sang phút sau được lại
    expect((await limits.deviceRate('dev', NOW + 60_000)).allowed).toBe(true);
  });

  it('quota ngày thiết bị', async () => {
    const cfg = makeConfig({ deviceDailyCalls: 2 });
    const limits = new Limits(new MemoryStore(), cfg);
    expect((await limits.deviceDaily('dev', NOW)).allowed).toBe(true);
    expect((await limits.deviceDaily('dev', NOW)).allowed).toBe(true);
    expect((await limits.deviceDaily('dev', NOW)).allowed).toBe(false);
    expect((await limits.deviceDaily('dev', NOW + 86_400_000)).allowed).toBe(true);
  });

  it('ngân sách toàn cục theo lượt và token', async () => {
    const cfg = makeConfig({ globalDailyCalls: 2, globalDailyTokens: 100 });
    const limits = new Limits(new MemoryStore(), cfg);
    expect((await limits.reserveGlobal(1, 40, NOW)).allowed).toBe(true);
    expect((await limits.reserveGlobal(1, 40, NOW)).allowed).toBe(true);
    expect((await limits.reserveGlobal(1, 10, NOW)).allowed).toBe(false);
  });

  it('không vượt trần token khi cộng dồn nhiều request', async () => {
    const cfg = makeConfig({ globalDailyCalls: 10, globalDailyTokens: 100 });
    const limits = new Limits(new MemoryStore(), cfg);
    expect((await limits.reserveGlobal(1, 60, NOW)).allowed).toBe(true);
    expect((await limits.reserveGlobal(1, 60, NOW)).allowed).toBe(false);
    expect((await limits.reserveGlobal(1, 40, NOW)).allowed).toBe(true);
  });

  it('một request lớn hơn cả trần bị chặn ngay từ đầu', async () => {
    const cfg = makeConfig({ globalDailyCalls: 10, globalDailyTokens: 100 });
    const limits = new Limits(new MemoryStore(), cfg);
    expect((await limits.reserveGlobal(1, 5000, NOW)).allowed).toBe(false);
  });

  it('đua tranh hai request: chỉ một thắng khi còn một lượt', async () => {
    const cfg = makeConfig({ deviceDailyCalls: 1 });
    const limits = new Limits(new MemoryStore(), cfg);
    const results = await Promise.all(Array.from({ length: 5 }, () => limits.deviceDaily('dev', NOW)));
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
  });

  it('cộng bù token thật có thể âm', async () => {
    const cfg = makeConfig({ globalDailyTokens: 1000 });
    const store = new MemoryStore();
    const limits = new Limits(store, cfg);
    await limits.reserveGlobal(1, 100, NOW);
    await limits.adjustGlobalTokens(-40, NOW);
    const row = await store.get('GLOBAL', `DAY#${new Date(NOW).toISOString().slice(0, 10)}`);
    expect(row?.inTok).toBe(60);
  });
});
