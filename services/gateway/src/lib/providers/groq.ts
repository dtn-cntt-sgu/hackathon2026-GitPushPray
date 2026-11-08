import type { AiRequest } from '@safechat/core/ai';
import { ProviderError } from '../errors';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_RESPONSE_BYTES = 64 * 1024;
const JSON_NUDGE = 'Chỉ trả về DUY NHẤT JSON đúng schema, không thêm chữ, không markdown fence.';

export interface Completion {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string;
}

export interface GroqOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  /** Mức suy luận của model gpt-oss. Không đặt thì dùng mặc định của Groq. */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

interface GroqResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterFrom(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

function isJsonLike(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return true;
  return /\{[\s\S]*\}/.test(trimmed);
}

async function requestOnce(
  req: AiRequest,
  opts: GroqOptions,
  maxTokens: number,
  deadline: number,
  nudge: boolean,
): Promise<{ data: GroqResponse; latencyMs: number }> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ProviderError('TIMEOUT', 'Hết thời gian chờ Groq');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), remaining);
  const started = Date.now();
  try {
    const messages = [
      { role: 'system', content: req.system },
      ...(nudge ? [{ role: 'system', content: JSON_NUDGE }] : []),
      { role: 'user', content: req.user },
    ];
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        max_tokens: maxTokens,
        ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    const latencyMs = Date.now() - started;
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('MODEL_UNAVAILABLE', `Groq từ chối xác thực (${res.status})`, undefined, res.status);
    }
    if (res.status === 404) {
      throw new ProviderError('MODEL_UNAVAILABLE', `Groq không tìm thấy model ${opts.model}`, undefined, res.status);
    }
    if (res.status === 429) {
      const wait = retryAfterFrom(res) ?? 60;
      throw new ProviderError('QUOTA_EXCEEDED', 'Groq báo vượt hạn mức', wait, 429);
    }
    if (res.status === 400) {
      // Model reasoning có thể dùng hết max_tokens trước khi kịp sinh JSON;
      // Groq trả 400 json_validate_failed thay vì finish_reason=length.
      const raw = await res.text();
      let errorCode = '';
      try {
        errorCode = String((JSON.parse(raw) as { error?: { code?: string } }).error?.code ?? '');
      } catch {
        // body không phải JSON: xử lý như lỗi thường
      }
      if (errorCode === 'json_validate_failed') {
        throw new ProviderError(
          'MODEL_UNAVAILABLE',
          'Groq không tạo được JSON trong giới hạn token',
          undefined,
          400,
          true,
        );
      }
      throw new ProviderError('MODEL_UNAVAILABLE', `Groq trả HTTP ${res.status}`, undefined, res.status);
    }
    if (!res.ok) {
      throw new ProviderError('MODEL_UNAVAILABLE', `Groq trả HTTP ${res.status}`, undefined, res.status);
    }

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_RESPONSE_BYTES) throw new ProviderError('MODEL_UNAVAILABLE', 'Phản hồi Groq quá lớn');
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new ProviderError('MODEL_UNAVAILABLE', 'Phản hồi Groq quá lớn');
    }
    try {
      return { data: JSON.parse(text) as GroqResponse, latencyMs };
    } catch {
      throw new ProviderError('MODEL_UNAVAILABLE', 'Groq trả JSON không hợp lệ');
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error).name === 'AbortError') throw new ProviderError('TIMEOUT', 'Groq quá thời gian chờ');
    throw new ProviderError('MODEL_UNAVAILABLE', 'Không kết nối được Groq');
  } finally {
    clearTimeout(timer);
  }
}

export async function callGroq(req: AiRequest, opts: GroqOptions): Promise<Completion> {
  const deadline = Date.now() + opts.timeoutMs;
  let maxTokens = opts.maxOutputTokens;
  let nudge = false;
  let retried5xx = false;
  let retriedLength = false;
  let retriedJson = false;
  let retriedJsonLimit = false;
  let retried429 = false;

  for (;;) {
    let result: { data: GroqResponse; latencyMs: number };
    try {
      result = await requestOnce(req, opts, maxTokens, deadline, nudge);
    } catch (e) {
      const err = e as ProviderError;
      const remaining = deadline - Date.now();
      if (err.code === 'QUOTA_EXCEEDED' && !retried429 && (err.retryAfterSec ?? 60) <= 2 && remaining > 2500) {
        retried429 = true;
        await sleep((err.retryAfterSec ?? 1) * 1000);
        continue;
      }
      if (err.jsonValidationFailed && !retriedJsonLimit && remaining >= 3000) {
        retriedJsonLimit = true;
        maxTokens = Math.min(8192, maxTokens * 2);
        continue;
      }
      if (err.providerStatus && err.providerStatus >= 500 && !retried5xx && remaining >= 4000) {
        retried5xx = true;
        await sleep(300 + Math.floor(Math.random() * 400));
        continue;
      }
      throw err;
    }

    const choice = result.data.choices?.[0];
    const content = choice?.message?.content;
    if (!content) throw new ProviderError('MODEL_UNAVAILABLE', 'Groq không trả nội dung');
    const remaining = deadline - Date.now();

    if (choice?.finish_reason === 'length' && !retriedLength && remaining >= 3000) {
      retriedLength = true;
      maxTokens = Math.min(8192, maxTokens * 2);
      continue;
    }
    if (!isJsonLike(content) && !retriedJson && remaining >= 3000) {
      retriedJson = true;
      nudge = true;
      continue;
    }
    if (!isJsonLike(content)) throw new ProviderError('MODEL_UNAVAILABLE', 'Groq không trả JSON');

    return {
      content,
      model: opts.model,
      inputTokens: result.data.usage?.prompt_tokens ?? 0,
      outputTokens: result.data.usage?.completion_tokens ?? 0,
      finishReason: choice?.finish_reason,
    };
  }
}
