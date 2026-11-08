import { createHmac } from 'node:crypto';

export interface LogFields {
  requestId: string;
  route: string;
  status: number;
  errorCode?: string;
  deviceHash?: string;
  client?: string;
  tier?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  rejected?: number;
  signals?: number;
  stage?: string;
  downgrade?: boolean;
  escalation?: boolean;
  reason?: string;
}

/** Băm có khóa rồi cắt ngắn định danh thiết bị/IP trước khi ghi log hoặc dùng làm khóa đếm. */
export function hashDevice(deviceId: string, salt = ''): string {
  return createHmac('sha256', salt).update(deviceId).digest('hex').slice(0, 16);
}

const ALLOWED = new Set<keyof LogFields>([
  'requestId',
  'route',
  'status',
  'errorCode',
  'deviceHash',
  'client',
  'tier',
  'provider',
  'model',
  'promptVersion',
  'latencyMs',
  'inputTokens',
  'outputTokens',
  'rejected',
  'signals',
  'stage',
  'downgrade',
  'escalation',
  'reason',
]);

function safeValue(v: unknown): string | number | boolean | undefined {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.slice(0, 80);
  return undefined;
}

/**
 * Mỗi request một dòng JSON. Chỉ nhận các trường kỹ thuật trong danh sách trắng,
 * tuyệt đối không nhận nội dung tin nhắn, tóm tắt, quote, title hay Authorization.
 */
export function logEvent(fields: LogFields): void {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k as keyof LogFields)) continue;
    const safe = safeValue(v);
    if (safe !== undefined) out[k] = safe;
  }
  console.log(JSON.stringify(out));
}
