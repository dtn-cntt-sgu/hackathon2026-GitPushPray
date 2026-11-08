// npm run bench:experiment -- --id EXP-002 --title "..." --hypothesis "..." --method rules|frames|rules+frames [--skip-check] [--vs EXP-001]
// npm run bench:experiment -- --ledger
// Ghi một lần thí nghiệm: giả thuyết, commit, số tune/check/SMS.
// research/experiments/<id>/metrics.json lên repo (không có nội dung chat, không có mã ca của check).
// research/results/experiments/<id>/ giữ dự đoán đầy đủ trên máy để so từng cặp, không lên repo.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '@safechat/core/analyzer';
import type { RiskLevel } from '@safechat/core/types';
import { FRAME_VERSION, frameLevel } from './lib/frames';
import type { BenchCase } from './lib/dataset';
import { arg, loadDataset, RESEARCH_DIR, RESULTS_DIR } from './lib/io';
import { partMetrics, type Prediction } from './lib/metrics';
import { hashSplit, type TuneCheckSplit } from './lib/tunecheck';

const EXP_DIR = join(RESEARCH_DIR, 'experiments');
const RANK: Record<RiskLevel, number> = { low: 0, attention: 1, high: 2, critical: 3 };

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '–' : `${(x * 100).toFixed(1)}%`;
}

function writeLedger(): void {
  const rows = readdirSync(EXP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^EXP-/.test(d.name))
    .map((d) => JSON.parse(readFileSync(join(EXP_DIR, d.name, 'metrics.json'), 'utf8')))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let looks = 0;
  const lines = [
    '# Sổ thí nghiệm',
    '',
    'Tự sinh bằng `npm run bench:experiment -- --ledger`. Không sửa tay. Cách đọc và quy tắc ở [README.md](README.md).',
    '',
    '`Cao+` là cảnh báo từ mức Cao trở lên. `Bỏ sót` là ca nhãn từ Cao trở lên bị chấm dưới Cao. Mọi số là số dev.',
    '',
    '| Mã | Nội dung | Cách suy luận | Commit | Tune: bỏ sót | Tune: báo nhầm Cao+ | Check: bỏ sót | Check: báo nhầm Cao+ | SMS BT Cao+ | SMS LĐ Cao+ | Lần xem check (cộng dồn) |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of rows) {
    if (r.checkViewed) looks += 1;
    const c = r.check;
    lines.push(
      `| [${r.id}](${r.id}/README.md) | ${r.title} | ${r.method} | \`${r.rulesCommit}\` | ${pct(r.tune?.dangerMiss)} (${r.tune?.dangerMissCount ?? '–'}) | ${pct(r.tune?.falseAlarmHigh)} (${r.tune?.falseAlarmHighCount ?? '–'}) | ${c ? `${pct(c.dangerMiss)} (${c.dangerMissCount})` : 'chưa xem'} | ${c ? `${pct(c.falseAlarmHigh)} (${c.falseAlarmHighCount})` : 'chưa xem'} | ${pct(r.sms?.benignHigh)} | ${pct(r.sms?.scamHigh)} | ${looks} |`,
    );
  }
  writeFileSync(join(EXP_DIR, 'LEDGER.md'), lines.join('\n') + '\n');
  console.log(`Đã cập nhật sổ: ${rows.length} thí nghiệm, ${looks} lần xem check.`);
}

