// npm run bench:archive -- --dot dot-03-thu --runs <runId1,runId2> [--title "…"] [--push]
// Đóng gói bằng chứng của một đợt vào nhánh orphan research/evidence (qua git worktree <repo>/.evidence):
//   <dot>_<ngày>/
//     README.md     mục đích + bảng các lần chạy (tự cập nhật giữa 2 dấu <!-- auto:runs -->) + cách tái lập
//     RUNS.md       dòng nhật ký của các lần chạy trong đợt
//     dataset/      bản chụp bộ đề đã dùng + SHA256.txt (hoặc dataset.csv/import-meta/split/test.lock của bench)
//     models/       danh sách model miễn phí tại thời điểm chạy (nếu đã chạy bench:models)
//     results/      <runId>.jsonl (từng ca) · .meta.json (cấu hình, tiến độ) · .raw.jsonl (nguyên văn phản hồi model)
//     reports/      báo cáo Markdown + HTML của đợt
//     analysis/     phân tích viết tay (giữ nguyên, không ghi đè)
// Chạy lại với runId mới → bổ sung vào cùng thư mục đợt. --push: đẩy nhánh research/evidence và tag eval/<dot>.
// --evidence-dir <đường dẫn>: dùng thư mục git khác (để thử). Không bao giờ ghi file .env hay key.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { arg, DATA_DIR, REPORTS_DIR, RESEARCH_DIR, RESULTS_DIR } from './lib/io';

const dot = arg('dot');
const runIds = (arg('runs') ?? '').split(',').filter(Boolean);
if (!dot || !/^dot-[0-9a-z-]+$/.test(dot) || !runIds.length) {
  console.error('Cách dùng: npm run bench:archive -- --dot dot-03-thu --runs <runId1,runId2> [--title "…"] [--push]');
  process.exit(1);
}
const title = arg('title') ?? '';
const push = arg('push') === 'true';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const repoRoot = git(RESEARCH_DIR, 'rev-parse', '--show-toplevel');

// ---------- worktree của nhánh bằng chứng
let ev = arg('evidence-dir');
if (!ev) {
  ev = join(repoRoot, '.evidence');
  if (!existsSync(join(ev, '.git'))) {
    const hasLocal = git(repoRoot, 'branch', '--list', 'research/evidence') !== '';
    git(repoRoot, 'worktree', 'add', ev, hasLocal ? 'research/evidence' : 'origin/research/evidence', ...(hasLocal ? [] : ['-b', 'research/evidence']));
  }
}
ev = resolve(ev);
if (git(ev, 'rev-parse', '--abbrev-ref', 'HEAD') !== 'research/evidence' && !arg('evidence-dir'))
  throw new Error(`${ev} không ở nhánh research/evidence`);
if (git(ev, 'status', '--porcelain')) throw new Error(`Thư mục bằng chứng ${ev} còn thay đổi chưa commit — xử lý trước.`);

// ---------- thư mục đợt
const today = new Date().toISOString().slice(0, 10);
const existing = readdirSync(ev).find((d) => d.startsWith(`${dot}_`) && statSync(join(ev!, d)).isDirectory());
const folder = join(ev, existing ?? `${dot}_${today}`);
for (const sub of ['dataset', 'models', 'results', 'reports', 'analysis']) mkdirSync(join(folder, sub), { recursive: true });

const sha256 = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const copy = (from: string, to: string) => {
  if (!existsSync(from)) return false;
  copyFileSync(from, to);
  return true;
};

