// npm run bench:run -- --configs rules,ai,hybrid,hybrid-veto --models <id1,id2> --split tune [--limit 50] [--repeat 3]
//   Cấu hình phát lại từng tin (mô phỏng phiên thật, chấm theo mốc moc_muc):
//     replay-rules  — chỉ bộ luật, chạy lại sau mỗi tin, qua lớp chống dao động như sản phẩm
//     replay-rules-raw — như trên nhưng KHÔNG qua lớp chống dao động (để đo hiệu quả của lớp này)
//     replay-hybrid — luật + AI theo đúng chính sách gọi AI của sản phẩm (decideAiRun, delta + tóm tắt)
//   --gap-sec 20               (khoảng cách giả lập giữa 2 tin khi phát lại; ảnh hưởng giãn cách gọi AI)
//   --dataset bench|fixtures|set:<tên>|ext:<tên>   (bench = research/data/cases.json; set:<tên> = bộ đề nhập bằng --name)
//   --split dev|test|all|tune|check  (trên tập đã khóa tune/check như set:v2, AI chỉ chạy trên tune; xem check cần --unlock-check)
//   --provider openrouter|groq (mặc định openrouter; groq đọc GROQ_API_KEY, cache riêng ở research/cache/groq)
//   --daily-cap 950            (trần lượt gọi thật/ngày; 45 nếu tài khoản chưa nạp credit)
//   --interval-ms 3200         (khoảng cách giữa các lượt gọi; chỉ giảm khi thử với server giả lập)
// Kết quả (ghi liên tục trong lúc chạy, dừng giữa chừng vẫn còn):
//   research/results/<runId>.jsonl     kết quả từng ca, ghi ngay sau mỗi ca
//   research/results/<runId>.meta.json cấu hình + tiến độ (status running/stopped/finished, done, lastCase)
//   research/results/<runId>.raw.jsonl nguyên văn phản hồi của model cho từng lượt gọi (kể cả lỗi)
//   + một dòng trong research/RUNS.md.
// Lưu bằng chứng lên nhánh research/evidence: npm run bench:archive -- --dot <tên đợt> --runs <runId,...>
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAiResponse } from '@safechat/core/ai';
import { analyze } from '@safechat/core/analyzer';
import type { RiskLevel } from '@safechat/core/types';
import { gatewayBenchRequest, gatewayLevel } from './lib/gateway-bench';
import { benchRequest, hybridHintLevel, hybridLevel, hybridVetoLevel, PROMPT_VERSION, readAiOutcome, type AiOutcome, type BenchConfig } from './lib/bench';
import { arg, CACHE_DIR, hasTuneCheckSplit, loadDataset, loadEnv, RESEARCH_DIR, RESULTS_DIR } from './lib/io';
import { padCases } from './lib/long-cases';
import { caseReplayStats, replayCase, type CaseReplayStats, type ReplayTurn } from './lib/replay';
import { GROQ_LABEL, GROQ_URL } from './providers/groq';
import { DailyCapReached, OpenRouterClient, type ChatResult } from './providers/openrouter';

export interface ResultRow {
  runId: string;
  caseId: string;
  gold: RiskLevel;
  kind: string;
  group: number;
  tags: string[];
  config: BenchConfig;
  model: string;
  repeat: number;
  pred: RiskLevel | null;
  jsonValid?: boolean;
  aiLevel?: RiskLevel | null;
  signals: string[];
  rejected?: number;
  schemaDropped?: number;
  latencyMs?: number;
  cached?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
  /** Chế độ phát lại: mức sau từng tin DP + chỉ số theo diễn biến của ca. */
  turns?: ReplayTurn[];
  replay?: CaseReplayStats;
  dpTurns?: number;
  hasCheckpoints?: boolean;
}

loadEnv();
const dataset = arg('dataset', 'bench')!;
// Chạy thẳng từ file đề (.csv/.xlsx) thì không chia dev/test — ghi nhãn 'file' cho đúng
const split = /\.(csv|xlsx)$/i.test(arg('dataset', 'bench')!) ? 'file' : arg('split', 'dev')!;
const configs = arg('configs', 'rules')!.split(',') as BenchConfig[];
const models = (arg('models', '') ?? '').split(',').filter(Boolean);
const limit = Number(arg('limit', '0'));
const repeats = Math.max(1, Number(arg('repeat', '1')));
const dailyCap = Number(arg('daily-cap', '950'));
// Khoảng cách giữa 2 lượt gọi (mặc định 3,2s = dưới 20 lượt/phút của OpenRouter free)
const intervalMs = Number(arg('interval-ms', '3200'));