function main(): void {
  if (process.argv.includes('--ledger')) {
    writeLedger();
    return;
  }
  const id = arg('id');
  const title = arg('title');
  const hypothesis = arg('hypothesis');
  const method = arg('method', 'rules') ?? 'rules';
  if (!id || !title || !hypothesis) throw new Error('Cần --id, --title, --hypothesis');
  if (existsSync(join(EXP_DIR, id, 'metrics.json'))) throw new Error(`${id} đã có. Mỗi lần thử phải có mã mới, không ghi đè.`);

  const dataset = 'set:v2';
  const split = JSON.parse(readFileSync(join(RESEARCH_DIR, 'splits', 'set_v2_tune_check.json'), 'utf8')) as TuneCheckSplit;
  if (hashSplit(split.tune, split.check) !== split.sha256) throw new Error('Tập tune/check đã bị sửa');
  const skipCheck = process.argv.includes('--skip-check');

  const predict = (messages: BenchCase['messages']): RiskLevel => {
    const rule = analyze(messages).risk_level;
    if (method === 'rules') return rule;
    const frame = frameLevel(messages);
    if (method === 'frames') return frame;
    if (method === 'rules+frames') return RANK[frame] > RANK[rule] ? frame : rule;
    throw new Error(`Không biết --method ${method}`);
  };

  const cases = loadDataset(dataset, 'all');
  const predsOf = (ids: string[]): Prediction[] => {
    const set = new Set(ids);
    return cases.filter((c) => set.has(c.id)).map((c) => ({ caseId: c.id, gold: c.gold, pred: predict(c.messages), kind: c.kind, group: c.group, tags: c.tags }));
  };
  const tunePreds = predsOf(split.tune);
  const checkPreds = skipCheck ? [] : predsOf(split.check);

  const sms = loadDataset('ext:sms', 'dev').map((c) => ({ kind: c.kind, pred: predict(c.messages) }));
  const rate = (kind: 'benign' | 'scam') => {
    const part = sms.filter((s) => (kind === 'scam' ? s.kind === 'scam' : s.kind !== 'scam'));
    return { high: part.filter((s) => RANK[s.pred] >= 2).length / part.length, any: part.filter((s) => s.pred !== 'low').length / part.length };
  };

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (execSync('git status --porcelain packages/core research/lib research/experiment.ts', { encoding: 'utf8' }).trim()) commit += '+dirty';
  } catch {
    /* không có git thì bỏ qua */
  }

  // So từng cặp với thí nghiệm trước: chỉ giữ số ca thay đổi, không ghi mã ca của check
  let paired: unknown = null;
  const vs = arg('vs');
  const localDir = join(RESULTS_DIR, 'experiments', id);
  if (vs && !skipCheck && existsSync(join(RESULTS_DIR, 'experiments', vs, 'preds.json'))) {
    const old = JSON.parse(readFileSync(join(RESULTS_DIR, 'experiments', vs, 'preds.json'), 'utf8')) as { check: Prediction[] };
    const before = new Map(old.check.map((p) => [p.caseId, p.pred]));
    let caught = 0;
    let lost = 0;
    let newAlarm = 0;
    let clearedAlarm = 0;
    for (const p of checkPreds) {
      const b = RANK[before.get(p.caseId) ?? 'low'] >= 2;
      const a = p.pred ? RANK[p.pred] >= 2 : false;
      if (b === a) continue;
      if (p.kind === 'scam') a ? caught++ : lost++;
      else a ? newAlarm++ : clearedAlarm++;
    }
    paired = { vs, checkScamNewlyHigh: caught, checkScamLostHigh: lost, checkBenignNewAlarmHigh: newAlarm, checkBenignClearedHigh: clearedAlarm };
  }

  const record = {
    id,
    date: new Date().toISOString().slice(0, 10),
    title,
    hypothesis,
    method: method === 'rules' ? method : `${method} (${FRAME_VERSION})`,
    rulesCommit: commit,
    dataset,
    splitSha256: split.sha256,
    checkViewed: !skipCheck,
    tune: partMetrics(tunePreds),
    check: skipCheck ? null : partMetrics(checkPreds),
    sms: { benignHigh: rate('benign').high, benignAny: rate('benign').any, scamHigh: rate('scam').high, scamAny: rate('scam').any, n: sms.length },
    paired,
    tunePredictions: tunePreds.map((p) => ({ id: p.caseId, gold: p.gold, pred: p.pred })),
  };

  mkdirSync(join(EXP_DIR, id), { recursive: true });
  mkdirSync(localDir, { recursive: true });
  writeFileSync(join(EXP_DIR, id, 'metrics.json'), JSON.stringify(record, null, 2) + '\n');
  writeFileSync(join(localDir, 'preds.json'), JSON.stringify({ tune: tunePreds, check: checkPreds }));
  const conclusion = arg('conclusion') ?? '*Viết sau khi đọc kết quả.*';
  const body = [
    `# ${id}: ${title}`,
    '',
    `- **Ngày:** ${record.date}`,
    `- **Cách suy luận:** ${record.method}`,
    `- **Commit:** \`${commit}\``,
    `- **Tập đã khóa:** \`${split.sha256.slice(0, 12)}\``,
    `- **Xem check:** ${skipCheck ? 'không' : 'có, chỉ số tổng'}`,
    '',
    '## Giả thuyết',
    '',
    hypothesis,
    '',
    '## Kết quả',
    '',
    'Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).',
    '',
    '## Kết luận',
    '',
    conclusion,
    '',
    '## Tái lập',
    '',
    '```bash',
    `git checkout ${commit.replace('+dirty', '')}`,
    '```',
    '',
    '```bash',
    `npm run bench:experiment -- --id <mã mới> --title "tái lập ${id}" --hypothesis "tái lập" --method ${method}`,
    '```',
    '',
  ].join('\n');
  writeFileSync(join(EXP_DIR, id, 'README.md'), body);
  writeLedger();
  console.log(JSON.stringify({ id, tune: { miss: record.tune.dangerMissCount, faHigh: record.tune.falseAlarmHighCount, acc: record.tune.accuracy }, check: record.check && { miss: record.check.dangerMissCount, faHigh: record.check.falseAlarmHighCount, acc: record.check.accuracy }, sms: record.sms, paired }));
}

main();
