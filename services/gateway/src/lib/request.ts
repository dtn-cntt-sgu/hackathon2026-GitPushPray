import type { Context } from 'hono';
import type { AppEnv } from './deps';
import { badRequest } from './errors';

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  const type = c.req.header('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) throw badRequest('Content-Type phải là application/json');
  try {
    return await c.req.json();
  } catch {
    throw badRequest('Body không phải JSON hợp lệ');
  }
}

interface LambdaRequestContext {
  requestContext?: {
    http?: { sourceIp?: string };
    identity?: { sourceIp?: string };
  };
}

/**
 * Ưu tiên sourceIp do API Gateway gắn vào event; chỉ đọc X-Forwarded-For khi chạy local.
 * Với XFF, lấy giá trị cuối vì giá trị đầu do client tự gửi có thể bị giả mạo.
 */
export function clientIp(c: Context<AppEnv>): string {
  const env = c.env as LambdaRequestContext | undefined;
  const lambdaIp = env?.requestContext?.http?.sourceIp ?? env?.requestContext?.identity?.sourceIp;
  if (lambdaIp) return lambdaIp;

  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    const last = ips.at(-1);
    if (last) return last;
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}
