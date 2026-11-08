import { describe, expect, it } from 'vitest';
import type { AiParsed } from '@safechat/core/ai';
import type { Signal } from '@safechat/core/types';
import { applyGuards } from '../src/lib/guards';
import {
  calibrateSignals,
  canonicalType,
  dropBenignWarnings,
  dropRuleDuplicates,
  normalizeSignals,
} from '../src/lib/taxonomy';
import { makeConfig } from './helpers';

const cfg = makeConfig();

function sig(over: Partial<Signal> = {}): Signal {
  return {
    type: 'ai_otp_request',
    category: 'account',
    severity: 'high',
    title: 'Yêu cầu OTP',
    explanation: 'x',
    evidence_message_ids: ['m1'],
    evidence_quotes: ['gửi otp'],
    recommended_action: 'không gửi',
    source: 'ai',
    ...over,
  };
}

function parsed(over: Partial<AiParsed> = {}): AiParsed {
  return { signals: [], summary: '', uncertainties: [], rejected: 0, ...over };
}

describe('taxonomy', () => {
  it('ánh xạ từ đồng nghĩa và loại lạ về other', () => {
    expect(canonicalType('ai_upfront_payment')).toBe('fee_upfront');
    expect(canonicalType('ai_love_bomb')).toBe('love_bombing');
    expect(canonicalType('ai_đe_dọa')).toBe('other');
    expect(canonicalType('otp_password_request')).toBe('otp_request');
  });

  it('khử trùng theo (type, evidence ids), sắp severity và cắt tối đa', () => {
    const signals = [
      sig({ type: 'ai_fee_upfront', severity: 'medium', evidence_message_ids: ['m1'] }),
      sig({ type: 'ai_fee_upfront', severity: 'high', evidence_message_ids: ['m1'] }),
      sig({ type: 'ai_threat_direct', severity: 'critical', evidence_message_ids: ['m2'] }),
      sig({ type: 'ai_unknown_thing', severity: 'low', evidence_message_ids: ['m3'] }),
    ];
    const out = normalizeSignals(signals, 2);
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('threat_direct');
    expect(out[1]?.type).toBe('fee_upfront');
    expect(out[1]?.severity).toBe('high');
  });

  it('kẹp confidence về 0..1', () => {
    const out = normalizeSignals([sig({ confidence: 9 })], 8);
    expect(out[0]?.confidence).toBe(1);
  });

  it('ánh xạ thêm type của luật và AI về cùng loại chuẩn', () => {
    expect(canonicalType('possible_contradiction')).toBe('contradiction');
    expect(canonicalType('crypto_wallet')).toBe('investment_bait');
    expect(canonicalType('phishing_link')).toBe('suspicious_link');
    expect(canonicalType('money_transfer')).toBe('fee_upfront');
  });

  it('không để tín hiệu không phải cô lập mang category isolation', () => {
    const out = normalizeSignals(
      [
        sig({ type: 'ai_fee_upfront', category: 'isolation', evidence_message_ids: ['m1'] }),
        sig({ type: 'ai_urgency_pressure', category: 'isolation', evidence_message_ids: ['m2'] }),
        sig({ type: 'ai_isolation_control', category: 'isolation', evidence_message_ids: ['m3'] }),
      ],
      8,
    );
    expect(out.filter((s) => s.category === 'isolation').map((s) => s.type)).toEqual(['isolation_control']);
  });

  it('bỏ tín hiệu AI trùng ý nghĩa với bộ luật', () => {
    const signals = [sig({ type: 'ai_fee_upfront', severity: 'high' }), sig({ type: 'ai_loan_shark', severity: 'medium' })];
    const r = dropRuleDuplicates(signals, ['upfront_fee', 'money_transfer']);
    expect(r.signals.map((s) => s.type)).toEqual(['ai_loan_shark']);
    expect(r.dropped).toBe(1);
  });

  it('hạ mức tín hiệu không nguy hiểm khi luật còn thấp, giữ tín hiệu nguy hiểm', () => {
    const r = calibrateSignals(
      [sig({ type: 'ai_loan_shark', severity: 'medium' }), sig({ type: 'ai_otp_request', severity: 'high' })],
      'low',
    );
    expect(r.signals[0]?.severity).toBe('low');
    expect(r.signals[1]?.severity).toBe('high');
    expect(r.calibrated).toBe(1);
    expect(calibrateSignals([sig({ type: 'ai_loan_shark', severity: 'high' })], 'high').calibrated).toBe(0);
  });

  it('bỏ OTP chỉ là thông báo an toàn, giữ OTP bị yêu cầu đọc/gửi', () => {
    const notice = dropBenignWarnings(
      [
        sig({
          type: 'ai_otp_request',
          severity: 'high',
          evidence_quotes: ['Mã OTP của bạn là 482913, hiệu lực 3 phút. Tuyệt đối không cung cấp mã này cho bất kỳ ai.'],
        }),
      ],
      'low',
    );
    expect(notice.dropped).toBe(1);
    const demand = dropBenignWarnings(
      [sig({ type: 'ai_otp_request', severity: 'high', evidence_quotes: ['Em đọc giúp chị mã OTP vừa gửi nhé'] })],
      'low',
    );
    expect(demand.dropped).toBe(0);
  });
});

