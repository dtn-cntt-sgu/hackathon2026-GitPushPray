// Context Manager: đóng gói / khôi phục ngữ cảnh một phiên theo dõi để "tải bản nháp lên tiếp tục".
// Ảnh chụp gồm bản nháp tin nhắn (kèm khóa khử trùng lặp), tóm tắt + tín hiệu AI, đánh dấu của người dùng,
// diễn biến và trạng thái chống dao động. Kết quả phân tích KHÔNG lưu — được tính lại từ bản nháp khi khôi phục.
// File do người dùng chủ động lưu về máy; khi đọc lại coi là dữ liệu không đáng tin → kiểm tra chặt từng trường.
import type { StabilityState } from './stability';
import type { TranscriptState } from './transcript';
import type { ChatMessage, RiskLevel, Sender, Signal, SignalCategory, UserMark } from './types';

export const SNAPSHOT_FORMAT = 'safechat-session';
export const SNAPSHOT_VERSION = 1;
const MAX_MESSAGES = 300;
const MAX_TEXT = 5000;

export interface SnapshotAi {
  summary: string;
  signals: Signal[];
  uncertainties: string[];
  lastSeq: number;
  calls: number;
  downgrade?: { reason: string; fromLevel: RiskLevel };
}

export interface SessionSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  savedAt: string;
  threadLabel: string;
  platform: 'messenger' | 'mock';
  startedAt: number;
  maxMessages: number;
  transcript: TranscriptState;
  ai: SnapshotAi;
  marks: Record<string, UserMark>;
  timeline: { seq: number; messageId: string; level: RiskLevel; score: number; newSignals: string[]; note?: string }[];
  stability?: StabilityState;
  /** FNV-1a của nội dung (không gồm trường này) — phát hiện file bị sửa/hỏng, KHÔNG phải chữ ký bảo mật. */
  checksum: string;
}

export type SnapshotInput = Omit<SessionSnapshot, 'format' | 'version' | 'savedAt' | 'checksum'>;

function fnv1a(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** JSON ổn định (khóa đối tượng sắp xếp) để checksum không phụ thuộc thứ tự trường. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

export function createSnapshot(input: SnapshotInput, now = new Date()): SessionSnapshot {
  const body = { format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, savedAt: now.toISOString(), ...input } as const;
  return { ...body, checksum: fnv1a(canonical(body)) };
}

export function serializeSnapshot(s: SessionSnapshot): string {
  return JSON.stringify(s, null, 2);
}

// ---------------------------------------------------------------- đọc & kiểm tra

export class SnapshotError extends Error {}

const LEVELS = new Set<RiskLevel>(['low', 'attention', 'high', 'critical']);
const SENDERS = new Set<Sender>(['self', 'other', 'unknown']);
const MARKS = new Set<UserMark>(['verified', 'not_relevant', 'review']);
const CATS = new Set<SignalCategory>(['finance', 'account', 'identity', 'job_terms', 'pressure', 'isolation', 'contradiction', 'impersonation', 'technical', 'investment']);

const str = (v: unknown, max = MAX_TEXT): string => {
  if (typeof v !== 'string') throw new SnapshotError('Trường văn bản không hợp lệ');
  return v.slice(0, max);
};
const num = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SnapshotError('Trường số không hợp lệ');
  return v;
};
const level = (v: unknown): RiskLevel => {
  if (!LEVELS.has(v as RiskLevel)) throw new SnapshotError('Mức cảnh báo không hợp lệ');
  return v as RiskLevel;
};
const arr = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v)) throw new SnapshotError('Trường danh sách không hợp lệ');
  return v.slice(0, max);
};
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SnapshotError('Trường đối tượng không hợp lệ');
  return v as Record<string, unknown>;
};

function readSignal(v: unknown): Signal {
  const s = obj(v);
  const ids = arr(s.evidence_message_ids, 50).map((x) => str(x, 20));
  const quotes = arr(s.evidence_quotes, 50).map((x) => str(x, 300));
  if (!CATS.has(s.category as SignalCategory)) throw new SnapshotError('Nhóm tín hiệu không hợp lệ');
  if (!['low', 'medium', 'high', 'critical'].includes(String(s.severity))) throw new SnapshotError('Mức tín hiệu không hợp lệ');
  return {
    type: `ai_${str(s.type, 60).replace(/^ai_/, '').replace(/[^a-z0-9_]/gi, '')}`,
    category: s.category as SignalCategory,
    severity: s.severity as Signal['severity'],
    title: str(s.title, 120),
    explanation: str(s.explanation, 600),
    evidence_message_ids: ids,
    evidence_quotes: quotes,
    recommended_action: str(s.recommended_action, 300),
    // Chỉ khôi phục tín hiệu AI; tín hiệu luật luôn được tính lại từ bản nháp
    source: 'ai',
    confidence: typeof s.confidence === 'number' ? Math.max(0, Math.min(1, s.confidence)) : undefined,
  };
}

