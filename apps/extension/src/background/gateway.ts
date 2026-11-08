// Client gateway SafeChat (AWS). Extension KHÔNG giữ khóa model và không gọi thẳng
// Groq/Bedrock. Chỉ gửi phần delta đã che PII theo hợp đồng @safechat/contracts.
import type {
  AnalysisRequest,
  AnalysisResponse,
  ApiError,
  ApiErrorCode,
  CreateDeviceRequest,
  CreateDeviceResponse,
} from '@safechat/contracts';

export const DEVICE_KEY = 'safechat_device';
const TIMEOUT_MS = 25_000;
const CLIENT_VERSION_FALLBACK = '0.5.0';

interface DeviceState {
  token: string;
  expiresAt: string;
  baseUrl: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: ApiErrorCode,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

/** Chuẩn hóa URL gốc: bỏ dấu / cuối; chỉ chấp nhận HTTPS (hoặc localhost khi phát triển). */
export function normalizeGatewayUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Mẫu origin để xin quyền host tùy chọn trong chrome.permissions. */
export function gatewayOriginPattern(baseUrl: string): string {
  return `${new URL(baseUrl).origin}/*`;
}

function clientVersion(): string {
  try {
    return chrome.runtime.getManifest().version || CLIENT_VERSION_FALLBACK;
  } catch {
    return CLIENT_VERSION_FALLBACK;
  }
}

function errorFor(status: number, body: unknown): GatewayError {
  const code = (body as Partial<ApiError> | undefined)?.error?.code;
  const retryAfterSec = (body as Partial<ApiError> | undefined)?.error?.retryAfterSec;
  const messages: Record<ApiErrorCode, string> = {
    BAD_REQUEST: 'Máy chủ từ chối yêu cầu (dữ liệu không hợp lệ).',
    UNAUTHORIZED: 'Không xác thực được thiết bị với máy chủ. Hãy thử lại.',
    QUOTA_EXCEEDED: 'Đã hết lượt phân tích AI hôm nay. Bộ quy tắc vẫn tiếp tục chạy.',
    BUDGET_EXCEEDED: 'Máy chủ tạm ngừng AI để giữ ngân sách. Bộ quy tắc vẫn tiếp tục chạy.',
    MODEL_UNAVAILABLE: 'Model AI tạm không sẵn sàng. Bộ quy tắc vẫn tiếp tục chạy.',
    TIMEOUT: 'Máy chủ phản hồi quá chậm. Bộ quy tắc vẫn tiếp tục chạy.',
    INTERNAL: 'Máy chủ gặp lỗi. Bộ quy tắc vẫn tiếp tục chạy.',
  };
  const message = code ? messages[code] : `Máy chủ trả lỗi HTTP ${status}. Bộ quy tắc vẫn tiếp tục chạy.`;
  return new GatewayError(message, status, code, retryAfterSec);
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    throw new GatewayError(
      (e as Error).name === 'AbortError' ? 'Máy chủ phản hồi quá chậm.' : 'Không kết nối được máy chủ SafeChat.',
      504,
      'TIMEOUT',
    );
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {
    /* lỗi mạng/HTML: xử lý theo status bên dưới */
  }
  if (!res.ok) throw errorFor(res.status, body);
  return body as T;
}

async function ensureDevice(baseUrl: string, force = false): Promise<string> {
  const saved = (await chrome.storage.local.get(DEVICE_KEY))[DEVICE_KEY] as DeviceState | undefined;
  if (
    !force &&
    saved?.baseUrl === baseUrl &&
    saved.token &&
    Date.parse(saved.expiresAt) > Date.now() + 60_000
  ) {
    return saved.token;
  }
  const req: CreateDeviceRequest = { client: 'extension', clientVersion: clientVersion() };
  const res = await requestJson<CreateDeviceResponse>(`${baseUrl}/v1/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res?.token || !res.expiresAt) throw new GatewayError('Máy chủ không cấp được token thiết bị.', 500, 'INTERNAL');
  await chrome.storage.local.set({
    [DEVICE_KEY]: { token: res.token, expiresAt: res.expiresAt, baseUrl } satisfies DeviceState,
  });
  return res.token;
}

async function sendAnalysis(baseUrl: string, token: string, body: AnalysisRequest): Promise<AnalysisResponse> {
  return requestJson<AnalysisResponse>(`${baseUrl}/v1/analyses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** Gọi POST /v1/analyses; tự cấp lại token thiết bị một lần nếu token hết hạn (401). */
export async function callGateway(baseUrl: string, body: AnalysisRequest): Promise<AnalysisResponse> {
  let token = await ensureDevice(baseUrl);
  try {
    return await sendAnalysis(baseUrl, token, body);
  } catch (e) {
    if (!(e instanceof GatewayError) || e.status !== 401) throw e;
    token = await ensureDevice(baseUrl, true);
    return sendAnalysis(baseUrl, token, body);
  }
}

/** Xóa token thiết bị khi người dùng đổi máy chủ hoặc dừng dùng AI. */
export async function clearDevice(): Promise<void> {
  await chrome.storage.local.remove(DEVICE_KEY);
}
