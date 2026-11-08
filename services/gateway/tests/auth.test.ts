import { describe, expect, it } from 'vitest';
import { bearerToken, createDeviceToken, verifyAdminToken, verifyDeviceToken } from '../src/lib/auth';
import { AppError } from '../src/lib/errors';
import { makeConfig } from './helpers';

const cfg = makeConfig();
const NOW = 1_700_000_000_000;

function throws(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('expected throw');
}

describe('token thiết bị', () => {
  it('ký và kiểm tra đúng client', () => {
    const t = createDeviceToken('extension', cfg, NOW);
    const claims = verifyDeviceToken(t.token, 'extension', cfg, NOW + 1000);
    expect(claims.d).toBe(t.deviceId);
    expect(claims.c).toBe('extension');
  });

  it('sai chữ ký bị từ chối', () => {
    const t = createDeviceToken('extension', cfg, NOW);
    const parts = t.token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2]!.length)}`;
    expect(throws(() => verifyDeviceToken(tampered, 'extension', cfg, NOW)).code).toBe('UNAUTHORIZED');
  });

  it('token hết hạn bị từ chối', () => {
    const t = createDeviceToken('extension', cfg, NOW);
    const later = NOW + 24 * 3600 * 1000 + 61_000;
    expect(throws(() => verifyDeviceToken(t.token, 'extension', cfg, later)).message).toContain('hết hạn');
  });

  it('chấp nhận lệch giờ nhỏ 60 giây', () => {
    const t = createDeviceToken('extension', cfg, NOW);
    const slightlyLate = NOW + 24 * 3600 * 1000 + 30_000;
    expect(verifyDeviceToken(t.token, 'extension', cfg, slightlyLate).d).toBe(t.deviceId);
  });

  it('sai client bị từ chối', () => {
    const t = createDeviceToken('extension', cfg, NOW);
    expect(throws(() => verifyDeviceToken(t.token, 'android', cfg, NOW)).message).toContain('client');
  });

  it('hỗ trợ secret trước đó khi xoay vòng', () => {
    const t = createDeviceToken('extension', cfg, NOW);
    const rotated = makeConfig({ tokenSecret: 'new-secret-that-is-long-enough', tokenSecretPrevious: cfg.tokenSecret });
    expect(verifyDeviceToken(t.token, 'extension', rotated, NOW).d).toBe(t.deviceId);
  });

  it('bearerToken kiểm tra header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(throws(() => bearerToken(undefined)).code).toBe('UNAUTHORIZED');
    expect(throws(() => bearerToken('abc')).code).toBe('UNAUTHORIZED');
  });

  it('token admin so sánh đúng', () => {
    const admin = makeConfig({ metricsAdminToken: 'admin-secret' });
    expect(() => verifyAdminToken('admin-secret', admin)).not.toThrow();
    expect(throws(() => verifyAdminToken('wrong', admin)).code).toBe('UNAUTHORIZED');
    expect(throws(() => verifyAdminToken('x', cfg)).code).toBe('UNAUTHORIZED');
  });
});
