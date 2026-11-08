import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../lib/csv';
import { rowsToCases, type BenchCase } from '../lib/dataset';
import { caseReplayStats, computeReplayMetrics, goldAt, replayCase, type ReplayResult } from '../lib/replay';
import { DailyCapReached } from '../providers/openrouter';

const { header, rows } = parseCsv(readFileSync(join(__dirname, '../dataset/TEMPLATE_v2.csv'), 'utf8'));
const cases = rowsToCases(header, rows).cases;
const job = cases.find((c) => c.id === 'V2_JOB_001')!;
const ben = cases.find((c) => c.id === 'V2_BEN_001')!;

describe('phát lại từng tin — chỉ bộ luật', () => {
  it('ca leo thang chậm: đúng mọi mốc, phát hiện đúng lúc, không dao động', async () => {
    const r = await replayCase(job);
    expect(r.turns.map((t) => t.level)).toEqual(['low', 'low', 'attention', 'attention', 'high', 'critical', 'critical', 'critical']);
    expect(r.aiCalls).toBe(0);
    const s = caseReplayStats(job, r);
    expect(s).toMatchObject({
      checkpointsTotal: 5,
      checkpointsCorrect: 5,
      detectionDelay: 0,
      neverDetected: false,
      prematureAlarmTurns: 0,
      directionChanges: 0,
      unwarrantedDrops: 0,
    });
  });
  it('ca mượn tiền đã xác minh (luật v0.4): Cần chú ý khi nhờ mượn, giữ 1 lần rồi hạ về Thấp sau xác minh — đúng 4/4 mốc', async () => {
    const r = await replayCase(ben);
    expect(r.turns.map((t) => t.level)).toEqual(['low', 'low', 'attention', 'attention', 'low', 'low']);
    const s = caseReplayStats(ben, r);
    expect(s.checkpointsCorrect).toBe(4);
    expect(s.prematureAlarmTurns).toBe(0);
    expect(s.unwarrantedDrops).toBe(0);
  });
});

describe('chống dao động trong phát lại', () => {
  // AI (một mình) gợi ý mức Cao ở lượt gọi đầu tiên — luật không thấy gì
  const quiet: BenchCase = {
    id: 'Q1',
    group: 0,
    kind: 'benign',
    gold: 'low',
    tags: [],
    source: 'tu_viet',
    messages: ['Em ơi chị có việc này cho em làm thêm nè', 'Việc nhẹ thôi em', 'Ở nhà làm cũng được', 'Em rảnh buổi nào', 'Chị gửi thông tin sau nha', 'Em cứ suy nghĩ thêm'].map(
      (text, i) => ({ id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender: 'other' as const, text }),
    ),
  };
  const aiHigh = JSON.stringify({
    signals: [
      {
        type: 'vague_offer',
        category: 'job_terms',
        severity: 'high',
        title: 'Mời việc mơ hồ',
        explanation: '',
        evidence_message_ids: ['msg-001'],
        evidence_quotes: ['có việc này'],
      },
    ],
    summary: '',
  });
  it('luật chưa thấy gì: AI một mình chỉ nâng tới Cần chú ý, mức hiển thị lên cùng lúc với mức thô', async () => {
    const raw = await replayCase(quiet, { callAi: async () => aiHigh, stability: false });
    const stable = await replayCase(quiet, { callAi: async () => aiHigh });
    expect(raw.turns.some((t) => t.level === 'high')).toBe(false);
    const firstRaw = raw.turns.findIndex((t) => t.level === 'attention');
    const firstStable = stable.turns.findIndex((t) => t.level === 'attention');
    expect(firstRaw).toBeGreaterThanOrEqual(0);
    expect(firstStable).toBe(firstRaw);
  });
});