const needsAi = configs.some((c) => !['rules', 'replay-rules', 'replay-rules-raw'].includes(c));
const gapSec = Number(arg('gap-sec', '20'));
const unlockCheck = process.argv.includes('--unlock-check');
if (hasTuneCheckSplit(dataset)) {
  if (needsAi && split !== 'tune' && !(split === 'check' && unlockCheck)) {
    console.error(
      `Bộ ${dataset} đã khóa tune/check: cấu hình AI chỉ được chạy trên --split tune (hoặc --split check --unlock-check cho lần xem check duy nhất).`,
    );
    process.exit(1);
  }
  if (!needsAi && split === 'check' && !unlockCheck) {
    console.error(`Bộ ${dataset}: cần cờ --unlock-check khi chạy --split check.`);
    process.exit(1);
  }
}
if (needsAi && !models.length) {
  console.error('Cấu hình ai/hybrid cần --models (xem danh sách: npm run bench:models).');
  process.exit(1);
}
const reasoningEffort = arg('reasoning-effort') as 'low' | 'medium' | 'high' | undefined;
if (reasoningEffort && !['low', 'medium', 'high'].includes(reasoningEffort)) {
  console.error(`Không biết --reasoning-effort ${reasoningEffort}. Dùng low, medium hoặc high.`);
  process.exit(1);
}
const provider = arg('provider', 'openrouter')!;
if (provider !== 'openrouter' && provider !== 'groq') {
  console.error(`Không biết --provider ${provider}. Dùng openrouter hoặc groq.`);
  process.exit(1);
}
const keyName = provider === 'groq' ? 'GROQ_API_KEY' : 'OPENROUTER_API_KEY';
const apiKey = process.env[keyName];
if (needsAi && !apiKey) {
  console.error(`Chưa có ${keyName} (đặt trong research/.env hoặc biến môi trường).`);
  process.exit(1);
}

let commit = 'unknown';
let isDirty = false;
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: RESEARCH_DIR }).toString().trim();
  if (execSync('git status --porcelain -- ../packages/core ../research/lib', { cwd: RESEARCH_DIR }).toString().trim()) {
    commit += '+dirty';
    isDirty = true;
  }
} catch {
  /* không có git */
}
if (needsAi && isDirty && !process.argv.includes('--allow-dirty')) {
  console.error('Thư mục packages/core hoặc research/lib đang có thay đổi chưa commit (+dirty). Hãy commit trước khi chạy AI để số đo tái lập được.');
  process.exit(1);
}

let cases = loadDataset(dataset, split);
const padTo = Number(arg('pad-to', '0'));
if (padTo > 0) cases = padCases(cases, padTo);
if (limit > 0) cases = cases.slice(0, limit);
const runId = arg('run-id') ?? `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${dataset}-${split}`;
mkdirSync(RESULTS_DIR, { recursive: true });
const outFile = join(RESULTS_DIR, `${runId}.jsonl`);
let rowCount = 0;
let errorRows = 0;
const write = (r: ResultRow) => {
  rowCount++;
  if (r.error) errorRows++;
  appendFileSync(outFile, JSON.stringify(r) + '\n');
};
const rawFile = join(RESULTS_DIR, `${runId}.raw.jsonl`);
/** Gọi model và ghi nguyên văn phản hồi (kể cả lỗi) để đối chiếu về sau. */
async function chatLogged(caseId: string, purpose: string, req: { model: string; system: string; user: string; variant: number }) {
  const at = new Date().toISOString();
  const key = OpenRouterClient.key(req, reasoningEffort);
  const head = { at, caseId, purpose, model: req.model, repeat: req.variant, reasoningEffort, key };
  try {
    const res = await client!.chat(req);
    const { content, cached, latencyMs, promptTokens, completionTokens, finishReason, reasoningTokens, jsonFailure } = res;
    appendFileSync(rawFile, JSON.stringify({ ...head, cached, latencyMs, promptTokens, completionTokens, finishReason, reasoningTokens, jsonFailure, content }) + '\n');
    return res;
  } catch (e) {
    appendFileSync(rawFile, JSON.stringify({ ...head, error: (e as Error).message }) + '\n');
    throw e;
  }
}

const lock = dataset.startsWith('ext:') || dataset.startsWith('set:')
  ? join(RESEARCH_DIR, 'data', dataset.startsWith('ext:') ? 'external' : 'sets', dataset.slice(4), 'test.lock')
  : join(RESEARCH_DIR, 'test.lock');