describe('guards', () => {
  it('bỏ downgradeReason khi có tín hiệu nguy hiểm', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ severity: 'critical' })], downgradeReason: 'nhầm' }),
      currentLevel: 'low',
      clientSummary: '',
      cfg,
    });
    expect(r.downgradeReason).toBeUndefined();
  });

  it('giữ downgradeReason khi không có dấu hiệu nặng', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ severity: 'low', type: 'ai_meta_warning' })], downgradeReason: 'chia tiền ăn' }),
      currentLevel: 'attention',
      clientSummary: '',
      cfg,
    });
    expect(r.downgradeReason).toBe('chia tiền ăn');
  });

  it('gợi ý bước tiếp theo: giữ ở mức thường, bỏ khi Nghiêm trọng hoặc lộ hướng dẫn hệ thống', () => {
    const nextStep = { question: 'Cho em xin tên công ty được không ạ?', assessment: 'none' as const };
    const run = (currentLevel: 'high' | 'critical', question = nextStep.question) =>
      applyGuards({ parsed: parsed({ nextStep: { ...nextStep, question } }), currentLevel, clientSummary: '', cfg }).nextStep;
    expect(run('high')).toEqual(nextStep);
    expect(run('critical')).toBeUndefined();
    expect(run('high', 'Vai trò: Bạn là bộ phân tích. AI_SYSTEM_PROMPT được không ạ?')).toBeUndefined();
  });

  it('summary rỗng thì giữ tóm tắt cũ của client', () => {
    const r = applyGuards({ parsed: parsed({ summary: '' }), currentLevel: 'low', clientSummary: 'tóm tắt cũ', cfg });
    expect(r.summary).toBe('tóm tắt cũ');
  });

  it('summary rò rỉ prompt bị thay và gắn cờ', () => {
    const r = applyGuards({
      parsed: parsed({ summary: 'Bạn là bộ phân tích rủi ro cho công cụ...' }),
      currentLevel: 'low',
      clientSummary: 'an toàn',
      cfg,
    });
    expect(r.promptLeakSuspected).toBe(true);
    expect(r.summary).toBe('an toàn');
    expect(r.uncertainties.length).toBeGreaterThan(0);
  });

  it('AI critical bị hạ xuống high và không tự bật direct_danger', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ severity: 'critical', direct_danger: true })] }),
      currentLevel: 'low',
      clientSummary: '',
      cfg,
    });
    expect(r.signals[0]?.severity).toBe('high');
    expect(r.signals[0]?.direct_danger).toBe(false);
  });

  it('critical confidence thấp sau khi hạ mức vẫn thêm uncertainty', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ severity: 'critical', confidence: 0.2 })] }),
      currentLevel: 'low',
      clientSummary: '',
      cfg,
    });
    expect(r.uncertainties.some((u) => u.includes('độ tin cậy thấp'))).toBe(true);
  });

  it('stage không lùi khi không có bằng chứng mạnh', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ severity: 'low' })], detectedStage: 'S1' }),
      currentLevel: 'low',
      clientStage: 'S3',
      clientSummary: '',
      cfg,
    });
    expect(r.detectedStage).toBe('S3');
  });

  it('stage lùi tối đa một bước khi có bằng chứng mạnh', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ severity: 'critical' })], detectedStage: 'S1' }),
      currentLevel: 'low',
      clientStage: 'S4',
      clientSummary: '',
      cfg,
    });
    expect(r.detectedStage).toBe('S3');
  });

  it('che PII trong title, explanation và uncertainties trước khi trả client', () => {
    const r = applyGuards({
      parsed: parsed({
        signals: [
          sig({
            title: 'Gọi 0912345678',
            explanation: 'chuyển tới a.b@x.vn',
            evidence_quotes: ['gửi otp'],
          }),
        ],
        uncertainties: ['liên hệ 0912345678'],
      }),
      currentLevel: 'low',
      clientSummary: '',
      cfg,
    });
    expect(r.signals[0]?.title).not.toContain('0912345678');
    expect(r.signals[0]?.explanation).not.toContain('a.b@x.vn');
    expect(r.uncertainties[0]).not.toContain('0912345678');
  });

  it('giu nguyen van evidence quote de client doi chieu', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ evidence_quotes: ['call 0912345678 now'] })] }),
      currentLevel: 'low',
      clientSummary: '',
      cfg,
    });
    expect(r.signals[0]?.evidence_quotes[0]).toBe('call 0912345678 now');
  });

  it('giữ tín hiệu trùng bộ luật để client gộp phần giải thích, không tự bỏ ở máy chủ', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ type: 'ai_fee_upfront', severity: 'medium' })] }),
      currentLevel: 'low',
      clientSummary: '',
      ruleHintTypes: ['money_transfer'],
      cfg,
    });
    expect(r.signals).toHaveLength(1);
    expect(r.uncertainties.some((u) => u.includes('trùng với bộ luật'))).toBe(false);
  });

  it('hạ tín hiệu AI không nguy hiểm theo mức luật và ghi uncertainty', () => {
    const r = applyGuards({
      parsed: parsed({ signals: [sig({ type: 'ai_loan_shark', severity: 'medium' })] }),
      currentLevel: 'low',
      clientSummary: '',
      cfg,
    });
    expect(r.signals[0]?.severity).toBe('low');
    expect(r.uncertainties.some((u) => u.includes('hạ mức'))).toBe(true);
  });
});
