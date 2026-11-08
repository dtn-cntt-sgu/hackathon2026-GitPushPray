import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createDeviceToken } from '../src/lib/auth';
import { ProviderError } from '../src/lib/errors';
import type { AiClient } from '../src/lib/deps';
import { makeConfig, makeDeps } from './helpers';

const NOW = 1_700_000_000_000;

function setup(cfgOverrides: Parameters<typeof makeConfig>[0] = {}, ai?: AiClient) {
  const cfg = makeConfig({ provider: 'groq', ...cfgOverrides });
  const deps = makeDeps(cfg, { now: () => NOW, ...(ai ? { ai } : {}) });
  const app = createApp(deps);
  const token = createDeviceToken('extension', cfg, NOW).token;
  return { cfg, deps, app, token };
}

function analysisBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client: 'extension',
    clientVersion: '1.0.0',
    messages: [{ id: 'm1', sender: 'other', text: 'Gửi OTP để xác minh tài khoản', seq: 1 }],
    lastAiSeq: 0,
    summary: '',
    ruleHints: [],
    currentLevel: 'low',
    tier: 'small',
    ...over,
  };
}

function otpAi(over: { summary?: string; type?: string; severity?: string } = {}): AiClient {
  return {
    async complete() {
      return {
        content: JSON.stringify({
          signals: [
            {
              type: over.type ?? 'otp_request',
              category: 'account',
              severity: over.severity ?? 'critical',
              title: 'Yêu cầu OTP',
              explanation: 'Đối phương đòi mã xác thực.',
              evidence_message_ids: ['m1'],
              evidence_quotes: ['Gửi OTP để xác minh tài khoản'],
              recommended_action: 'Không cung cấp OTP.',
              confidence: 0.9,
            },
          ],
          summary: over.summary ?? 'Đối phương yêu cầu OTP.',
          uncertainties: [],
          detected_stage: 'S3',
        }),
        model: 'fake-model',
        inputTokens: 100,
        outputTokens: 50,
      };
    },
  };
}

