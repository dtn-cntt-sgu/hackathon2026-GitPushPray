import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ClientKind } from '@safechat/contracts';
import type { GatewayConfig } from './config';
import { unauthorized } from './errors';

const VERSION = 'sc1';
const CLOCK_SKEW_MS = 60_000;

export interface DeviceClaims {
  v: 1;
  c: ClientKind;
  /** Định danh thiết bị; chỉ băm trước khi log. */
  d: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${VERSION}.${payload}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createDeviceToken(
  client: ClientKind,
  cfg: Pick<GatewayConfig, 'tokenSecret' | 'tokenTtlHours'>,
  now = Date.now(),
): { token: string; expiresAt: string; deviceId: string; claims: DeviceClaims } {
  const claims: DeviceClaims = {
    v: 1,
    c: client,
    d: randomUUID(),
    iat: now,
    exp: now + cfg.tokenTtlHours * 60 * 60 * 1000,
  };
  const payload = b64url(JSON.stringify(claims));
  return {
    token: `${VERSION}.${payload}.${sign(payload, cfg.tokenSecret)}`,
    expiresAt: new Date(claims.exp).toISOString(),
    deviceId: claims.d,
    claims,
  };
}

function verifySignature(payload: string, signature: string, secrets: string[]): boolean {
  return secrets.some((secret) => safeEqual(sign(payload, secret), signature));
}

export function verifyDeviceToken(
  token: string,
  expectedClient: ClientKind,
  cfg: Pick<GatewayConfig, 'tokenSecret' | 'tokenSecretPrevious'>,
  now = Date.now(),
): DeviceClaims {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw unauthorized('Token không hợp lệ');
  const payload = parts[1]!;
  const signature = parts[2]!;
  const secrets = [cfg.tokenSecret, ...(cfg.tokenSecretPrevious ? [cfg.tokenSecretPrevious] : [])];
  if (!verifySignature(payload, signature, secrets)) throw unauthorized('Token không hợp lệ');

  let claims: DeviceClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DeviceClaims;
  } catch {
    throw unauthorized('Token không hợp lệ');
  }
  if (claims?.v !== 1 || typeof claims.d !== 'string' || typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    throw unauthorized('Token không hợp lệ');
  }
  if (claims.c !== expectedClient) throw unauthorized('Token không khớp client');
  // Cho phép lệch giờ nhỏ 60 giây; hết hạn thì buộc client xin token mới.
  if (claims.exp + CLOCK_SKEW_MS < now) throw unauthorized('Token đã hết hạn');
  if (claims.iat - CLOCK_SKEW_MS > now) throw unauthorized('Token không hợp lệ');
  return claims;
}

export function bearerToken(header: string | undefined): string {
  if (!header) throw unauthorized('Thiếu Authorization');
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) throw unauthorized('Authorization không hợp lệ');
  return m[1]!.trim();
}

export function verifyAdminToken(token: string, cfg: Pick<GatewayConfig, 'metricsAdminToken'>): void {
  if (!cfg.metricsAdminToken) throw unauthorized('Endpoint quản trị chưa được cấu hình');
  if (!safeEqual(token, cfg.metricsAdminToken)) throw unauthorized('Token quản trị không hợp lệ');
}