const meta = {
  runId,
  startedAt: new Date().toISOString(),
  dataset,
  split,
  provider,
  configs,
  models,
  reasoningEffort,
  padTo,
  repeats,
  n: cases.length,
  promptVersion: PROMPT_VERSION,
  rulesCommit: commit,
  testLock: existsSync(lock) ? readFileSync(lock, 'utf8').trim().slice(0, 16) : null,
  stoppedEarly: false as boolean | string,
};

const client = needsAi
  ? new OpenRouterClient({
      apiKey: apiKey!,
      cacheDir: provider === 'groq' ? join(CACHE_DIR, 'groq') : CACHE_DIR,
      dailyCap,
      minIntervalMs: intervalMs,
      timeoutMs: 60_000,
      reasoningEffort,
      ...(provider === 'groq'
        ? { baseUrl: GROQ_URL, label: GROQ_LABEL, disableJsonFallback: true, maxCompletionTokens: 2048 }
        : {}),
    })
  : null;
const base = (c: (typeof cases)[number]) => ({ runId, caseId: c.id, gold: c.gold, kind: c.kind, group: c.group, tags: c.tags });

const metaFile = join(RESULTS_DIR, `${runId}.meta.json`);
const saveMeta = (extra: Record<string, unknown>) =>
  writeFileSync(metaFile, JSON.stringify({ ...meta, ...extra, usedToday: client?.usedToday() ?? 0, updatedAt: new Date().toISOString() }, null, 2));
saveMeta({ status: 'running', done: 0 });

console.log(`Chạy ${runId}: ${cases.length} ca × [${configs.join(', ')}]${needsAi ? ` × ${models.length} model × ${repeats} lần` : ''}`);
let done = 0;
outer: for (const c of cases) {
  if (configs.includes('rules')) {
    const r = analyze(c.messages);
    write({ ...base(c), config: 'rules', model: '-', repeat: 0, pred: r.risk_level, signals: r.signals.map((s) => s.type) });
  }
  const replayExtra = (c2: typeof c) => ({
    dpTurns: c2.messages.filter((m) => m.sender === 'other').length,
    hasCheckpoints: !!c2.checkpoints?.length,
  });
  for (const cfg of (['replay-rules', 'replay-rules-raw'] as const).filter((x) => configs.includes(x))) {
    const rr = await replayCase(c, { gapSec, stability: cfg === 'replay-rules' });
    write({
      ...base(c),
      config: cfg,
      model: '-',
      repeat: 0,
      pred: rr.finalLevel,
      signals: analyze(c.messages).signals.map((s) => s.type),
      turns: rr.turns,
      replay: caseReplayStats(c, rr),
      ...replayExtra(c),
    });
  }
  for (const model of models) {
    for (let rep = 0; rep < repeats; rep++) {
      const call = async (hints: boolean): Promise<{ out: AiOutcome; res?: ChatResult; error?: string }> => {
        const req = benchRequest(c.messages, hints);
        try {
          const res = await chatLogged(c.id, hints ? 'hint' : 'single', { model, system: req.system, user: req.user, variant: rep });
          return { out: readAiOutcome(res.content, req, c.messages, model), res };
        } catch (e) {
          if (e instanceof DailyCapReached) throw e;
          return { out: { level: null, parsed: null, jsonValid: false }, error: (e as Error).message };
        }
      };
      const row = (config: BenchConfig, pred: RiskLevel | null, x: Awaited<ReturnType<typeof call>>): ResultRow => ({
        ...base(c),
        config,
        model,
        repeat: rep,
        pred,
        jsonValid: x.out.jsonValid,
        aiLevel: x.out.level,
        signals: x.out.parsed?.signals.map((s) => s.type) ?? [],
        rejected: x.out.parsed?.rejected,
        schemaDropped: x.out.parsed?.schemaDropped,
        latencyMs: x.res?.latencyMs,
        cached: x.res?.cached,
        promptTokens: x.res?.promptTokens,
        completionTokens: x.res?.completionTokens,
        error: x.error ?? x.out.error,
      });
      try {
        if (configs.includes('ai') || configs.includes('hybrid') || configs.includes('hybrid-veto')) {
          const x = await call(false);
          if (configs.includes('ai')) write(row('ai', x.out.level, x));
          if (configs.includes('hybrid')) write(row('hybrid', hybridLevel(c.messages, x.out), x));
          if (configs.includes('hybrid-veto')) write(row('hybrid-veto', hybridVetoLevel(c.messages, x.out), x));
        }
        if (configs.includes('hybrid-hint')) {
          const x = await call(true);
          write(row('hybrid-hint', hybridHintLevel(c.messages, x.out), x));
        }
        if (configs.includes('gateway') || configs.includes('gateway-nocal')) {
          // Prompt quá dài hoặc AI lỗi: sản phẩm giữ kết quả luật, nên dòng đo cũng giữ kết quả luật và ghi lỗi.
          let x: Awaited<ReturnType<typeof call>>;
          try {
            const prompt = gatewayBenchRequest(c.messages);
            const res = await chatLogged(c.id, 'gateway', { model, system: prompt.request.system, user: prompt.request.user, variant: rep });
            try {
              x = { out: { level: null, parsed: parseAiResponse(res.content, prompt.request, c.messages, model), jsonValid: true }, res };
            } catch (e) {
              x = { out: { level: null, parsed: null, jsonValid: false, error: (e as Error).message }, res };
            }
          } catch (e) {
            if (e instanceof DailyCapReached) throw e;
            x = { out: { level: null, parsed: null, jsonValid: false }, error: (e as Error).message };
          }
          if (configs.includes('gateway')) write(row('gateway', gatewayLevel(c.messages, x.out.parsed), x));
          if (configs.includes('gateway-nocal')) write(row('gateway-nocal', gatewayLevel(c.messages, x.out.parsed, false), x));
        }
        if (configs.includes('replay-hybrid')) {
          let tokIn = 0;
          let tokOut = 0;
          let lastErr: string | undefined;
          const rr = await replayCase(c, {
            gapSec,
            callAi: async (req) => {
              try {
                const res = await chatLogged(c.id, 'replay', { model, system: req.system, user: req.user, variant: rep });
                tokIn += res.promptTokens ?? 0;
                tokOut += res.completionTokens ?? 0;
                return res.content;
              } catch (e) {
                if (e instanceof DailyCapReached) throw e;
                lastErr = (e as Error).message;
                throw e;
              }
            },
          });
          write({
            ...base(c),
            config: 'replay-hybrid',
            model,
            repeat: rep,
            pred: rr.finalLevel,
            signals: [],
            promptTokens: tokIn,
            completionTokens: tokOut,
            error: rr.aiErrors ? `${rr.aiErrors} lượt AI lỗi${lastErr ? `: ${lastErr.slice(0, 120)}` : ''}` : undefined,
            turns: rr.turns,
            replay: caseReplayStats(c, rr),
            ...replayExtra(c),
          });
        }
      } catch (e) {
        meta.stoppedEarly = (e as Error).message;
        console.error(`\n⏸ ${(e as Error).message}. Chạy lại cùng lệnh vào ngày mai — các ca đã xong lấy từ cache, không tốn lượt.`);
        break outer;
      }
    }
  }
  ++done;
  saveMeta({ status: 'running', done, lastCase: c.id });
  if (done % 10 === 0) console.log(`  ${done}/${cases.length}${client ? ` · đã dùng hôm nay ${client.usedToday()} lượt` : ''}`);
}