function post(app: ReturnType<typeof createApp>, path: string, body: unknown, token?: string) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe('app', () => {
  it('GET /healthz trả ok và CORS đúng origin', async () => {
    const { app } = setup();
    const res = await app.fetch(new Request('http://localhost/healthz', { headers: { origin: 'http://localhost:5173' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('GET /readyz trả ready khi store và model sẵn sàng', async () => {
    const { app } = setup();
    const res = await app.fetch(new Request('http://localhost/readyz'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'ready',
      checks: { store: true, ai: true },
      provider: 'groq',
      models: { small: 'openai/gpt-oss-120b', large: 'openai/gpt-oss-120b' },
    });
  });

  it('GET /readyz trả 503 khi không đọc được store', async () => {
    const cfg = makeConfig({ provider: 'groq' });
    const deps = makeDeps(cfg, {
      now: () => NOW,
      store: {
        async get() {
          throw new Error('boom');
        },
        async query() {
          return [];
        },
        async incr() {},
        async incrUnder() {
          return { allowed: true };
        },
        async incrManyUnder() {
          return true;
        },
      },
    });
    const app = createApp(deps);
    const res = await app.fetch(new Request('http://localhost/readyz'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'not_ready', checks: { store: false } });
  });

  it('origin lạ không được trả Access-Control-Allow-Origin', async () => {
    const { app } = setup();
    const res = await app.fetch(new Request('http://localhost/healthz', { headers: { origin: 'https://evil.example' } }));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('OPTIONS trả 204', async () => {
    const { app } = setup();
    const res = await app.fetch(new Request('http://localhost/v1/analyses', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }));
    expect(res.status).toBe(204);
  });

  it('path lạ 404 và method sai 405, body ApiError', async () => {
    const { app } = setup();
    const notFound = await app.fetch(new Request('http://localhost/nope'));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    const wrongMethod = await app.fetch(new Request('http://localhost/v1/devices', { method: 'GET' }));
    expect(wrongMethod.status).toBe(405);
  });

  it('Content-Type sai trả 400', async () => {
    const { app } = setup();
    const res = await app.fetch(new Request('http://localhost/v1/devices', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }));
    expect(res.status).toBe(400);
  });

  it('body vượt giới hạn trả 400', async () => {
    const { app } = setup({ maxBodyBytes: 64 });
    const res = await post(app, '/v1/devices', { client: 'extension', clientVersion: 'x'.repeat(200) });
    expect(res.status).toBe(400);
  });

  it('cấp token HMAC qua /v1/devices', async () => {
    const { app } = setup();
    const res = await post(app, '/v1/devices', { client: 'extension', clientVersion: '1.0.0' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; expiresAt: string };
    expect(body.token.split('.')).toHaveLength(3);
    expect(Number.isFinite(Date.parse(body.expiresAt))).toBe(true);
  });

  it('thiếu trường khi cấp token trả 400', async () => {
    const { app } = setup();
    const res = await post(app, '/v1/devices', { client: 'extension' });
    expect(res.status).toBe(400);
  });

  it('rate limit cấp token dùng IP cuối của X-Forwarded-For, không tin giá trị client tự gửi', async () => {
    const { app } = setup({ deviceIssueRpm: 1 });
    const issue = (fakeFirst: string) =>
      app.fetch(
        new Request('http://localhost/v1/devices', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `${fakeFirst}, 203.0.113.9` },
          body: JSON.stringify({ client: 'extension', clientVersion: '1.0.0' }),
        }),
      );
    expect((await issue('198.51.100.1')).status).toBe(201);
    expect((await issue('198.51.100.2')).status).toBe(429);
  });

  it('phân tích thiếu Authorization trả 401', async () => {
    const { app } = setup({}, otpAi());
    const res = await post(app, '/v1/analyses', analysisBody());
    expect(res.status).toBe(401);
  });

  it('token sai client trả 401', async () => {
    const cfg = makeConfig({ provider: 'groq' });
    const deps = makeDeps(cfg, { now: () => NOW, ai: otpAi() });
    const app = createApp(deps);
    const androidToken = createDeviceToken('android', cfg, NOW).token;
    const res = await post(app, '/v1/analyses', analysisBody(), androidToken);
    expect(res.status).toBe(401);
  });

  it('không có tin mới trả 200 rỗng, không gọi AI', async () => {
    const complete = vi.fn();
    const { app, token } = setup({}, { complete });
    const res = await post(app, '/v1/analyses', analysisBody({ lastAiSeq: 1 }), token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ signals: [], rejected: 0 });
    expect(complete).not.toHaveBeenCalled();
  });

  it('chỉ có tin self trả 200 rỗng', async () => {
    const complete = vi.fn();
    const { app, token } = setup({}, { complete });
    const res = await post(
      app,
      '/v1/analyses',
      analysisBody({ messages: [{ id: 'm1', sender: 'self', text: 'chào', seq: 1 }] }),
      token,
    );
    expect(res.status).toBe(200);
    expect(complete).not.toHaveBeenCalled();
  });

  it('phân tích thành công, chuẩn hoá type và giữ quote gốc', async () => {
    const { app, token } = setup({ aiEscalation: false }, otpAi({ type: 'ai_otp_password_request' }));
    const res = await post(app, '/v1/analyses', analysisBody(), token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      signals: { type: string; evidence_quotes: string[] }[];
      usage: { tier: string; inputTokens: number };
    };
    expect(body.signals[0]?.type).toBe('otp_request');
    expect(body.signals[0]?.evidence_quotes[0]).toBe('Gửi OTP để xác minh tài khoản');
    expect(body.usage.inputTokens).toBe(100);
  });

  it('rate limit thiết bị trả 429', async () => {
    const { app, token } = setup({ deviceRpm: 1, deviceDailyCalls: 10 }, otpAi());
    expect((await post(app, '/v1/analyses', analysisBody(), token)).status).toBe(200);
    const second = await post(app, '/v1/analyses', analysisBody(), token);
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ error: { code: 'QUOTA_EXCEEDED' } });
  });

  it('quota ngày thiết bị trả 429', async () => {
    const { app, token } = setup({ deviceRpm: 100, deviceDailyCalls: 1 }, otpAi());
    expect((await post(app, '/v1/analyses', analysisBody(), token)).status).toBe(200);
    expect((await post(app, '/v1/analyses', analysisBody(), token)).status).toBe(429);
  });

  it('kill switch AI_PROVIDER=none trả 503 MODEL_UNAVAILABLE', async () => {
    const { app, token } = setup({ provider: 'none' });
    const res = await post(app, '/v1/analyses', analysisBody(), token);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'MODEL_UNAVAILABLE' } });
  });

  it('lỗi provider không lộ chi tiết nội bộ', async () => {
    const ai: AiClient = {
      async complete() {
        throw new ProviderError('MODEL_UNAVAILABLE', 'prompt bí mật của hệ thống');
      },
    };
    const { app, token } = setup({}, ai);
    const res = await post(app, '/v1/analyses', analysisBody(), token);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain('prompt bí mật');
  });

  it('leo model lớn khi model nhỏ thấy tín hiệu nặng', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          signals: [
            {
              type: 'threat_direct',
              category: 'pressure',
              severity: 'high',
              title: 'Đe dọa',
              explanation: 'x',
              evidence_message_ids: ['m1'],
              evidence_quotes: ['Gửi OTP để xác minh tài khoản'],
              recommended_action: 'x',
              confidence: 0.8,
            },
          ],
          summary: 'nhỏ',
          uncertainties: [],
        }),
        model: 'small-model',
        inputTokens: 10,
        outputTokens: 5,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          signals: [
            {
              type: 'otp_request',
              category: 'account',
              severity: 'critical',
              title: 'OTP',
              explanation: 'x',
              evidence_message_ids: ['m1'],
              evidence_quotes: ['Gửi OTP để xác minh tài khoản'],
              recommended_action: 'x',
              confidence: 0.9,
            },
          ],
          summary: 'lớn',
          uncertainties: [],
          detected_stage: 'S3',
        }),
        model: 'large-model',
        inputTokens: 20,
        outputTokens: 10,
      });
    const { app, token } = setup({ groqModelSmall: 'small-model', groqModelLarge: 'large-model' }, { complete });
    const res = await post(app, '/v1/analyses', analysisBody(), token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usage: { tier: string; inputTokens: number }; summary: string };
    expect(body.usage.tier).toBe('large');
    expect(body.usage.inputTokens).toBe(30);
    expect(body.summary).toBe('lớn');
    expect(complete).toHaveBeenCalledTimes(2);
    const firstPrompt = complete.mock.calls[0]![0] as { system: string };
    const secondPrompt = complete.mock.calls[1]![0] as { system: string };
    expect(firstPrompt.system).toContain('LƯỢT NHANH');
    expect(secondPrompt.system).toContain('LƯỢT SÂU');
    expect(secondPrompt.system).not.toContain('LƯỢT NHANH');
  });

  it('không leo tầng khi model nhỏ và lớn là cùng một model: chỉ gọi 1 lượt', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        signals: [
          {
            type: 'threat_direct',
            category: 'pressure',
            severity: 'high',
            title: 'Đe dọa',
            explanation: 'x',
            evidence_message_ids: ['m1'],
            evidence_quotes: ['Gửi OTP để xác minh tài khoản'],
            recommended_action: 'x',
            confidence: 0.8,
          },
        ],
        summary: 'nhỏ',
        uncertainties: [],
      }),
      model: 'openai/gpt-oss-120b',
      inputTokens: 10,
      outputTokens: 5,
    });
    const { app, token } = setup({ groqModelSmall: 'openai/gpt-oss-120b', groqModelLarge: 'openai/gpt-oss-120b' }, { complete });
    const res = await post(app, '/v1/analyses', analysisBody(), token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usage: { tier: string; inputTokens: number } };
    expect(complete).toHaveBeenCalledTimes(1);
    expect(body.usage.tier).toBe('small');
    expect(body.usage.inputTokens).toBe(10);
  });

  it('lỗi đọc kết quả AI không ghi nội dung chat vào log', async () => {
    const secret = 'BÍ MẬT_CHAT_123';
    const ai: AiClient = {
      async complete() {
        return {
          content: `{"signals": ["${secret}",]}`,
          model: 'fake-model',
          inputTokens: 10,
          outputTokens: 5,
        };
      },
    };
    const { app, token } = setup({ aiEscalation: false }, ai);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const res = await post(app, '/v1/analyses', analysisBody(), token);
      expect(res.status).toBe(503);
      const lines = spy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(lines).not.toContain(secret);
      expect(lines).toContain('"errorCode":"MODEL_UNAVAILABLE"');
    } finally {
      spy.mockRestore();
    }
  });

  it('feedback yêu cầu token và ghi nhận tổng hợp', async () => {
    const { app, token } = setup();
    const body = { client: 'extension', level: 'high', signalTypes: ['otp_request'], verdict: 'correct' };
    expect((await post(app, '/v1/feedback', body)).status).toBe(401);
    const res = await post(app, '/v1/feedback', body, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('metrics yêu cầu token admin riêng', async () => {
    const { app } = setup({ metricsAdminToken: 'admin-secret' });
    const unauthorized = await app.fetch(new Request('http://localhost/v1/metrics/summary'));
    expect(unauthorized.status).toBe(401);
    const res = await app.fetch(
      new Request('http://localhost/v1/metrics/summary', { headers: { authorization: 'Bearer admin-secret' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ calls: 0 });
  });
});
