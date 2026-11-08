// npm run bench:report-ext -- --runs <runId1,runId2> [--out <tên>]
// Báo cáo cho bộ dữ liệu NGOÀI (nhãn 2 lớp): bắt được / báo nhầm ở 2 ngưỡng (≥ Cần chú ý, ≥ Cao) kèm khoảng tin cậy,
// phân bố mức, bắt được theo nhóm kịch bản. Tín hiệu gây báo nhầm chỉ liệt kê cho split dev (để sửa luật).
// KHÔNG in nội dung tin nhắn (giấy phép của bộ ngoài + không đọc ca test).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from '@safechat/core/export';
import { RISK_LEVEL_LABEL, type RiskLevel } from '@safechat/core/types';
import { binaryMetrics, flagged } from './lib/binary';
import { arg, DATA_DIR, REPORTS_DIR, RESULTS_DIR } from './lib/io';
import type { ResultRow } from './run';

const runIds = (arg('runs') ?? '').split(',').filter(Boolean);
if (!runIds.length) {
  console.error('Cách dùng: npm run bench:report-ext -- --runs <runId1,runId2> [--out <tên>]');
  process.exit(1);
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (c: [number, number]) => `${(c[0] * 100).toFixed(1)}–${(c[1] * 100).toFixed(1)}`;
const LV: RiskLevel[] = ['low', 'attention', 'high', 'critical'];

type Block = { h: string } | { p: string } | { table: string[][] };
const blocks: Block[] = [];
const date = new Date().toISOString().slice(0, 10);
blocks.push({ p: `Ngày tạo: ${date}. Nhãn của bộ dữ liệu ngoài chỉ có 2 lớp (lừa đảo / bình thường), nên chấm "có cảnh báo hay không" ở 2 ngưỡng; không chấm 4 mức.` });

const runs = runIds.map((id) => {
  const meta = JSON.parse(readFileSync(join(RESULTS_DIR, `${id}.meta.json`), 'utf8')) as { dataset: string; split: string; configs: string[]; models: string[]; rulesCommit: string; done?: number; n: number };
  const rows = readFileSync(join(RESULTS_DIR, `${id}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ResultRow)
    .filter((r) => r.repeat === 0);
  const mf = join(DATA_DIR, 'external', meta.dataset.replace(/^ext:/, ''), 'manifest.json');
  const manifest = existsSync(mf) ? (JSON.parse(readFileSync(mf, 'utf8')) as { title: string; url: string; license: string; notes: string[]; revision: string | null; kind?: string; inScope?: boolean }) : null;
  return { id, meta, rows, manifest };
});

// ---------- nguồn dữ liệu
blocks.push({ h: 'Nguồn dữ liệu' });
const seen = new Set<string>();
blocks.push({
  table: [
    ['Bộ', 'Nguồn', 'Phiên bản', 'Giấy phép', 'Phạm vi sản phẩm'],
    ...runs
      .filter((r) => r.manifest && !seen.has(r.meta.dataset) && seen.add(r.meta.dataset))
      .map((r) => [
        r.meta.dataset,
        `${r.manifest!.title} — ${r.manifest!.url}`,
        r.manifest!.revision?.slice(0, 12) ?? '–',
        r.manifest!.license,
        r.manifest!.inScope === false || r.manifest!.kind === 'call' ? 'Ngoài phạm vi (cuộc gọi) — chỉ tham khảo' : 'Trong phạm vi (tin nhắn)',
      ]),
  ],
});
for (const r of runs.filter((x, i) => x.manifest && runs.findIndex((y) => y.meta.dataset === x.meta.dataset) === i))
  for (const n of r.manifest!.notes) blocks.push({ p: `${r.meta.dataset}: ${n}` });

// ---------- tổng quan
blocks.push({ h: 'Kết quả 2 lớp' });
const head = ['Lần chạy', 'Bộ / split', 'Cấu hình', 'Ngưỡng', 'Ca (LĐ/BT)', 'Bắt được [KTC 95%]', 'Báo nhầm [KTC 95%]', 'Precision', 'F1'];
const overview: string[][] = [head];
for (const r of runs) {
  const groups = new Map<string, ResultRow[]>();
  for (const x of r.rows) groups.set(`${x.config}|${x.model}`, [...(groups.get(`${x.config}|${x.model}`) ?? []), x]);
  for (const [key, rs] of groups)
    for (const t of ['attention', 'high'] as const) {
      const m = binaryMetrics(rs, t);
      overview.push([
        r.id,
        `${r.meta.dataset} / ${r.meta.split}`,
        key.replace('|-', '').replace('|', ' · '),
        `≥ ${RISK_LEVEL_LABEL[t]}`,
        `${m.n} (${m.pos}/${m.neg})`,
        m.pos ? `${pct(m.recall)} [${ci(m.recallCI)}]` : '–',
        m.neg ? `${pct(m.fpr)} [${ci(m.fprCI)}]` : '–',
        m.pos && m.tp + m.fp ? pct(m.precision) : '–',
        m.pos ? m.f1.toFixed(3) : '–',
      ]);
    }
}
blocks.push({ table: overview });

// ---------- phân bố mức
blocks.push({ h: 'Phân bố mức cảnh báo' });
blocks.push({
  table: [
    ['Lần chạy', 'Nhãn', 'n', ...LV.map((l) => RISK_LEVEL_LABEL[l]), 'Lỗi'],
    ...runs.flatMap((r) =>
      (['scam', 'benign'] as const).map((k) => {
        const rs = r.rows.filter((x) => (k === 'scam' ? x.kind === 'scam' : x.kind !== 'scam'));
        return [r.id, k === 'scam' ? 'Lừa đảo' : 'Bình thường', String(rs.length), ...LV.map((l) => String(rs.filter((x) => x.pred === l).length)), String(rs.filter((x) => !x.pred).length)];
      }),
    ),
  ],
});

// ---------- theo nhóm kịch bản (thẻ đầu tiên của ca)
for (const r of runs) {
  const cats = [...new Set(r.rows.filter((x) => x.kind === 'scam').map((x) => x.tags[0] ?? '–'))];
  if (cats.length < 2) continue;
  blocks.push({ h: `Bắt được theo nhóm kịch bản — ${r.id}` });
  blocks.push({
    table: [
      ['Nhóm', 'n', 'Bắt được (≥ Cần chú ý)', 'Bắt được (≥ Cao)'],
      ...cats
        .map((c) => {
          const rs = r.rows.filter((x) => x.kind === 'scam' && (x.tags[0] ?? '–') === c);
          return { c, n: rs.length, a: rs.filter((x) => flagged(x.pred, 'attention')).length, h: rs.filter((x) => flagged(x.pred, 'high')).length };
        })
        .sort((a, b) => b.n - a.n)
        .map((x) => [x.c, String(x.n), `${x.a} (${pct(x.a / x.n)})`, `${x.h} (${pct(x.h / x.n)})`]),
    ],
  });
}

// ---------- tín hiệu gây báo nhầm / tín hiệu khi bắt được (chỉ dev)
for (const r of runs.filter((x) => x.meta.split === 'dev')) {
  const fpSig = new Map<string, number>();
  const tpSig = new Map<string, number>();
  for (const x of r.rows) {
    if (!flagged(x.pred, 'attention')) continue;
    const m = x.kind === 'scam' ? tpSig : fpSig;
    for (const s of new Set(x.signals)) m.set(s, (m.get(s) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  blocks.push({ h: `Tín hiệu xuất hiện ở ca có cảnh báo — ${r.id} (dev, để phân tích lỗi)` });
  const a = top(fpSig);
  const b = top(tpSig);
  blocks.push({
    table: [
      ['#', 'Gây báo nhầm (ca bình thường)', 'Số ca', 'Ở ca lừa đảo bắt được', 'Số ca'],
      ...Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [String(i + 1), a[i]?.[0] ?? '', a[i] ? String(a[i]![1]) : '', b[i]?.[0] ?? '', b[i] ? String(b[i]![1]) : '']),
    ],
  });
}

blocks.push({ h: 'Cách đọc' });
blocks.push({ p: 'Bắt được = tỷ lệ ca nhãn lừa đảo mà hệ thống có cảnh báo; Báo nhầm = tỷ lệ ca nhãn bình thường bị cảnh báo. [KTC 95%] là khoảng tin cậy bootstrap. Ngưỡng ≥ Cần chú ý tương ứng "có hiện cảnh báo"; ≥ Cao là mức có yêu cầu rủi ro cụ thể.' });
blocks.push({ p: 'Chỉ chỉnh luật dựa trên split dev. Split test chỉ để trình bày; không xem chi tiết ca test khi sửa luật.' });

// ---------- xuất
const md = blocks
  .map((b) =>
    'h' in b ? `## ${b.h}` : 'p' in b ? b.p : [b.table[0]!, b.table[0]!.map(() => '---'), ...b.table.slice(1)].map((row) => `| ${row.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`).join('\n'),
  )
  .join('\n\n');
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đánh giá trên dữ liệu ngoài — SafeChat AI</title>
<style>
:root{--bg:#fff;--fg:#1d2330;--muted:#5a6372;--line:#e3e7ee;--head:#f3f5f9}
@media (prefers-color-scheme:dark){:root{--bg:#15181e;--fg:#e6e9ef;--muted:#9aa3b2;--line:#323846;--head:#1e222a}}
body{font:14px/1.5 system-ui,sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;background:var(--bg);color:var(--fg)}
h2{font-size:18px;margin-top:28px} p{color:var(--muted)}
.wrap{overflow-x:auto} table{border-collapse:collapse;font-size:13px;min-width:100%}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:var(--head)}
</style></head><body><h1>Đánh giá trên dữ liệu ngoài</h1>
${blocks
  .map((b) =>
    'h' in b
      ? `<h2>${escapeHtml(b.h)}</h2>`
      : 'p' in b
        ? `<p>${escapeHtml(b.p)}</p>`
        : `<div class="wrap"><table><thead><tr>${b.table[0]!.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${b.table
            .slice(1)
            .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></div>`,
  )
  .join('\n')}
</body></html>`;
mkdirSync(REPORTS_DIR, { recursive: true });
const base = join(REPORTS_DIR, arg('out') ?? `${date}_ext_${runIds.length === 1 ? runIds[0] : `${runIds.length}-runs`}`);
writeFileSync(`${base}.md`, `# Đánh giá trên dữ liệu ngoài\n\n${md}\n`);
writeFileSync(`${base}.html`, html);
console.log(`Báo cáo: ${base}.md\n         ${base}.html`);