// ---------- kết quả từng lần chạy
interface Meta {
  runId: string;
  dataset: string;
  split: string;
  configs: string[];
  models: string[];
  repeats: number;
  n: number;
  done?: number;
  status?: string;
  promptVersion: string;
  rulesCommit: string;
  startedAt: string;
  finishedAt?: string;
  stoppedEarly?: boolean | string;
}
const metas: Meta[] = [];
for (const id of runIds) {
  const m = join(RESULTS_DIR, `${id}.meta.json`);
  if (!existsSync(m)) throw new Error(`Không thấy kết quả của lần chạy ${id} (research/results/${id}.meta.json)`);
  const meta = JSON.parse(readFileSync(m, 'utf8')) as Meta;
  if (meta.status === 'running') console.warn(`⚠ ${id} vẫn đang chạy (hoặc bị ngắt đột ngột) — lưu bản hiện có.`);
  for (const ext of ['.jsonl', '.meta.json', '.raw.jsonl']) copy(join(RESULTS_DIR, id + ext), join(folder, 'results', id + ext));
  metas.push(meta);
}

// ---------- bộ đề
const shaLines: string[] = [];
for (const ds of new Set(metas.map((m) => m.dataset))) {
  if (/\.(csv|xlsx)$/i.test(ds)) {
    const src = resolve(RESEARCH_DIR, '..', ds);
    const file = existsSync(ds) ? ds : src;
    if (copy(file, join(folder, 'dataset', basename(ds)))) shaLines.push(`${sha256(file)}  ${basename(ds)}`);
  } else if (ds.startsWith('ext:')) {
    // Bộ ngoài: luôn lưu manifest (nguồn, giấy phép, sha256 file gốc) + split + khóa test;
    // chỉ lưu bản chụp dữ liệu khi giấy phép cho phép phát tán lại.
    const name = ds.slice(4);
    const dir = join(DATA_DIR, 'external', name);
    const out = join(folder, 'dataset', name);
    mkdirSync(out, { recursive: true });
    for (const f of ['manifest.json', 'split.json', 'test.lock']) copy(join(dir, f), join(out, f));
    const mf = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { redistributable: boolean; sourceFiles: { file: string; sha256: string }[] };
    if (mf.redistributable) copy(join(dir, 'cases.json'), join(out, 'cases.json'));
    for (const s of mf.sourceFiles) shaLines.push(`${s.sha256}  ${name}/${s.file} (file gốc${mf.redistributable ? '' : ', không lưu theo giấy phép'})`);
  } else if (ds.startsWith('set:')) {
    // Bộ đề đặt tên (bench:import --name): bản chụp CSV + meta + split + khóa test
    const name = ds.slice(4);
    const dir = join(DATA_DIR, 'sets', name);
    const out = join(folder, 'dataset', name);
    mkdirSync(out, { recursive: true });
    for (const f of ['dataset.csv', 'import-meta.json', 'split.json', 'test.lock']) copy(join(dir, f), join(out, f));
    if (existsSync(join(dir, 'dataset.csv'))) shaLines.push(`${sha256(join(dir, 'dataset.csv'))}  ${name}/dataset.csv`);
  } else if (ds === 'bench') {
    for (const f of ['dataset.csv', 'import-meta.json', 'split.json']) copy(join(DATA_DIR, f), join(folder, 'dataset', f));
    copy(join(RESEARCH_DIR, 'test.lock'), join(folder, 'dataset', 'test.lock'));
    if (existsSync(join(DATA_DIR, 'dataset.csv'))) shaLines.push(`${sha256(join(DATA_DIR, 'dataset.csv'))}  dataset.csv`);
  }
}
if (shaLines.length) writeFileSync(join(folder, 'dataset', 'SHA256.txt'), shaLines.join('\n') + '\n');

// ---------- danh sách model tại thời điểm chạy
const modelsFile = join(DATA_DIR, 'models.json');
if (existsSync(modelsFile)) {
  const fetchedAt = (JSON.parse(readFileSync(modelsFile, 'utf8')) as { fetchedAt?: string }).fetchedAt ?? today;
  copy(modelsFile, join(folder, 'models', `models_${fetchedAt.slice(0, 10)}.json`));
}

