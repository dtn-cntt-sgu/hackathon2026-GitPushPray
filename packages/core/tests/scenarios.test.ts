import { describe, expect, it } from 'vitest';
import { analyze } from '@safechat/core/analyzer';
import { scenarios } from '../../../fixtures/scenarios';

describe('bộ tình huống (fixtures/scenarios.json)', () => {
  for (const s of scenarios) {
    if (s.pending) {
      it.todo(`${s.id} — ${s.title} (pending: chờ luật mới)`);
      continue;
    }
    it(`${s.id} — ${s.title}`, () => {
      const r = analyze(s.messages);
      const types = r.signals.map((x) => x.type);
      expect(r.risk_level, `tín hiệu: ${types.join(', ')}`).toBe(s.expected.level);
      for (const t of s.expected.signals) expect(types).toContain(t);
      // "Cấm" = không được xuất hiện như cảnh báo thật (được phép nếu đã hạ mức do ngữ cảnh)
      const active = r.signals.filter((x) => !x.mitigation).map((x) => x.type);
      for (const t of s.expected.forbidden ?? []) expect(active).not.toContain(t);
      // Mọi tín hiệu phải dẫn đúng tin nhắn có thật và không phải tin của người dùng
      for (const sig of r.signals) {
        expect(sig.evidence_message_ids.length).toBeGreaterThan(0);
        for (const id of sig.evidence_message_ids) {
          const m = s.messages.find((x) => x.id === id);
          expect(m).toBeDefined();
          expect(m!.sender).not.toBe('self');
        }
      }
    });
  }

  it('mức Nghiêm trọng tắt câu hỏi thăm dò và hiện hướng dẫn an toàn', () => {
    for (const s of scenarios.filter((x) => x.expected.level === 'critical' && !x.pending)) {
      const r = analyze(s.messages);
      expect(r.safety_priority).toBe(true);
      expect(r.advice.questions).toEqual([]);
      expect(r.advice.safety_message).toBeTruthy();
    }
  });

  it('mâu thuẫn phí dẫn cả hai trích dẫn trước/sau', () => {
    const s = scenarios.find((x) => x.id === '05_no_fee_then_fee')!;
    const c = analyze(s.messages).signals.find((x) => x.type === 'possible_contradiction')!;
    expect(c.evidence_message_ids).toEqual(['msg-002', 'msg-004']);
    expect(c.evidence_quotes[0]).toContain('miễn phí');
    expect(c.evidence_quotes[1]).toContain('phí kích hoạt');
  });

  it('sửa sai hợp lý được đánh dấu "explained" trong ledger', () => {
    const s = scenarios.find((x) => x.id === '10_reasonable_correction')!;
    const salary = analyze(s.messages).claims.filter((c) => c.claim_type === 'salary');
    expect(salary).toHaveLength(2);
    expect(salary.every((c) => c.status === 'explained')).toBe(true);
  });

  it('không có tin nhắn → mức Thấp, điểm 0', () => {
    const r = analyze([]);
    expect(r.risk_level).toBe('low');
    expect(r.score).toBe(0);
  });
});
