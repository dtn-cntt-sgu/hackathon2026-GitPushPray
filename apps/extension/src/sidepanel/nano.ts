// Chạy Gemini Nano qua Chrome Prompt API trong side panel (API không khả dụng trong service worker).
// Tiếng Việt chưa nằm trong danh sách ngôn ngữ hỗ trợ (de, en, es, fr, ja) — khai báo 'vi' làm Chrome
// ghi lỗi vào trang Tiện ích dù đã bắt ngoại lệ → chỉ khai báo 'en' (chế độ thử nghiệm, tin vẫn gửi nguyên
// văn tiếng Việt). Mọi kết quả vẫn qua kiểm tra trích dẫn ở background.
import { AI_RESPONSE_SCHEMA, type AiRequest } from '@safechat/core/ai';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface LMSession {
  prompt(input: string, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface LMStatic {
  availability(opts?: unknown): Promise<Availability>;
  create(opts?: unknown): Promise<LMSession>;
}
declare global {
  // eslint-disable-next-line no-var
  var LanguageModel: LMStatic | undefined;
}

const io = (lang: string) => ({
  expectedInputs: [{ type: 'text', languages: [lang] }],
  expectedOutputs: [{ type: 'text', languages: [lang] }],
});

export interface NanoStatus {
  supported: boolean;
  availability: Availability;
  lang: 'vi' | 'en' | null;
  /** true khi phải chạy bằng 'en' vì 'vi' chưa được hỗ trợ. */
  experimental: boolean;
}

export async function nanoStatus(): Promise<NanoStatus> {
  const LM = globalThis.LanguageModel;
  if (!LM) return { supported: false, availability: 'unavailable', lang: null, experimental: false };
  try {
    const a = await LM.availability(io('en'));
    if (a !== 'unavailable') return { supported: true, availability: a, lang: 'en', experimental: true };
  } catch {
    /* API thay đổi/không khả dụng */
  }
  return { supported: true, availability: 'unavailable', lang: null, experimental: false };
}

/** Tải mô hình (cần thao tác của người dùng). onProgress nhận 0..1. */
export async function downloadNano(lang: 'vi' | 'en', onProgress: (p: number) => void): Promise<void> {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error('Trình duyệt không hỗ trợ Prompt API');
  const s = await LM.create({
    ...io(lang),
    monitor(m: EventTarget) {
      m.addEventListener('downloadprogress', (e) => onProgress((e as ProgressEvent).loaded));
    },
  });
  s.destroy();
}

const TIMEOUT_MS = 45_000;

export async function runNano(req: AiRequest, lang: 'vi' | 'en'): Promise<string> {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error('Prompt API không khả dụng');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const session = await LM.create({ ...io(lang), initialPrompts: [{ role: 'system', content: req.system }], signal: ctrl.signal });
  try {
    return await session.prompt(req.user, { responseConstraint: AI_RESPONSE_SCHEMA, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    session.destroy();
  }
}
