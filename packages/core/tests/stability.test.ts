import { describe, expect, it } from 'vitest';
import { analyze } from '@safechat/core/analyzer';
import { createSnapshot, parseSnapshot, serializeSnapshot, SnapshotError, type SnapshotInput } from '@safechat/core/context-manager';
import { initialStability, stabilize, type StabilityState } from '@safechat/core/stability';
import { appendObserved, emptyTranscript } from '@safechat/core/transcript';
import type { AnalysisResult, ChatMessage, RiskLevel, Signal } from '@safechat/core/types';

const msgs = (...texts: string[]): ChatMessage[] =>
  texts.map((text, i) => ({ id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender: 'other', text }));

/** Kết quả giả với một mức thô cho trước, tín hiệu từ luật hoặc từ AI. */
const fake = (level: RiskLevel, source: Signal['source'] = 'rule'): AnalysisResult => {
  const sev = { low: 'low', attention: 'medium', high: 'high', critical: 'critical' } as const;
  const base = analyze([]);
  return {
    ...base,
    risk_level: level,
    score: { low: 0, attention: 25, high: 60, critical: 100 }[level],
    signals:
      level === 'low'
        ? []
        : [
            {
              type: `x_${level}`,
              category: 'finance',
              severity: sev[level],
              title: 't',
              explanation: '',
              evidence_message_ids: ['msg-001'],
              evidence_quotes: [''],
              recommended_action: '',
              source,
              direct_danger: level === 'critical',
            },
          ],
  };
};

/** Chạy một chuỗi đánh giá, mỗi bước là một lần đánh giá mới. */
const run = (steps: AnalysisResult[]) => {
  let st: StabilityState | undefined;
  return steps.map((r, i) => {
    const o = stabilize(st, r, `k${i}`);
    st = o.state;
    return { level: o.result.risk_level, note: o.note, state: o.state };
  });
};

describe('chống dao động', () => {
  it('tăng ngay khi bằng chứng mạnh từ luật', () => {
    expect(run([fake('low'), fake('high')]).map((x) => x.level)).toEqual(['low', 'high']);
  });
  it('phần vượt lên chỉ nhờ AI được nâng ngay ở lần đánh giá có bằng chứng', () => {
    const out = run([fake('low'), fake('high', 'ai'), fake('high', 'ai')]);
    expect(out.map((x) => x.level)).toEqual(['low', 'high', 'high']);
  });
  it('AI gợi ý mức cao có bằng chứng thì nâng ngay; biến mất thì hạ chậm như mức của luật', () => {
    expect(run([fake('attention'), fake('high', 'ai'), fake('attention')]).map((x) => x.level)).toEqual([
      'attention',
      'high',
      'high',
    ]);
  });
  it('hạ chậm: cần 2 lần đánh giá liên tiếp thấp hơn; giữa chừng tăng lại thì không hạ', () => {
    expect(run([fake('high'), fake('attention'), fake('attention')]).map((x) => x.level)).toEqual(['high', 'high', 'attention']);
    expect(run([fake('high'), fake('attention'), fake('high'), fake('attention')]).map((x) => x.level)).toEqual([
      'high',
      'high',
      'high',
      'high',
    ]);
  });
  it('dao động lên xuống liên tục bị dập: hiển thị không đổi chiều', () => {
    const out = run([fake('attention'), fake('high'), fake('attention'), fake('high'), fake('attention')]).map((x) => x.level);
    expect(out).toEqual(['attention', 'high', 'high', 'high', 'high']);
  });
  it('không bao giờ tự hạ từ Nghiêm trọng; giữ hướng dẫn an toàn', () => {
    const steps = run([fake('critical'), fake('attention'), fake('attention'), fake('low')]);
    expect(steps.map((x) => x.level)).toEqual(['critical', 'critical', 'critical', 'critical']);
    expect(steps[1]!.note).toContain('Nghiêm trọng');
    const held = stabilize(steps[0]!.state, fake('attention'), 'z').result;
    expect(held.safety_priority).toBe(true);
    expect(held.advice.questions).toEqual([]);
    expect(held.raw_level).toBe('attention');
    expect(held.score).toBe(100);
  });
  it('tính lại không có bằng chứng mới (cùng khóa) thì không đếm là lần đánh giá', () => {
    let st = stabilize(undefined, fake('high'), 'a').state;
    st = stabilize(st, fake('attention'), 'b').state;
    // tính lại nhiều lần với cùng khóa 'b' (vd. đổi cài đặt) → vẫn chưa đủ 2 lần
    for (let i = 0; i < 3; i++) st = stabilize(st, fake('attention'), 'b').state;
    expect(st.displayed).toBe('high');
    expect(stabilize(st, fake('attention'), 'c').state.displayed).toBe('attention');
  });
  it('ghi mức cao nhất trong phiên', () => {
    const out = run([fake('high'), fake('low'), fake('low'), fake('low')]);
    expect(out.at(-1)!.level).toBe('low');
    expect(out.at(-1)!.state.maxLevel).toBe('high');
  });
  it('kết quả thật: ca mượn tiền rồi xác minh vẫn tăng ngay theo luật (bằng chứng mạnh)', () => {
    const r = analyze(msgs('Cứu tao gấp, chuyển tạm 5 triệu qua STK này, app ngân hàng tao đang bảo trì'));
    expect(stabilize(initialStability(), r, 'k').result.risk_level).toBe(r.risk_level);
  });
});

