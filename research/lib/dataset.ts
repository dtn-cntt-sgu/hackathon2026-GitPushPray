// Bộ đề nghiên cứu: chuyển các dòng CSV (research/dataset/README.md) thành ca kiểm thử đã kiểm tra hợp lệ.
import type { ChatMessage, RiskLevel, ScamStage } from '@safechat/core/types';
import type { CsvRow } from './csv';

export type CaseKind = 'scam' | 'benign_confusable' | 'benign';

export interface BenchCase {
  id: string;
  group: number;
  expectedRule?: string;
  kind: CaseKind;
  messages: ChatMessage[];
  gold: RiskLevel;
  levelA?: RiskLevel;
  levelB?: RiskLevel;
  /** Thứ tự tin DP (đối phương) đầu tiên khiến mức ≥ Cao. */
  dangerTurn?: number;
  stage?: ScamStage;
  /** Bộ đề v2: mức đúng tại từng mốc (sau tin DP thứ dpTurn) — đo cảnh báo sớm, dao động. */
  checkpoints?: { dpTurn: number; level: RiskLevel }[];
  tags: string[];
  source: string;
  note?: string;
  /** Ép ca vào dev/test (cột `split_co_dinh` hoặc `dung_cho`), vd. ca do người viết luật soạn chỉ được ở dev. */
  fixedSplit?: 'dev' | 'test';
}

export const LEVEL_FROM_LABEL: Record<string, RiskLevel> = {
  thap: 'low',
  chu_y: 'attention',
  cao: 'high',
  nghiem_trong: 'critical',
};

const REQUIRED = ['id', 'nhom', 'loai', 'hoi_thoai', 'muc_A', 'muc_B', 'muc_chot', 'nguon'];
const KINDS = new Set<CaseKind>(['scam', 'benign_confusable', 'benign']);
const TAGS = new Set(['teencode', 'khong_dau', 'ngat_chu', 'co_link', 'nhieu_tin', 'chen_lenh', 'sua_sai']);

export interface ImportIssue {
  line: number;
  id?: string;
  message: string;
}

export function parseMessages(text: string): { messages: ChatMessage[]; error?: string } {
  const messages: ChatMessage[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const [i, l] of lines.entries()) {
    const m = /^(DP|TOI)\s*:\s*(.+)$/i.exec(l);
    if (!m) return { messages, error: `tin thứ ${i + 1} không bắt đầu bằng "DP:" hoặc "TOI:" → "${l.slice(0, 40)}"` };
    const seq = messages.length + 1;
    messages.push({
      id: `msg-${String(seq).padStart(3, '0')}`,
      seq,
      sender: m[1]!.toUpperCase() === 'DP' ? 'other' : 'self',
      text: m[2]!.trim(),
    });
  }
  if (messages.length < 2 || messages.length > 15) return { messages, error: `cần 2–15 tin, đang có ${messages.length}` };
  if (!messages.some((m) => m.sender === 'other')) return { messages, error: 'không có tin nào của đối phương (DP:)' };
  return { messages };
}

