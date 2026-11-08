import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiRequest } from '@safechat/core/ai';
import { ProviderError } from '../src/lib/errors';
import { callGroq } from '../src/lib/providers/groq';

const req: AiRequest = { system: 'system', user: 'user', sent: [], upToSeq: 0 };
const base = { apiKey: 'k', model: 'm', timeoutMs: 8000, maxOutputTokens: 100 };

function ok(content: unknown, finish = 'stop'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callGroq', () => {
  it('trả nội dung và usage', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok({ signals: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await callGroq(req, base);
    expect(r.content).toContain('signals');
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(5);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { temperature: number };
    expect(body.temperature).toBe(0);
  });

  it('429 trả QUOTA_EXCEEDED kèm retryAfterSec', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } })));
    await expect(callGroq(req, base)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', retryAfterSec: 30 });
  });

  it('401 trả MODEL_UNAVAILABLE, không lộ body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret provider body', { status: 401 })));
    try {
      await callGroq(req, base);
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('MODEL_UNAVAILABLE');
      expect((e as Error).message).not.toContain('secret provider body');
    }
  });

  it('5xx retry một lần rồi thành công', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(ok({ signals: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await callGroq(req, base);
    expect(r.content).toContain('signals');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('finish_reason length retry với max_tokens cao hơn', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ signals: [] }, 'length'))
      .mockResolvedValueOnce(ok({ signals: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await callGroq(req, base);
    const second = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as { max_tokens: number };
    expect(second.max_tokens).toBe(200);
  });

  it('400 json_validate_failed retry với max_tokens cao hơn', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'json_validate_failed' } }), { status: 400 }),
      )
      .mockResolvedValueOnce(ok({ signals: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await callGroq(req, base);
    expect(r.content).toContain('signals');
    const second = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as { max_tokens: number };
    expect(second.max_tokens).toBe(200);
  });

  it('400 khác json_validate_failed không retry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'bad_request' } }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callGroq(req, base)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', providerStatus: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('không có JSON thì retry với nhắc chỉ JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'xin chào' } }] }), { status: 200 }))
      .mockResolvedValueOnce(ok({ signals: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await callGroq(req, base);
    expect(r.content).toContain('signals');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('timeout trả TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      }),
    );
    await expect(callGroq(req, { ...base, timeoutMs: 50 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('response quá 64KB bị loại', async () => {
    const big = 'x'.repeat(70 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(big, { status: 200, headers: { 'content-length': String(big.length) } })));
    await expect(callGroq(req, base)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });
});
