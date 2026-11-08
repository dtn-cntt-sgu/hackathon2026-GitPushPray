import { describe, expect, it } from 'vitest';
import type { BenchCase } from '../lib/dataset';
import { hashSplit, tuneCheckSplit } from '../lib/tunecheck';

function makeCase(id: string, source: string, gold: BenchCase['gold'], kind: BenchCase['kind']): BenchCase {
  return { id, group: 1, kind, messages: [], gold, tags: [], source };
}

const cases: BenchCase[] = [
  ...Array.from({ length: 20 }, (_, i) => makeCase(`S${i}`, `chuyen_the:https://bao.vn/${i}`, 'high', 'scam')),
  ...Array.from({ length: 20 }, (_, i) => makeCase(`B${i}`, 'tu_viet', 'low', 'benign_confusable')),
  makeCase('X1', 'chuyen_the:https://bao.vn/chung', 'critical', 'scam'),
  makeCase('X2', 'chuyen_the:https://bao.vn/chung', 'critical', 'scam'),
];

describe('tách tune/check', () => {
  it('cùng seed cho cùng kết quả, không trùng ca và đủ ca', () => {
    const a = tuneCheckSplit(cases, 16, 7);
    expect(tuneCheckSplit(cases, 16, 7)).toEqual(a);
    expect(new Set([...a.tune, ...a.check]).size).toBe(cases.length);
    expect(a.tune.length + a.check.length).toBe(cases.length);
  });

  it('ca cùng nguồn báo luôn nằm cùng một phía', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = tuneCheckSplit(cases, 16, seed);
      expect(s.check.includes('X1')).toBe(s.check.includes('X2'));
    }
  });

  it('nguồn tự viết không bị gom thành một nhóm', () => {
    const s = tuneCheckSplit(cases, 16, 7);
    const benignInCheck = s.check.filter((id) => id.startsWith('B')).length;
    expect(benignInCheck).toBeGreaterThan(0);
    expect(benignInCheck).toBeLessThan(20);
  });

  it('mã băm đổi khi tập bị sửa', () => {
    const s = tuneCheckSplit(cases, 16, 7);
    expect(hashSplit(s.tune, s.check)).toBe(s.sha256);
    expect(hashSplit([...s.tune, 'moi'], s.check)).not.toBe(s.sha256);
  });
});
