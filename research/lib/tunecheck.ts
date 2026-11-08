// Tách bộ đề thành tune (được đọc lỗi để sửa luật/prompt) và check (chỉ xem số tổng).
// Ca cùng một nguồn luôn đi chung một phía; phân tầng theo loại ca và mức nguy hiểm.
import { createHash } from 'node:crypto';
import type { BenchCase } from './dataset';
import { mulberry32 } from './split';

export interface TuneCheckSplit {
  seed: number;
  tune: string[];
  check: string[];
  /** Mã băm của danh sách ca, dùng để phát hiện việc đổi tập sau khi đã khóa. */
  sha256: string;
}

/** Nguồn ghi chung chung (tự viết, nguồn đã ẩn) không có nghĩa là cùng một vụ, nên không gom. */
function sourceGroup(c: BenchCase): string {
  return /^chuyen_the:https?:/.test(c.source) ? c.source : c.id;
}

function stratum(c: BenchCase): string {
  const danger = c.gold === 'high' || c.gold === 'critical';
  return `${c.kind}|${danger ? 'danger' : 'safe'}`;
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function hashSplit(tune: string[], check: string[]): string {
  return createHash('sha256').update(JSON.stringify({ tune, check })).digest('hex');
}

export function tuneCheckSplit(cases: BenchCase[], checkSize: number, seed: number): TuneCheckSplit {
  const rand = mulberry32(seed);
  const groups = new Map<string, BenchCase[]>();
  for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = sourceGroup(c);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  // Xếp nhóm theo tầng của ca đầu tiên rồi chia đều dần cho check theo tỷ lệ của từng tầng
  const byStratum = new Map<string, BenchCase[][]>();
  for (const g of groups.values()) {
    const key = stratum(g[0]!);
    byStratum.set(key, [...(byStratum.get(key) ?? []), g]);
  }
  const ratio = checkSize / cases.length;
  const check: string[] = [];
  const tune: string[] = [];
  for (const key of [...byStratum.keys()].sort()) {
    const list = shuffled(byStratum.get(key)!, rand);
    const total = list.reduce((s, g) => s + g.length, 0);
    const target = Math.round(total * ratio);
    let taken = 0;
    for (const g of list) {
      const ids = g.map((c) => c.id);
      if (taken + ids.length <= target) {
        check.push(...ids);
        taken += ids.length;
      } else {
        tune.push(...ids);
      }
    }
  }
  check.sort();
  tune.sort();
  return { seed, tune, check, sha256: hashSplit(tune, check) };
}