export function rowsToCases(header: string[], rows: CsvRow[]): { cases: BenchCase[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const missingCols = REQUIRED.filter((c) => !header.includes(c));
  if (missingCols.length) return { cases: [], issues: [{ line: 1, message: `thiếu cột: ${missingCols.join(', ')}` }] };

  const cases: BenchCase[] = [];
  const seen = new Set<string>();
  for (const { line, values: v } of rows) {
    const id = v.id ?? '';
    const err = (message: string) => issues.push({ line, id, message });
    const before = issues.length;

    for (const c of REQUIRED) if (!v[c]) err(`cột "${c}" đang trống`);
    if (id && seen.has(id)) err(`id "${id}" bị trùng`);
    seen.add(id);

    const group = Number(v.nhom);
    if (v.nhom && (!Number.isInteger(group) || group < 0 || group > 8)) err(`nhom phải là 0–8, đang là "${v.nhom}"`);
    const kind = v.loai as CaseKind;
    if (v.loai && !KINDS.has(kind)) err(`loai phải là scam/benign_confusable/benign, đang là "${v.loai}"`);

    const lv = (col: string) => {
      const raw = (v[col] ?? '').toLowerCase();
      if (!raw) return undefined;
      const l = LEVEL_FROM_LABEL[raw];
      if (!l) err(`${col} phải là thap/chu_y/cao/nghiem_trong, đang là "${v[col]}"`);
      return l;
    };
    const levelA = lv('muc_A');
    const levelB = lv('muc_B');
    const gold = lv('muc_chot');
    if (kind === 'scam' && gold === 'low') err('ca "scam" nhưng muc_chot là thap — kiểm tra lại loai hoặc mức');
    if ((kind === 'benign' || kind === 'benign_confusable') && gold && gold !== 'low' && gold !== 'attention')
      err(`ca bình thường nhưng muc_chot là ${v.muc_chot}`);

    const parsed = parseMessages(v.hoi_thoai ?? '');
    if (v.hoi_thoai && parsed.error) err(parsed.error);

    let dangerTurn: number | undefined;
    if (v.tin_nguy_hiem) {
      dangerTurn = Number(v.tin_nguy_hiem);
      const dpCount = parsed.messages.filter((m) => m.sender === 'other').length;
      if (!Number.isInteger(dangerTurn) || dangerTurn < 1 || dangerTurn > dpCount)
        err(`tin_nguy_hiem phải là 1–${dpCount} (đếm tin DP), đang là "${v.tin_nguy_hiem}"`);
    }
    let checkpoints: BenchCase['checkpoints'];
    if (v.moc_muc) {
      const dpCount = parsed.messages.filter((m) => m.sender === 'other').length;
      checkpoints = [];
      for (const part of v.moc_muc.split(';').map((x) => x.trim()).filter(Boolean)) {
        const m = /^(\d+)\s*:\s*([a-z_]+)$/i.exec(part);
        const level = m ? LEVEL_FROM_LABEL[m[2]!.toLowerCase()] : undefined;
        const k = m ? Number(m[1]) : NaN;
        if (!m || !level) err(`moc_muc sai dạng ở "${part}" (đúng: "3:thap;6:chu_y;9:cao")`);
        else if (k < 1 || k > dpCount) err(`moc_muc: mốc ${k} vượt số tin DP (${dpCount})`);
        else if (checkpoints.length && k <= checkpoints.at(-1)!.dpTurn) err('moc_muc: các mốc phải tăng dần');
        else checkpoints.push({ dpTurn: k, level });
      }
      if (checkpoints.length && gold && checkpoints.at(-1)!.dpTurn === dpCount && checkpoints.at(-1)!.level !== gold)
        err('moc_muc: mức ở mốc cuối (tin DP cuối) phải bằng muc_chot');
    }
    const stage = v.giai_doan ? (v.giai_doan.toUpperCase() as ScamStage) : undefined;
    if (stage && !/^S[0-4]$/.test(stage)) err(`giai_doan phải là S0–S4, đang là "${v.giai_doan}"`);
    const tags = (v.bien_the ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean);
    for (const t of tags) if (!TAGS.has(t)) err(`bien_the không hợp lệ: "${t}"`);
    if (v.nguon && !/^(tu_viet|ai_sinh_da_sua|chuyen_the:.+)$/.test(v.nguon)) err(`nguon không hợp lệ: "${v.nguon}"`);
    const fixedRaw = (v.split_co_dinh || v.dung_cho || '').trim();
    if (fixedRaw && fixedRaw !== 'dev' && fixedRaw !== 'test') err(`split_co_dinh / dung_cho phải là dev hoặc test, đang là "${fixedRaw}"`);
    const fixedSplit = fixedRaw === 'dev' || fixedRaw === 'test' ? fixedRaw : undefined;

    if (issues.length === before && gold)
      cases.push({
        id,
        group,
        expectedRule: v.luat_ky_vong && v.luat_ky_vong !== 'none' ? v.luat_ky_vong : undefined,
        kind,
        messages: parsed.messages,
        gold,
        levelA,
        levelB,
        dangerTurn,
        stage,
        checkpoints,
        tags,
        source: v.nguon!,
        note: v.ghi_chu || undefined,
        fixedSplit,
      });
  }
  return { cases, issues };
}
