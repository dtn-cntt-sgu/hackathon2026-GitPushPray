// npm run bench:experiment-ai -- --id EXP-011 --run <runId> --model <id> --config hybrid-hint --title "..." --hypothesis "..."
// Ghi kết quả một lần chạy AI (research/run.ts) thành thí nghiệm trong sổ. Chỉ nhận lần chạy trên tune.
// metrics.json không chứa nội dung chat. Sau khi chạy phải tự viết README.md, phần kết luận cần người đọc.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aiRunSummary, type AiRunRow } from './lib/airun';
import { BENCH_SYSTEM_PROMPT } from './lib/bench';
import { arg, RESEARCH_DIR, RESULTS_DIR } from './lib/io';

const id = arg('id');
const runId = arg('run');
const model = arg('model');
const config = arg('config', 'hybrid-hint')!;
const title = arg('title');
const hypothesis = arg('hypothesis');
if (!id || !runId || !model || !title || !hypothesis) throw new Error('Cần --id, --run, --model, --title, --hypothesis');

const out = join(RESEARCH_DIR, 'experiments', id);
if (existsSync(join(out, 'metrics.json'))) throw new Error(`${id} đã có. Mỗi lần thử phải có mã mới, không ghi đè.`);

const meta = JSON.parse(readFileSync(join(RESULTS_DIR, `${runId}.meta.json`), 'utf8')) as {
  dataset: string;
  split: string;
  provider?: string;
  reasoningEffort?: string;
  promptVersion: string;
  rulesCommit: string;
  n: number;
  status: string;
};
if (meta.split !== 'tune' && !process.argv.includes('--allow-any-split')) throw new Error(`Lần chạy dùng split ${meta.split}, chỉ nhận tune.`);

const rows = readFileSync(join(RESULTS_DIR, `${runId}.jsonl`), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as AiRunRow);
const summary = aiRunSummary(rows, model);
const main = summary.byConfig[config];
if (!main) throw new Error(`Lần chạy không có cấu hình ${config} của model ${model}`);
if (main.n < meta.n) console.warn(`Cảnh báo: cấu hình ${config} mới có ${main.n}/${meta.n} ca (status ${meta.status}).`);

const repoRoot = resolve(RESEARCH_DIR, '..');
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (execSync('git status --porcelain -- packages/core research/lib research/experiment-ai.ts', { cwd: repoRoot, encoding: 'utf8' }).trim()) {
    commit += '+dirty';
  }
} catch {
  /* không có git thì bỏ qua */
}
if ((commit.endsWith('+dirty') || meta.rulesCommit.endsWith('+dirty')) && !process.argv.includes('--allow-dirty')) {
  throw new Error(
    `Không ghi thí nghiệm AI khi commit (${commit}) hoặc rulesCommitAtRun (${meta.rulesCommit}) còn +dirty. Hãy commit trước hoặc thêm --allow-dirty nếu chỉ thử nháp.`,
  );
}

// Giữ dòng mới nhất của từng ca cho cấu hình đã chọn (repeat 0)
const latestForConfig = new Map<string, AiRunRow>();
for (const r of rows) {
  if (r.config === config && (r.model === model || r.model === '-') && r.repeat === 0) {
    latestForConfig.set(r.caseId, r);
  }
}
const tunePredRows = [...latestForConfig.values()];
const tunePredictions = tunePredRows.map((r) => ({ id: r.caseId, gold: r.gold, pred: r.pred }));

const promptSha256 = createHash('sha256').update(BENCH_SYSTEM_PROMPT, 'utf8').digest('hex');
const rawPath = join(RESULTS_DIR, `${runId}.raw.jsonl`);
const rawFileSha256 = existsSync(rawPath) ? createHash('sha256').update(readFileSync(rawPath)).digest('hex') : null;

const record = {
  id,
  date: new Date().toISOString().slice(0, 10),
  title,
  hypothesis,
  method: `${config}, ${meta.provider ?? 'openrouter'} ${model}${meta.reasoningEffort ? ` (reasoning ${meta.reasoningEffort})` : ''}, prompt ${meta.promptVersion}`,
  rulesCommit: commit,
  rulesCommitAtRun: meta.rulesCommit,
  dataset: `${meta.dataset}/${meta.split}`,
  runId,
  status: meta.status,
  promptSha256,
  rawFileSha256,
  checkViewed: false,
  tune: main,
  check: null,
  sms: null,
  byConfig: summary.byConfig,
  calls: summary.calls,
  tunePredictions,
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'metrics.json'), JSON.stringify(record, null, 2) + '\n');

const localDir = join(RESULTS_DIR, 'experiments', id);
mkdirSync(localDir, { recursive: true });
writeFileSync(join(localDir, 'preds.json'), JSON.stringify({ tune: tunePredRows, check: [] }));

console.log(JSON.stringify({ id, miss: main.dangerMissCount, falseAlarmHigh: main.falseAlarmHighCount, calls: summary.calls }));
console.log(`Viết research/experiments/${id}/README.md rồi chạy: npm run bench:experiment -- --ledger`);