describe('Context Manager', () => {
  const t = emptyTranscript();
  appendObserved(t, [
    { sender: 'other', text: 'Chào em, bên chị tuyển CTV' },
    { sender: 'self', text: 'Dạ' },
    { sender: 'other', text: 'Em đóng phí hồ sơ 300k nhé' },
  ]);
  const input: SnapshotInput = {
    threadLabel: 'Chị Lan tuyển dụng',
    platform: 'mock',
    startedAt: 1_700_000_000_000,
    maxMessages: 300,
    transcript: t,
    ai: {
      summary: 'Tuyển CTV, đòi phí',
      signals: [
        {
          type: 'ai_vague',
          category: 'job_terms',
          severity: 'medium',
          title: 'Mơ hồ',
          explanation: '',
          evidence_message_ids: ['msg-001'],
          evidence_quotes: ['Chào em'],
          recommended_action: '',
          source: 'ai',
        },
      ],
      uncertainties: [],
      lastSeq: 3,
      calls: 1,
    },
    marks: { 'upfront_fee:msg-003': 'review' },
    timeline: [{ seq: 3, messageId: 'msg-003', level: 'high', score: 66, newSignals: ['Phí'] }],
    stability: { displayed: 'high', maxLevel: 'high', lastEvalKey: '3:1', recentRaw: ['high'] },
  };

  it('lưu rồi đọc lại y nguyên', () => {
    const snap = createSnapshot(input, new Date('2026-11-01T10:00:00Z'));
    const back = parseSnapshot(serializeSnapshot(snap));
    expect(back.transcript).toEqual(t);
    expect(back.ai.summary).toBe('Tuyển CTV, đòi phí');
    expect(back.ai.signals).toHaveLength(1);
    expect(back.marks).toEqual(input.marks);
    expect(back.stability?.displayed).toBe('high');
  });
  it('phát hiện file bị chỉnh sửa, file báo cáo, JSON hỏng, phiên bản lạ', () => {
    const snap = createSnapshot(input);
    const tampered = JSON.parse(serializeSnapshot(snap));
    tampered.transcript.messages[2].text = 'Bên chị không thu phí';
    expect(() => parseSnapshot(JSON.stringify(tampered))).toThrow('chỉnh sửa');
    expect(() => parseSnapshot('{"generator":"SafeChat AI (prototype)"}')).toThrow('không phải file phiên');
    expect(() => parseSnapshot('không phải json')).toThrow(SnapshotError);
    expect(() => parseSnapshot(JSON.stringify({ ...snap, version: 99 }))).toThrow('Phiên bản');
  });
  it('dữ liệu lạ bị loại/chuẩn hóa: tín hiệu AI trỏ tin không tồn tại bị bỏ, mọi tín hiệu khôi phục đều là AI', () => {
    const bad = createSnapshot({
      ...input,
      ai: {
        ...input.ai,
        signals: [
          { ...input.ai.signals[0]!, type: 'upfront_fee', source: 'rule' },
          { ...input.ai.signals[0]!, type: 'x', evidence_message_ids: ['msg-999'] },
        ],
      },
    });
    const back = parseSnapshot(serializeSnapshot(bad));
    expect(back.ai.signals).toHaveLength(1);
    expect(back.ai.signals[0]!.source).toBe('ai');
    expect(back.ai.signals[0]!.type).toBe('ai_upfront_fee');
  });
  it('bản nháp không nhất quán bị từ chối', () => {
    const snap = createSnapshot({ ...input, transcript: { ...t, keys: t.keys.slice(1) } });
    expect(() => parseSnapshot(serializeSnapshot(snap))).toThrow('không nhất quán');
  });
  it('khôi phục rồi nối tiếp tin đang hiển thị không trùng lặp', () => {
    const back = parseSnapshot(serializeSnapshot(createSnapshot(input)));
    const added = appendObserved(back.transcript, [
      { sender: 'self', text: 'Dạ' },
      { sender: 'other', text: 'Em đóng phí hồ sơ 300k nhé' },
      { sender: 'other', text: 'Chuyển khoản vào STK chị nhé' },
    ]);
    expect(added.map((m) => m.text)).toEqual(['Chuyển khoản vào STK chị nhé']);
    expect(added[0]!.id).toBe('msg-004');
  });
});