const allFailed = rowCount > 0 && errorRows === rowCount;
saveMeta({ status: meta.stoppedEarly ? 'stopped' : allFailed ? 'failed' : 'finished', finishedAt: new Date().toISOString(), done, rowCount, errorRows });
const runsMd = join(RESEARCH_DIR, 'RUNS.md');
if (!existsSync(runsMd))
  writeFileSync(runsMd, '# Nhật ký các lần chạy\n\n| runId | dataset/split | cấu hình | model | n | lặp | prompt | luật (commit) | ghi chú |\n|---|---|---|---|---|---|---|---|---|\n');
appendFileSync(
  runsMd,
  `| ${runId} | ${dataset}/${split} | ${configs.join(', ')} | ${models.join(', ') || '-'} | ${done}/${cases.length} | ${repeats} | ${PROMPT_VERSION} | ${commit} | ${[meta.stoppedEarly ? 'dừng sớm: ' + meta.stoppedEarly : '', reasoningEffort ? `reasoning ${reasoningEffort}` : '', errorRows ? `${errorRows}/${rowCount} dòng lỗi` : ''].filter(Boolean).join('; ')} |\n`,
);
if (allFailed) {
  console.error(`\nTHẤT BẠI: cả ${rowCount} dòng đều lỗi → ${outFile}. Xem lỗi trong file này, không dùng lần chạy này làm số đo.`);
  process.exitCode = 1;
} else {
  const errors = errorRows ? `, ${errorRows}/${rowCount} dòng lỗi (gồm JSON sai)` : '';
  const head = meta.stoppedEarly ? `DỪNG GIỮA CHỪNG ở ${done}/${cases.length} ca` : `Xong ${done}/${cases.length} ca`;
  console.log(`\n${head}${errors} → ${outFile}\nTạo báo cáo: npm run bench:report -- --runs ${runId}`);
}