/** Đọc + kiểm tra ảnh chụp từ chuỗi JSON. Ném SnapshotError (thông báo tiếng Việt) nếu không hợp lệ. */
export function parseSnapshot(json: string): SessionSnapshot {
  if (json.length > 5_000_000) throw new SnapshotError('File quá lớn');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SnapshotError('File không phải JSON hợp lệ');
  }
  const r = obj(raw);
  if (r.format !== SNAPSHOT_FORMAT) throw new SnapshotError('Đây không phải file phiên SafeChat AI (có thể là file báo cáo)');
  if (r.version !== SNAPSHOT_VERSION) throw new SnapshotError(`Phiên bản file ${String(r.version)} chưa được hỗ trợ`);
  const { checksum, ...body } = r;
  if (typeof checksum !== 'string' || fnv1a(canonical(body)) !== checksum)
    throw new SnapshotError('File đã bị chỉnh sửa hoặc hỏng (mã kiểm tra không khớp)');

  const t = obj(r.transcript);
  const messages: ChatMessage[] = arr(t.messages, MAX_MESSAGES).map((m) => {
    const o = obj(m);
    if (!SENDERS.has(o.sender as Sender)) throw new SnapshotError('Người gửi không hợp lệ');
    const id = str(o.id, 20);
    if (!/^msg-\d{3,}$/.test(id)) throw new SnapshotError('Mã tin nhắn không hợp lệ');
    return { id, seq: num(o.seq), sender: o.sender as Sender, text: str(o.text), timestamp: typeof o.timestamp === 'string' ? str(o.timestamp, 40) : undefined, ...(Array.isArray(o.links) ? { links: o.links.slice(0, 10).map((l) => str(l, 2048)) } : {}) };
  });
  const keys = arr(t.keys, MAX_MESSAGES).map((k) => str(k, MAX_TEXT + 40));
  if (keys.length !== messages.length) throw new SnapshotError('Bản nháp không nhất quán');
  for (let i = 1; i < messages.length; i++)
    if (messages[i]!.seq <= messages[i - 1]!.seq) throw new SnapshotError('Thứ tự tin nhắn không hợp lệ');
  const nextSeq = num(t.nextSeq);
  if (messages.length && nextSeq <= messages.at(-1)!.seq) throw new SnapshotError('Bản nháp không nhất quán');

  const a = obj(r.ai);
  const ids = new Set(messages.map((m) => m.id));
  const ai: SnapshotAi = {
    summary: str(a.summary, 1000),
    // Tín hiệu AI chỉ giữ khi mọi bằng chứng trỏ tới tin còn trong bản nháp
    signals: arr(a.signals, 20).map(readSignal).filter((s) => s.evidence_message_ids.every((id) => ids.has(id))),
    uncertainties: arr(a.uncertainties, 8).map((x) => str(x, 300)),
    lastSeq: num(a.lastSeq),
    calls: num(a.calls),
    downgrade: a.downgrade ? { reason: str(obj(a.downgrade).reason, 200), fromLevel: level(obj(a.downgrade).fromLevel) } : undefined,
  };

  const marks: Record<string, UserMark> = {};
  for (const [k, v] of Object.entries(obj(r.marks)).slice(0, 200)) if (MARKS.has(v as UserMark)) marks[str(k, 100)] = v as UserMark;

  const timeline = arr(r.timeline, 100).map((x) => {
    const o = obj(x);
    return {
      seq: num(o.seq),
      messageId: str(o.messageId, 20),
      level: level(o.level),
      score: num(o.score),
      newSignals: arr(o.newSignals, 20).map((y) => str(y, 120)),
      note: typeof o.note === 'string' ? str(o.note, 200) : undefined,
    };
  });

  let stability: StabilityState | undefined;
  if (r.stability) {
    const st = obj(r.stability);
    stability = {
      displayed: level(st.displayed),
      maxLevel: level(st.maxLevel),
      lastEvalKey: str(st.lastEvalKey, 40),
      recentRaw: arr(st.recentRaw, 4).map(level),
      pendingUp: st.pendingUp ? { level: level(obj(st.pendingUp).level), confirmations: num(obj(st.pendingUp).confirmations) } : undefined,
    };
  }

  const platform = r.platform === 'mock' ? 'mock' : 'messenger';
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    savedAt: str(r.savedAt, 40),
    threadLabel: str(r.threadLabel, 200),
    platform,
    startedAt: num(r.startedAt),
    maxMessages: Math.max(20, Math.min(MAX_MESSAGES, num(r.maxMessages))),
    transcript: { messages, keys, nextSeq },
    ai,
    marks,
    timeline,
    stability,
    checksum,
  };
}

/** Tóm tắt để hiển thị trước khi người dùng xác nhận khôi phục. */
export function describeSnapshot(s: SessionSnapshot): { messages: number; savedAt: string; label: string; maxLevel: RiskLevel; aiSignals: number } {
  return {
    messages: s.transcript.messages.length,
    savedAt: s.savedAt,
    label: s.threadLabel,
    maxLevel: s.stability?.maxLevel ?? s.timeline.at(-1)?.level ?? 'low',
    aiSignals: s.ai.signals.length,
  };
}