// ---------- báo cáo của toàn đợt (mọi lần chạy đã lưu trong thư mục)
const allRuns = readdirSync(join(folder, 'results'))
  .filter((f) => f.endsWith('.meta.json'))
  .map((f) => f.replace(/\.meta\.json$/, ''));
for (const id of allRuns) copy(join(folder, 'results', `${id}.jsonl`), join(RESULTS_DIR, `${id}.jsonl`)); // báo cáo đọc từ results/
// Bộ dữ liệu ngoài dùng báo cáo riêng (nhãn 2 lớp); đợt có cả hai loại thì tạo 2 báo cáo: <dot> (bộ đề nhóm) và <dot>_ngoai (bộ ngoài)
const isExt = (id: string) => String(JSON.parse(readFileSync(join(folder, 'results', `${id}.meta.json`), 'utf8')).dataset).startsWith('ext:');
const extRuns = allRuns.filter(isExt);
const ownRuns = allRuns.filter((id) => !isExt(id));
const reportJobs = [
  ...(ownRuns.length ? [{ script: 'report.ts', runs: ownRuns, out: dot }] : []),
  ...(extRuns.length ? [{ script: 'report-ext.ts', runs: extRuns, out: ownRuns.length ? `${dot}_ngoai` : dot }] : []),
];
for (const j of reportJobs) {
  execSync(`npx tsx ${j.script} --runs ${j.runs.join(',')} --out ${j.out}`, { cwd: RESEARCH_DIR, stdio: 'inherit', shell: process.platform === 'win32' ? 'cmd.exe' : undefined });
  for (const ext of ['.md', '.html']) copy(join(REPORTS_DIR, j.out + ext), join(folder, 'reports', j.out + ext));
}

// ---------- RUNS.md của đợt
const runsMd = join(RESEARCH_DIR, 'RUNS.md');
const header = '| runId | dataset/split | cấu hình | model | n | lặp | prompt | luật (commit) | ghi chú |\n|---|---|---|---|---|---|---|---|---|';
const want = new Set(allRuns);
const lines = existsSync(runsMd) ? readFileSync(runsMd, 'utf8').split('\n').filter((l) => want.has(l.split('|')[1]?.trim() ?? '')) : [];
const old = existsSync(join(folder, 'RUNS.md')) ? readFileSync(join(folder, 'RUNS.md'), 'utf8').split('\n').filter((l) => /^\| \S/.test(l) && !l.startsWith('| runId')) : [];
const merged = [...new Map([...old, ...lines].map((l) => [l.split('|')[1]!.trim(), l])).values()];
writeFileSync(join(folder, 'RUNS.md'), `# Nhật ký các lần chạy — ${dot}\n\n${header}\n${merged.join('\n')}\n`);

