import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import { validateAnalysisRequest, validateFeedback } from '../src/lib/validate';
import { makeConfig } from './helpers';

const cfg = makeConfig();

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client: 'extension',
    clientVersion: '1.0.0',
    messages: [
      { id: 'm1', sender: 'other', text: 'xin chào', seq: 1 },
      { id: 'm2', sender: 'self', text: 'chào', seq: 2 },
    ],
    lastAiSeq: 0,
    summary: '',
    ruleHints: [],
    currentLevel: 'low',
    tier: 'small',
    ...over,
  };
}

function expectBad(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('expected throw');
}

describe('validateAnalysisRequest', () => {
  it('chấp nhận request hợp lệ và bỏ timestamp sai định dạng', () => {
    const r = validateAnalysisRequest(
      base({ messages: [{ id: 'm1', sender: 'other', text: 'x', seq: 1, timestamp: 'không phải giờ' }] }),
      cfg,
    );
    expect(r.messages[0]?.timestamp).toBeUndefined();
  });

  it('loại id trùng', () => {
    const r = expectBad(() =>
      validateAnalysisRequest(
        base({
          messages: [
            { id: 'm1', sender: 'other', text: 'a', seq: 1 },
            { id: 'm1', sender: 'other', text: 'b', seq: 2 },
          ],
        }),
        cfg,
      ),
    );
    expect(r.message).toContain('id');
  });

  it('loại seq không tăng dần', () => {
    expectBad(() =>
      validateAnalysisRequest(
        base({
          messages: [
            { id: 'm1', sender: 'other', text: 'a', seq: 2 },
            { id: 'm2', sender: 'other', text: 'b', seq: 1 },
          ],
        }),
        cfg,
      ),
    );
  });

  it('loại lastAiSeq lớn hơn seq lớn nhất', () => {
    expectBad(() => validateAnalysisRequest(base({ lastAiSeq: 99 }), cfg));
  });

  it('loại lastAiSeq không phải số', () => {
    expectBad(() => validateAnalysisRequest(base({ lastAiSeq: '1' }), cfg));
  });

  it('loại sender lạ, stage lạ, tier lạ', () => {
    expectBad(() => validateAnalysisRequest(base({ messages: [{ id: 'm1', sender: 'admin', text: 'x', seq: 1 }] }), cfg));
    expectBad(() => validateAnalysisRequest(base({ stage: 'S9' }), cfg));
    expectBad(() => validateAnalysisRequest(base({ tier: 'huge' }), cfg));
  });

  it('loại summary không phải chuỗi', () => {
    expectBad(() => validateAnalysisRequest(base({ summary: 123 }), cfg));
  });

  it('loại tổng văn bản vượt giới hạn', () => {
    expectBad(() =>
      validateAnalysisRequest(
        base({ messages: [{ id: 'm1', sender: 'other', text: 'x'.repeat(1500), seq: 1 }] }),
        makeConfig({ maxTotalChars: 1000 }),
      ),
    );
  });

  it('giữ 20 ruleHints đầu, bỏ phần còn lại', () => {
    const hints = Array.from({ length: 25 }, (_, i) => ({ type: `t${i}`, title: `title ${i}` }));
    const r = validateAnalysisRequest(base({ ruleHints: hints }), cfg);
    expect(r.ruleHints).toHaveLength(20);
    expect(r.ruleHints[19]?.type).toBe('t19');
  });

  it('bỏ __proto__ và constructor, không làm ô nhiễm prototype', () => {
    const raw = JSON.parse(
      JSON.stringify({
        ...base(),
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } },
      }),
    );
    const r = validateAnalysisRequest(raw, cfg);
    expect((r as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('validateFeedback', () => {
  it('loại verdict lạ và signalTypes không phải mảng chuỗi', () => {
    expectBad(() => validateFeedback({ client: 'extension', level: 'low', signalTypes: [], verdict: 'bad' }));
    expectBad(() => validateFeedback({ client: 'extension', level: 'low', signalTypes: [1], verdict: 'correct' }));
  });
});