describe('chỉ số diễn biến', () => {
  const noCp: BenchCase = { ...job, checkpoints: undefined, dangerTurn: 2, gold: 'high' };
  const fake = (levels: ReplayResult['turns'][number]['level'][]): ReplayResult => ({
    turns: levels.map((level, i) => ({ dpTurn: i + 1, level, rawLevel: level, aiCalled: false })),
    finalLevel: levels.at(-1)!,
    aiCalls: 0,
    aiErrors: 0,
  });
  it('đếm đổi chiều và hạ mức vô cớ; độ trễ theo tin_nguy_hiem khi không có mốc', () => {
    const s = caseReplayStats(noCp, fake(['low', 'high', 'attention', 'high']));
    expect(s.directionChanges).toBe(2);
    expect(s.unwarrantedDrops).toBe(1);
    expect(s.detectionDelay).toBe(0);
    expect(s.checkpointsTotal).toBe(1); // mốc ngầm định ở tin cuối
  });
  it('hạ mức đúng lúc nhãn hạ thì không tính là vô cớ', () => {
    const s = caseReplayStats(ben, fake(['low', 'low', 'attention', 'attention', 'low', 'low']));
    expect(s.unwarrantedDrops).toBe(0);
    expect(s.checkpointsCorrect).toBe(4);
  });
  it('goldAt là hàm bậc thang, trước mốc đầu không xác định', () => {
    expect(goldAt(job.checkpoints!, 1)).toBeUndefined();
    expect(goldAt(job.checkpoints!, 4)).toBe('attention');
    expect(goldAt(job.checkpoints!, 7)).toBe('critical');
  });
  it('tổng hợp: muộn, không bao giờ, lượt AI / 10 tin', () => {
    const a = caseReplayStats(noCp, fake(['low', 'low', 'high', 'high'])); // muộn 1 tin
    const b = caseReplayStats(noCp, fake(['low', 'low', 'low', 'low'])); // không bao giờ
    const m = computeReplayMetrics([a, b], 8, 0);
    expect(m.lateRate).toBe(0.5);
    expect(m.neverRate).toBe(0.5);
    expect(m.medianDelay).toBe(1);
    expect(m.aiCallsPer10Turns).toBe(0);
  });
});

describe('phát lại với AI theo chính sách sản phẩm', () => {
  const okResponse = JSON.stringify({ signals: [], summary: 'tóm tắt', risk_level: 'low' });
  it('chỉ gọi AI khi chính sách cho phép (ít hơn số tin), gửi delta + tóm tắt', async () => {
    const reqs: { user: string }[] = [];
    const r = await replayCase(job, {
      callAi: async (req) => {
        reqs.push(req);
        return okResponse;
      },
    });
    expect(r.aiCalls).toBeGreaterThan(0);
    expect(r.aiCalls).toBeLessThan(job.messages.length);
    expect(reqs.slice(1).every((q) => q.user.includes('tóm tắt'))).toBe(true);
    expect(r.turns.filter((t) => t.aiCalled).length).toBeGreaterThan(1);
    expect(r.turns.find((t) => t.aiCalled)?.aiReason).toBe('Đủ 2 tin mới');
    expect(r.turns[4]!.level).toBe('high'); // luật vẫn cảnh báo sau từng tin
    expect(r.turns[2]!.level).toBe('attention');
    // AI không thêm tín hiệu → mức giữ nguyên như chỉ luật
    expect(r.finalLevel).toBe('critical');
  });
  it('idleFlushSec = 0: không gọi nốt tin lẻ', async () => {
    const lots = await replayCase(job, { callAi: async () => okResponse, batchSize: 5 });
    const r = await replayCase(job, { callAi: async () => okResponse, batchSize: 5, idleFlushSec: 0 });
    expect(r.aiCalls).toBe(lots.aiCalls - 1);
    expect(lots.turns.filter((t) => t.aiCalled).at(-1)?.aiReason).toBe('Hội thoại dừng 20 giây');
  });
  it('AI lỗi: đếm lỗi, giữ kết quả luật', async () => {
    const r = await replayCase(job, { callAi: async () => 'không phải json' });
    expect(r.aiErrors).toBe(r.aiCalls);
    expect(r.finalLevel).toBe('critical');
  });
  it('hết lượt trong ngày: dừng hẳn, không nuốt lỗi', async () => {
    await expect(
      replayCase(job, {
        callAi: async () => {
          throw new DailyCapReached('hết lượt');
        },
      }),
    ).rejects.toBeInstanceOf(DailyCapReached);
  });
});
