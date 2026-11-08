// Chia dev/test phân tầng theo (nhóm × mức), seed cố định để tái lập được.
import { createHash } from 'node:crypto';
import type { BenchCase } from './dataset';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stratifiedSplit(cases: BenchCase[], devRatio = 0.3, seed = 20261031): { dev: string[]; test: string[] } {
  const rand = mulberry32(seed);
  const strata = new Map<string, BenchCase[]>();
  // Ca có split cố định (fixedSplit) không tham gia chia ngẫu nhiên
  const fixedDev = cases.filter((c) => c.fixedSplit === 'dev').map((c) => c.id);
  const fixedTest = cases.filter((c) => c.fixedSplit === 'test').map((c) => c.id);
  for (const c of [...cases].filter((x) => !x.fixedSplit).sort((a, b) => a.id.localeCompare(b.id))) {
    const k = `${c.group}|${c.gold}`;
    strata.set(k, [...(strata.get(k) ?? []), c]);
  }
  const dev: string[] = [...fixedDev];
  const test: string[] = [...fixedTest];
  for (const k of [...strata.keys()].sort()) {
    const arr = strata.get(k)!;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    const nDev = Math.round(arr.length * devRatio);
    arr.forEach((c, i) => (i < nDev ? dev : test).push(c.id));
  }
  return { dev: dev.sort(), test: test.sort() };
}

/** Mã băm nội dung bộ test — đổi bất kỳ ca test nào sẽ đổi mã. */
export function hashCases(cases: BenchCase[]): string {
  const canon = [...cases]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, gold: c.gold, messages: c.messages.map((m) => [m.sender, m.text]) }));
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
