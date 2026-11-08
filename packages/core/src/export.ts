// Tạo báo cáo xuất theo yêu cầu của người dùng (HTML/JSON). Extension không giữ bản sao file xuất.
import type { AnalysisResult, ChatMessage, UserMark } from './types';
import { RISK_LEVEL_LABEL, STAGE_LABEL } from './types';

export type ExportScope = 'full' | 'alerts_only';

export interface ExportInput {
  threadLabel: string;
  startedAt: number;
  exportedAt: number;
  messages: ChatMessage[];
  result: AnalysisResult | null;
  marks: Record<string, UserMark>;
  scope: ExportScope;
  aiUsed: boolean;
}

const DISCLAIMER =
  'Báo cáo do SafeChat AI (bản mẫu) tạo từ phần tin nhắn extension đọc được. Điểm là điểm dấu hiệu, không phải xác suất phạm tội hay xác nhận an toàn. Kết quả có thể bỏ sót hoặc cảnh báo nhầm; không thay thế xác minh độc lập, tư vấn pháp lý hay cơ quan chức năng.';

const MARK_LABEL: Record<UserMark, string> = {
  verified: 'Đã xác minh',
  not_relevant: 'Không liên quan',
  review: 'Cần xem lại',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function evidenceIds(input: ExportInput): Set<string> {
  return new Set(input.result?.signals.flatMap((s) => s.evidence_message_ids) ?? []);
}

export function exportJson(input: ExportInput): string {
  const ids = evidenceIds(input);
  const messages = input.scope === 'full' ? input.messages : input.messages.filter((m) => ids.has(m.id));
  return JSON.stringify(
    {
      generator: 'SafeChat AI (prototype)',
      disclaimer: DISCLAIMER,
      thread_label: input.threadLabel,
      session_started_at: new Date(input.startedAt).toISOString(),
      exported_at: new Date(input.exportedAt).toISOString(),
      scope: input.scope,
      ai_used: input.aiUsed,
      analysis: input.result,
      user_marks: input.marks,
      messages,
    },
    null,
    2,
  );
}

export function exportHtml(input: ExportInput): string {
  const r = input.result;
  const ids = evidenceIds(input);
  const messages = input.scope === 'full' ? input.messages : input.messages.filter((m) => ids.has(m.id));
  const e = escapeHtml;
  const senderLabel = { self: 'Bạn', other: 'Đối phương', unknown: 'Chưa rõ' } as const;
  const date = (t: number) => new Date(t).toLocaleString('vi-VN');

  const signals = (r?.signals ?? [])
    .map((s) => {
      const mark = input.marks[`${s.type}:${s.evidence_message_ids[0] ?? ''}`];
      const quotes = s.evidence_message_ids
        .map((id, i) => `<li><code>${e(id)}</code> “${e(s.evidence_quotes[i] ?? '')}”</li>`)
        .join('');
      return `<section class="sig sev-${s.severity}">
  <h3>${e(s.title)} <small>(${e(s.severity)}${s.ref ? `, ${e(s.ref)}` : ''}${s.source === 'ai' ? ', AI' : ''}${s.mitigation ? ', đã hạ mức theo ngữ cảnh' : ''})</small>${mark ? ` <span class="mark">${e(MARK_LABEL[mark])}</span>` : ''}</h3>
  <p>${e(s.explanation)}</p>
  <ul>${quotes}</ul>
  <p><b>Nên làm:</b> ${e(s.recommended_action)}</p>
</section>`;
    })
    .join('\n');

  const rows = messages
    .map(
      (m) =>
        `<tr class="${ids.has(m.id) ? 'flag' : ''}"><td><code>${e(m.id)}</code></td><td>${senderLabel[m.sender]}</td><td>${e(m.text)}</td></tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Báo cáo SafeChat AI</title>
<style>
body{font-family:system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1d2330;background:#fff;line-height:1.5}
h1{font-size:22px;margin-bottom:4px} .meta{color:#5a6372;font-size:13px}
.level{display:inline-block;padding:4px 10px;border-radius:6px;font-weight:600;background:#eef1f6}
.disc{font-size:13px;background:#f6f7f9;border-left:3px solid #8a93a3;padding:8px 12px}
.sig{border:1px solid #dde2ea;border-radius:8px;padding:10px 14px;margin:10px 0}
.sev-critical{border-left:5px solid #b3261e}.sev-high{border-left:5px solid #d9730d}.sev-medium{border-left:5px solid #c9a227}
.mark{font-size:12px;background:#e8f0fe;padding:2px 6px;border-radius:4px}
table{border-collapse:collapse;width:100%;font-size:14px} td{border-bottom:1px solid #eceff3;padding:6px;vertical-align:top}
tr.flag td{background:#fff6e5} code{font-size:12px;color:#5a6372}
</style></head><body>
<h1>Báo cáo SafeChat AI</h1>
<p class="meta">Cuộc trò chuyện: ${e(input.threadLabel)} · Bắt đầu theo dõi: ${e(date(input.startedAt))} · Xuất lúc: ${e(date(input.exportedAt))} · Phạm vi: ${input.scope === 'full' ? 'toàn bộ bản nháp' : 'chỉ cảnh báo và bằng chứng'}${input.aiUsed ? ' · Có dùng phân tích AI bên ngoài (Groq)' : ''}</p>
<p class="disc">${e(DISCLAIMER)}</p>
${
  r
    ? `<h2>Tổng quan</h2>
<p><span class="level">${e(RISK_LEVEL_LABEL[r.risk_level])}</span> · Điểm dấu hiệu ${r.score}/100 · Đã phân tích ${r.analyzed_message_count} tin</p>
<p><b>Vì sao:</b> ${e(r.level_reason)}</p>
<p><b>Tiến trình kịch bản:</b> ${r.stages_reached.length ? r.stages_reached.map((x) => `${e(x.stage)} ${e(STAGE_LABEL[x.stage])} (từ ${e(x.first_message_id)})`).join(' → ') : 'chưa xác định'}</p>
${r.uncertainties.length ? `<p><b>Chưa chắc chắn:</b></p><ul>${r.uncertainties.map((u) => `<li>${e(u)}</li>`).join('')}</ul>` : ''}
<h2>Tín hiệu và bằng chứng</h2>
${signals || '<p>Không có tín hiệu trong phần đã đọc.</p>'}
<h2>Việc nên làm</h2><ul>${r.advice.actions.map((a) => `<li>${e(a)}</li>`).join('')}</ul>`
    : '<p>Chưa có kết quả phân tích.</p>'
}
<h2>${input.scope === 'full' ? 'Bản nháp tin nhắn' : 'Tin nhắn liên quan'}</h2>
<table>${rows || '<tr><td>Không có tin nhắn.</td></tr>'}</table>
</body></html>`;
}
