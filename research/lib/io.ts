// Đường dẫn, nạp bộ đề và biến môi trường cho các lệnh nghiên cứu.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios } from '../../fixtures/scenarios';
import { parseCsv } from './csv';
import { rowsToCases, type BenchCase } from './dataset';
import { hashSplit, type TuneCheckSplit } from './tunecheck';
import { readXlsxSheet } from './xlsx';

export const RESEARCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(RESEARCH_DIR, 'data');
export const CACHE_DIR = join(RESEARCH_DIR, 'cache');
export const RESULTS_DIR = join(RESEARCH_DIR, 'results');
export const REPORTS_DIR = join(RESEARCH_DIR, 'reports');

/** Đọc research/.env (không commit) nếu có. */
export function loadEnv() {
  const f = join(RESEARCH_DIR, '.env');
  if (existsSync(f)) process.loadEnvFile(f);
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

/** 40 tình huống phát triển trong fixtures/ (do người viết luật soạn — chỉ dùng để thử đường ống). */
export function fixtureCases(): BenchCase[] {
  return scenarios.map((s) => ({
    id: s.id,
    group: -1,
    kind: s.expected.level === 'low' ? 'benign' : 'scam',
    messages: s.messages,
    gold: s.expected.level,
    tags: [],
    source: 'fixtures',
  }));
}

function tuneCheckFile(name: string): string {
  return join(RESEARCH_DIR, 'splits', `${name.replace(':', '_')}_tune_check.json`);
}

/** Bộ đề có file chia tune/check đã khóa hay không (vd. `set:v2`). */
export function hasTuneCheckSplit(name: string): boolean {
  return existsSync(tuneCheckFile(name));
}

function readTuneCheckSplit(name: string): TuneCheckSplit {
  const sp = JSON.parse(readFileSync(tuneCheckFile(name), 'utf8')) as TuneCheckSplit;
  if (hashSplit(sp.tune, sp.check) !== sp.sha256) throw new Error('Tập tune/check đã bị sửa');
  return sp;
}

/** Danh sách ca tune của tập đã khóa (`set:v2` → splits/set_v2_tune_check.json). Tập bị sửa thì dừng. */
export function lockedTuneIds(name: string): string[] {
  return readTuneCheckSplit(name).tune;
}

/** Danh sách ca check của tập đã khóa (`set:v2` → splits/set_v2_tune_check.json). Tập bị sửa thì dừng. */
export function lockedCheckIds(name: string): string[] {
  return readTuneCheckSplit(name).check;
}

export function loadDataset(name: string, split: string): BenchCase[] {
  if (name === 'fixtures') return fixtureCases();
  // Bộ dữ liệu ngoài (bench:external, nhãn 2 lớp) hoặc bộ đề đặt tên (bench:import --name)
  if (name.startsWith('ext:') || name.startsWith('set:')) {
    const dir = join(DATA_DIR, name.startsWith('ext:') ? 'external' : 'sets', name.slice(4));
    const all = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')) as BenchCase[];
    if (split === 'all') return all;
    if (split === 'tune') {
      const tune = new Set(lockedTuneIds(name));
      return all.filter((c) => tune.has(c.id));
    }
    if (split === 'check') {
      const check = new Set(lockedCheckIds(name));
      return all.filter((c) => check.has(c.id));
    }
    const sp = JSON.parse(readFileSync(join(dir, 'split.json'), 'utf8')) as { dev: string[]; test: string[] };
    const ids = new Set(split === 'test' ? sp.test : sp.dev);
    return all.filter((c) => ids.has(c.id));
  }
  // Kiểm tra nhanh một file đề (vd. đợt ca mới viết) mà không nhập/khóa bộ test — bỏ qua --split
  if (/\.(csv|xlsx)$/i.test(name)) {
    const raw = readFileSync(name);
    const { header, rows } = /\.xlsx$/i.test(name)
      ? readXlsxSheet(raw, arg('sheet', 'Bo_De_Chuan_TEMPLATE'))
      : parseCsv(raw.toString('utf8'));
    const { cases, issues } = rowsToCases(header, rows);
    if (issues.length) throw new Error(`File đề có ${issues.length} lỗi — chạy bench:import để xem chi tiết`);
    return cases;
  }
  const all = JSON.parse(readFileSync(join(DATA_DIR, 'cases.json'), 'utf8')) as BenchCase[];
  if (split === 'all') return all;
  const sp = JSON.parse(readFileSync(join(DATA_DIR, 'split.json'), 'utf8')) as { dev: string[]; test: string[] };
  const ids = new Set(split === 'test' ? sp.test : sp.dev);
  return all.filter((c) => ids.has(c.id));
}