// ---------- README của đợt
const readme = join(folder, 'README.md');
const allMetas = allRuns.map((id) => JSON.parse(readFileSync(join(folder, 'results', `${id}.meta.json`), 'utf8')) as Meta);
const commits = [...new Set(allMetas.map((m) => m.rulesCommit))];
const auto = [
  '<!-- auto:runs -->',
  '| runId | bộ đề / split | cấu hình | model | ca xong | trạng thái | luật (commit) | prompt |',
  '|---|---|---|---|---|---|---|---|',
  ...allMetas.map(
    (m) =>
      `| ${m.runId} | ${basename(m.dataset)} / ${m.split} | ${m.configs.join(', ')} | ${m.models.join(', ') || '-'} | ${m.done ?? '?'}/${m.n} | ${m.status ?? 'finished'}${m.stoppedEarly ? ` (${String(m.stoppedEarly).slice(0, 60)})` : ''} | ${m.rulesCommit} | ${m.promptVersion} |`,
  ),
  '',
  `Báo cáo: ${reportJobs.map((j) => `[reports/${j.out}.md](reports/${j.out}.md) · [HTML](reports/${j.out}.html)`).join(' — ')}. Nguyên văn phản hồi model: \`results/<runId>.raw.jsonl\`.`,
  '',
  `Tái lập: \`git checkout eval/${dot}\` (code ${commits.join(', ')}) rồi chạy lại đúng cấu hình trong bảng — phản hồi model khác nhau giữa các lần gọi, đối chiếu bằng file .raw.jsonl.`,
  '<!-- /auto:runs -->',
].join('\n');
if (!existsSync(readme)) {
  writeFileSync(
    readme,
    `# ${dot}${title ? ` — ${title}` : ''}\n\nNgày: ${today}\n\n## Mục đích\n\n_(điền: câu hỏi của đợt này)_\n\n## Các lần chạy\n\n${auto}\n\n## Kết quả chính\n\n_(điền sau khi đọc báo cáo)_\n\n## Hạn chế\n\n_(điền)_\n`,
  );
} else {
  const s = readFileSync(readme, 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(readme, s.includes('<!-- auto:runs -->') ? s.replace(/<!-- auto:runs -->[\s\S]*<!-- \/auto:runs -->/, auto) : `${s.trimEnd()}\n\n## Các lần chạy\n\n${auto}\n`);
}

// ---------- mục lục ở README gốc của nhánh
const index = join(ev, 'README.md');
if (existsSync(index)) {
  // Chuẩn hóa xuống dòng (git trên Windows có thể đổi thành CRLF) để regex tìm đúng bảng
  const s = readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
  const name = basename(folder);
  if (!s.includes(`(${name}/)`)) {
    const row = `| [${dot.replace(/^dot-/, '')}](${name}/) | ${basename(folder).split('_')[1]} | ${title || '_(điền)_'} | ${[...new Set(allMetas.map((m) => basename(m.dataset)))].join(', ')} | xem README đợt |`;
    const out = s.replace(/(## Các đợt\n\n\|[^\n]*\n\|[^\n]*\n(?:\|[^\n]*\n)*)/, `$1${row}\n`);
    writeFileSync(index, out === s ? `${s.trimEnd()}\n${row}\n` : out);
  }
}

// ---------- kiểm tra không lộ key
for (const f of git(ev, 'ls-files', '--others', '--modified', '--exclude-standard').split('\n').filter(Boolean)) {
  const p = join(ev, f);
  if (statSync(p).size < 50_000_000 && /sk-or-v1-[0-9a-f]{20,}|gsk_[0-9A-Za-z]{20,}/.test(readFileSync(p, 'utf8')))
    throw new Error(`Phát hiện chuỗi giống API key trong ${f} — dừng, không commit.`);
}

// ---------- commit (+ push)
git(ev, 'add', '-A');
if (!git(ev, 'status', '--porcelain')) {
  console.log('Không có gì mới để lưu.');
} else {
  git(ev, 'commit', '-q', '-m', `Bằng chứng ${dot}${title ? `: ${title}` : ''} (${runIds.join(', ')})`);
  console.log(`Đã commit vào ${basename(folder)}/ trên nhánh research/evidence.`);
}
if (push && !arg('evidence-dir')) {
  git(ev, 'push', '-q', 'origin', 'research/evidence');
  const clean = commits.filter((c) => !c.endsWith('+dirty') && c !== 'unknown');
  const tag = `eval/${dot}`;
  if (clean.length === 1 && !git(repoRoot, 'tag', '--list', tag)) {
    git(repoRoot, 'tag', '-a', tag, clean[0]!, '-m', `${dot}${title ? `: ${title}` : ''}`);
    git(repoRoot, 'push', '-q', 'origin', tag);
    console.log(`Đã gắn tag ${tag} → ${clean[0]} và đẩy lên.`);
  } else if (clean.length !== 1) console.warn(`⚠ Không gắn tag ${tag}: các lần chạy dùng ${commits.join(', ')} (cần đúng 1 commit sạch).`);
  console.log('Đã đẩy nhánh research/evidence.');
}
console.log(`Thư mục: ${folder}`);
