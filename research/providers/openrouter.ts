// Client OpenRouter (OpenAI-compatible) cho nghiên cứu:
//  - giới hạn 20 req/phút (khoảng cách tối thiểu giữa các lượt), đếm lượt/ngày (lưu file), dừng khi chạm trần;
//  - thử lại khi 429/5xx (lùi dần), có timeout mặc định 60 giây mỗi lượt;
//  - cache phản hồi theo sha256(model + prompt) → chạy lại không tốn lượt;
//  - thử `response_format: json_object`, nếu model không hỗ trợ (400) thì gọi lại không có (tắt với Groq qua disableJsonFallback).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Có thể đổi bằng OPENROUTER_BASE_URL (vd. server giả lập khi thử đường ống). */
export const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  /** Phân biệt các lần chạy lặp (đo độ ổn định) trong cache; không gửi lên API. */
  variant?: number;
}

export interface ChatResult {
  content: string;
  cached: boolean;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** "length" nghĩa là chạm trần token. */
  finishReason?: string;
  reasoningTokens?: number;
  /** Lý do nhà cung cấp từ chối JSON, không chứa nội dung model sinh ra. */
  jsonFailure?: { code?: string; message?: string; generatedChars?: number };
}

/** Lời báo hạn mức của nhà cung cấp: có số đã dùng và thời gian chờ, không chứa nội dung chat. */
function readLimitMessage(body: string): string {
  try {
    return String((JSON.parse(body) as { error?: { message?: string } }).error?.message ?? '').slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function readJsonFailure(body: string): ChatResult['jsonFailure'] {
  try {
    const e = (JSON.parse(body) as { error?: { code?: string; message?: string; failed_generation?: string } }).error;
    return { code: e?.code, message: e?.message?.slice(0, 200), generatedChars: e?.failed_generation?.length };
  } catch {
    return { message: body.slice(0, 200) };
  }
}

export interface ProviderOptions {
  apiKey: string;
  cacheDir: string;
  /** Dùng cho nhà cung cấp tương thích OpenAI khác (Groq). Mặc định OpenRouter. */
  baseUrl?: string;
  label?: string;
  /** Trần lượt gọi thật mỗi ngày (cache trúng không tính). */
  dailyCap: number;
  minIntervalMs?: number;
  maxRetries?: number;
  /** Timeout mỗi lượt gọi mạng (mặc định 60.000 ms). */
  timeoutMs?: number;
  /** Giới hạn token sinh ra (max_completion_tokens) để giữ trong hạn mức và tránh cắt JSON trên model có suy luận. */
  maxCompletionTokens?: number;
  /** Mức suy luận của model có suy luận (gpt-oss). Là một phần của khóa cache vì đổi mức là đổi lần đo. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Tắt việc tự gọi lại không có response_format khi gặp HTTP 400 (dùng cho Groq để không che lỗi JSON). */
  disableJsonFallback?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class DailyCapReached extends Error {}

export class OpenRouterClient {
  private lastCallAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly o: ProviderOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    mkdirSync(join(o.cacheDir, 'responses'), { recursive: true });
  }

  static key(req: ChatRequest, reasoningEffort?: string): string {
    const parts = [req.model, req.system, req.user, req.variant ?? 0, ...(reasoningEffort ? [reasoningEffort] : [])];
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  private usagePath() {
    return join(this.o.cacheDir, 'usage.json');
  }

  usedToday(): number {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (!existsSync(this.usagePath())) return 0;
    const u = JSON.parse(readFileSync(this.usagePath(), 'utf8')) as { date: string; count: number };
    return u.date === today ? u.count : 0;
  }

  private addUsage() {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    writeFileSync(this.usagePath(), JSON.stringify({ date: today, count: this.usedToday() + 1 }));
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const file = join(this.o.cacheDir, 'responses', `${OpenRouterClient.key(req, this.o.reasoningEffort)}.json`);
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, 'utf8')) as Omit<ChatResult, 'cached'>;
      return { ...c, cached: true };
    }
    if (this.usedToday() >= this.o.dailyCap) throw new DailyCapReached(`Đã chạm trần ${this.o.dailyCap} lượt/ngày`);

    let jsonMode = true;
    const maxRetries = this.o.maxRetries ?? 4;
    const timeoutMs = this.o.timeoutMs ?? 60_000;
    for (let attempt = 0; ; attempt++) {
      const wait = (this.o.minIntervalMs ?? 3200) - (this.now() - this.lastCallAt);
      if (wait > 0) await this.sleep(wait);
      this.lastCallAt = this.now();
      const t0 = this.now();
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.o.baseUrl ?? OPENROUTER_URL}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.o.apiKey}`,
          'X-Title': 'SafeChat AI research benchmark',
        },
        body: JSON.stringify({
          model: req.model,
          temperature: 0, // giống cấu hình sản phẩm (services/gateway/src/lib/providers/groq.ts)
          ...(this.o.maxCompletionTokens ? { max_completion_tokens: this.o.maxCompletionTokens } : {}),
          ...(this.o.reasoningEffort ? { reasoning_effort: this.o.reasoningEffort } : {}),
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });
      } catch (e) {
        // Lỗi mạng: thử lại như lỗi 5xx, chưa nhận phản hồi nên không tính lượt.
        if (attempt < maxRetries) {
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        throw e;
      }
      this.addUsage();
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string }; finish_reason?: string }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
          error?: { message?: string };
        };
        const content = data.choices?.[0]?.message?.content;
        const finishReason = data.choices?.[0]?.finish_reason;
        if (content == null) throw new Error(`Phản hồi rỗng (finish_reason ${finishReason ?? 'không rõ'}): ${data.error?.message ?? 'không có nội dung'}`);
        const out = {
          content,
          latencyMs: this.now() - t0,
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          finishReason,
          reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
        };
        writeFileSync(file, JSON.stringify(out));
        return { ...out, cached: false };
      }
      const body = await res.text().catch(() => '');
      const label = this.o.label ?? 'OpenRouter';
      // Groq báo model sinh JSON sai bằng lỗi 400 (json_validate_failed / failed_generation). Đây là kết quả của model,
      // không phải lỗi mạng: lưu thành phản hồi rỗng để bị tính là JSON không hợp lệ.
      if (res.status === 400 && /json_validate_failed|failed_generation|failed to generate json/i.test(body)) {
        const out = { content: '', latencyMs: this.now() - t0, jsonFailure: readJsonFailure(body) };
        writeFileSync(file, JSON.stringify(out));
        return { ...out, cached: false };
      }
      if (res.status === 400 && jsonMode && !this.o.disableJsonFallback && /response_format|json/i.test(body)) {
        jsonMode = false; // model không hỗ trợ chế độ JSON → gọi lại thường
        continue;
      }
      // Hết hạn mức ngày thì thử lại vô ích: dừng an toàn để các ca sau không bị ghi thành lỗi.
      if (res.status === 429 && /per day|\b[RT]PD\b/i.test(body)) throw new DailyCapReached(`${label}: hết hạn mức trong ngày. ${readLimitMessage(body)}`.trim());
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfterSec = Number(res.headers.get('retry-after'));
        await this.sleep(retryAfterSec > 0 ? Math.min(120_000, retryAfterSec * 1000) : Math.min(60_000, 5_000 * 2 ** attempt));
        continue;
      }
      throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /** Danh sách model miễn phí (id kết thúc bằng ":free") kèm giá bản trả phí tương ứng nếu có. */
  async listFreeModels(): Promise<{ id: string; name: string; context: number; paidPrice?: { prompt: number; completion: number } }[]> {
    const res = await this.fetchImpl(`${OPENROUTER_URL}/models`, {
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
      headers: { Authorization: `Bearer ${this.o.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const data = (await res.json()) as {
      data: { id: string; name: string; context_length: number; pricing?: { prompt: string; completion: string } }[];
    };
    const byId = new Map(data.data.map((m) => [m.id, m]));
    return data.data
      .filter((m) => m.id.endsWith(':free'))
      .map((m) => {
        const paid = byId.get(m.id.replace(/:free$/, ''));
        return {
          id: m.id,
          name: m.name,
          context: m.context_length,
          paidPrice: paid?.pricing ? { prompt: Number(paid.pricing.prompt), completion: Number(paid.pricing.completion) } : undefined,
        };
      });
  }
}
