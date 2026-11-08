import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../src/shared/protocol';
import { SESSION_KEY } from '../src/shared/protocol';
import { createSnapshot, serializeSnapshot } from '@safechat/core/context-manager';
import { appendObserved, emptyTranscript } from '@safechat/core/transcript';
import { installFakeChrome } from './fakeChrome';

const fake = installFakeChrome();
const TAB = 7;
let thread = { threadId: 'mock:05', threadLabel: 'Chat thử' };
const contentCalls: string[] = [];
const startMsgs: unknown[] = [];
let probeOverride: unknown = null;

fake.onTab(TAB, (msg) => {
  const m = msg as { kind: string };
  contentCalls.push(m.kind);
  if (m.kind === 'cs_start') startMsgs.push(msg);
  if (m.kind === 'cs_probe') return probeOverride ?? { supported: true, platform: 'mock', ...thread };
  return { ok: true };
});

const session = async () =>
  ((await fake.chrome.storage.session.get(SESSION_KEY)) as Record<string, Session>)[SESSION_KEY] ?? null;
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeAll(async () => {
  await import('../src/background/index');
});

describe('background — vòng đời phiên', () => {
  it('chưa bắt đầu thì không lưu gì', async () => {
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:05', batch: [{ sender: 'other', text: 'x' }] });
    await tick();
    expect(await session()).toBeNull();
  });

  it('bắt đầu → nhận tin → phân tích và khử trùng lặp', async () => {
    expect(await fake.panel({ kind: 'start', tabId: TAB })).toMatchObject({ ok: true });
    expect(contentCalls).toContain('cs_start');
    const batch = [
      { sender: 'other', text: 'Bên chị hoàn toàn miễn phí, không thu phí gì của ứng viên đâu em.' },
      { sender: 'other', text: 'Giờ em chỉ cần đóng phí kích hoạt 500k là được nhận việc luôn.' },
    ];
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:05', batch });
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:05', batch }); // DOM render lại
    await tick();
    const s = (await session())!;
    expect(s.status).toBe('tracking');
    expect(s.transcript.messages).toHaveLength(2);
    expect(s.result?.risk_level).toBe('high');
    expect(s.result?.signals.map((x) => x.type)).toContain('possible_contradiction');
    expect(fake.badge.text).toBe('!!');
  });

  it('bỏ qua tin từ tab khác hoặc thread khác', async () => {
    await fake.content(99, { kind: 'cs_messages', threadId: 'mock:05', batch: [{ sender: 'other', text: 'tab khác' }] });
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:xx', batch: [{ sender: 'other', text: 'thread khác' }] });
    await tick();
    expect((await session())!.transcript.messages).toHaveLength(2);
  });

  it('chuyển chat → tạm dừng, không trộn dữ liệu; xác nhận → phiên mới sạch', async () => {
    await fake.content(TAB, { kind: 'cs_thread_changed', threadId: 'mock:09', threadLabel: 'Chat khác' });
    await tick();
    let s = (await session())!;
    expect(s.status).toBe('paused');
    expect(s.pauseReason).toBe('thread_changed');
    expect(s.pendingThread?.threadId).toBe('mock:09');
    // Khi tạm dừng, tin mới không được ghi
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:05', batch: [{ sender: 'other', text: 'tin lúc tạm dừng' }] });
    await tick();
    expect((await session())!.transcript.messages).toHaveLength(2);

    thread = { threadId: 'mock:09', threadLabel: 'Chat khác' };
    expect(await fake.panel({ kind: 'switch_to_pending' })).toMatchObject({ ok: true });
    s = (await session())!;
    expect(s.threadId).toBe('mock:09');
    expect(s.transcript.messages).toHaveLength(0);
    expect(s.status).toBe('tracking');
  });

  it('đóng tab → tạm dừng', async () => {
    fake.closeTab(TAB);
    await tick();
    const s = (await session())!;
    expect(s.status).toBe('paused');
    expect(s.pauseReason).toBe('tab_closed');
  });

  // ---------- gateway ----------
  const GW = 'https://gw.test';
  let tokenSeq = 0;
  type Stats = { devices: number; analyses: number; bodies: Record<string, any>[]; auth: string[] };

  /** Giả lập gateway: /v1/devices cấp token mới; /v1/analyses do từng test quyết định theo lượt gọi thứ n. */
  let current: Stats | null = null;
  const fetchedAnalyses = () => current?.analyses ?? 0;

  function mockGateway(analyses: (n: number) => Response): Stats {
    const stats: Stats = { devices: 0, analyses: 0, bodies: [], auth: [] };
    current = stats;
    globalThis.fetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      if (url === `${GW}/v1/devices`) {
        stats.devices++;
        return new Response(
          JSON.stringify({ token: `tok-${++tokenSeq}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
          { status: 200 },
        );
      }
      if (url === `${GW}/v1/analyses`) {
        stats.analyses++;
        stats.bodies.push(JSON.parse(init.body));
        stats.auth.push(init.headers.Authorization ?? '');
        return analyses(stats.analyses);
      }
      throw new Error(`URL ngoài dự kiến: ${url}`);
    }) as unknown as typeof fetch;
    return stats;
  }

  const okResponse = (signals: unknown[], summary = 'Tuyển dụng, có yêu cầu phí.') =>
    new Response(
      JSON.stringify({ signals, summary, uncertainties: [], rejected: 0, usage: { tier: 'large', model: 'test-model' } }),
      { status: 200 },
    );
  const errResponse = (status: number, code: string) =>
    new Response(JSON.stringify({ error: { code, message: 'x' } }), { status });

  const goodSignal = {
    type: 'vague_task',
    category: 'job_terms',
    severity: 'medium',
    title: 'Mô tả công việc mơ hồ',
    explanation: 'Không nói rõ việc phải làm.',
    evidence_message_ids: ['msg-002'],
    evidence_quotes: ['đóng phí kích hoạt'],
  };

  async function startAiSession(id: string) {
    const before = fetchedAnalyses();
    thread = { threadId: id, threadLabel: 'AI' };
    await fake.panel({ kind: 'stop_and_clear' });
    await fake.panel({ kind: 'start', tabId: TAB });
    await fake.content(TAB, {
      kind: 'cs_messages',
      threadId: id,
      batch: [
        { sender: 'other', text: 'Bên chị hoàn toàn miễn phí, không thu phí gì đâu em.' },
        { sender: 'other', text: 'Giờ em đóng phí kích hoạt 500k, gọi 0912 345 678 nhé.' },
      ],
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(fetchedAnalyses()).toBe(before); // mới 2 tin: luật đã cảnh báo, AI chờ đủ 5 tin
    await fake.content(TAB, {
      kind: 'cs_messages',
      threadId: id,
      batch: [
        { sender: 'other', text: 'Em đóng sớm để giữ chỗ nha.' },
        { sender: 'other', text: 'Việc nhẹ, làm ở nhà thôi.' },
        { sender: 'other', text: 'Chị chờ em phản hồi.' },
      ],
    });
    await new Promise((r) => setTimeout(r, 800));
  }

  it('Gateway: chỉ gửi delta đã che PII kèm token thiết bị; kết quả hợp lệ được gộp', async () => {
    const gw = mockGateway(() => okResponse([goodSignal]));
    (fake.chrome.permissions as { contains: () => Promise<boolean> }).contains = async () => true;
    await fake.chrome.storage.local.set({
      safechat_settings: { policyVersion: 2, gatewayEnabled: true, gatewayUrl: GW, minIntervalSec: 3, batchSize: 5, dailyBudget: 50 },
    });
    await startAiSession('mock:ai');
    const s = (await session())!;
    expect(gw.analyses).toBe(1);
    expect(gw.devices).toBe(1);
    expect(gw.auth[0]).toMatch(/^Bearer tok-\d+$/);
    const body = gw.bodies[0]!;
    expect(body.client).toBe('extension');
    expect(body.tier).toBe('large'); // mức Cao → tầng lớn
    const sent = JSON.stringify(body);
    expect(sent).toContain('[SỐ]');
    expect(sent).not.toContain('0912 345 678');
    expect(sent.toLowerCase()).not.toContain('groq');
    expect(s.ai.status).toBe('ok');
    expect(s.ai.lastProvider).toBe('gateway');
    expect(s.ai.lastModel).toBe('test-model');
    expect(s.ai.summary).toBe('Tuyển dụng, có yêu cầu phí.');
    expect(s.result?.signals.some((x) => x.type.includes('vague_task'))).toBe(true);
    expect(s.timeline.length).toBeGreaterThan(0);
    const local = (await fake.chrome.storage.local.get(null)) as Record<string, any>;
    expect(local.safechat_ai_usage?.count).toBe(1);
    expect(local.safechat_device?.baseUrl).toBe(GW);
  });

  it('Gateway: câu gợi ý an toàn đứng đầu kèm lý do; câu nguy hiểm bị client chặn dù gateway đã cho qua', async () => {
    const reply = (question: string) =>
      new Response(
        JSON.stringify({
          signals: [goodSignal],
          summary: 'x',
          uncertainties: [],
          rejected: 0,
          nextStep: { question, reason: 'Chưa rõ pháp nhân', assessment: 'evasive' },
          usage: { tier: 'large', model: 'test-model' },
        }),
        { status: 200 },
      );
    (fake.chrome.permissions as { contains: () => Promise<boolean> }).contains = async () => true;
    await fake.chrome.storage.local.set({
      safechat_settings: { policyVersion: 2, gatewayEnabled: true, gatewayUrl: GW, minIntervalSec: 3, batchSize: 5, dailyBudget: 50 },
    });
    mockGateway(() => reply('Cho em xin mã số thuế của công ty được không ạ?'));
    await startAiSession('mock:ai-next');
    const good = (await session())!;
    expect(good.ai.nextStep?.atSeq).toBeGreaterThan(0);
    expect(good.result?.advice.questions[0]).toContain('mã số thuế');
    expect(good.result?.advice.question_reason).toBe('Chưa rõ pháp nhân');
    expect(good.result?.advice.answer_assessment).toBe('evasive');

    mockGateway(() => reply('Em gửi mã OTP cho anh để xác minh nhé?'));
    await startAiSession('mock:ai-next-bad');
    const bad = (await session())!;
    expect(bad.ai.nextStep).toBeUndefined();
    expect(bad.result?.advice.questions.join(' ')).not.toContain('OTP');
    expect(bad.result?.advice.questions.length).toBeGreaterThan(0);
  });

  it('quét ban đầu: yêu cầu tải lịch sử, ghi tiến độ, AI chạy ngay lượt sâu', async () => {
    const gw = mockGateway(() => okResponse([]));
    await fake.chrome.storage.local.set({
      safechat_settings: { gatewayEnabled: true, gatewayUrl: GW, dailyBudget: 50 },
    });
    thread = { threadId: 'mock:scan', threadLabel: 'Quét' };
    await fake.panel({ kind: 'stop_and_clear' });
    startMsgs.length = 0;
    await fake.panel({ kind: 'start', tabId: TAB });
    await fake.panel({ kind: 'reanalyze' });
    expect(startMsgs).toEqual([{ kind: 'cs_start', threadId: 'mock:scan', loadHistory: true, allowScroll: true }]);
    await fake.content(TAB, { kind: 'cs_scan_started', threadId: 'mock:scan', target: 50, scroll: true });
    await tick();
    expect((await session())!.scan).toEqual({ state: 'loading', target: 50, scroll: true });
    const batch = Array.from({ length: 30 }, (_, i) => ({ sender: 'other', text: `Tin lịch sử ${i + 1}` }));
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:scan', batch, initial: { target: 50, complete: true } });
    await new Promise((r) => setTimeout(r, 700));
    const s = (await session())!;
    expect(s.scan).toEqual({ state: 'done', target: 50, scroll: true, read: 30, complete: true });
    expect(s.transcript.messages).toHaveLength(30);
    expect(gw.analyses).toBe(1);
    expect(gw.bodies[0]!.tier).toBe('large');
    expect(gw.bodies[0]!.messages).toHaveLength(30);
    expect(s.ai.lastReason).toBe('Quét ban đầu 30 tin');
  });

  it('widget chọn không cuộn khi khóa chat: không cuộn và lưu lại lựa chọn', async () => {
    mockGateway(() => okResponse([]));
    await fake.chrome.storage.local.set({ safechat_settings: { policyVersion: 2, gatewayEnabled: true, gatewayUrl: GW, dailyBudget: 50, historyScroll: true } });
    thread = { threadId: 'mock:widget', threadLabel: 'Widget' };
    await fake.panel({ kind: 'stop_and_clear' });
    startMsgs.length = 0;
    await fake.panel({ kind: 'start', tabId: TAB, allowScroll: false });
    expect(startMsgs).toEqual([{ kind: 'cs_start', threadId: 'mock:widget', loadHistory: true, allowScroll: false }]);
    const local = (await fake.chrome.storage.local.get(null)) as Record<string, any>;
    expect(local.safechat_settings.historyScroll).toBe(false);
    await fake.panel({ kind: 'stop_and_clear' });
    startMsgs.length = 0;
    await fake.panel({ kind: 'start', tabId: TAB });
    expect(startMsgs).toEqual([{ kind: 'cs_start', threadId: 'mock:widget', loadHistory: true, allowScroll: false }]);
  });

  it('lưu và thu hồi đồng ý quét, không chạm cài đặt khác', async () => {
    await fake.chrome.storage.local.set({ safechat_settings: { policyVersion: 2, historyScroll: false } });
    await fake.panel({ kind: 'set_scan_consent', value: true });
    let local = (await fake.chrome.storage.local.get(null)) as Record<string, any>;
    expect(local.safechat_settings.scanConsent).toBe(true);
    expect(local.safechat_settings.historyScroll).toBe(false);
    await fake.panel({ kind: 'set_scan_consent', value: false });
    local = (await fake.chrome.storage.local.get(null)) as Record<string, any>;
    expect(local.safechat_settings.scanConsent).toBe(false);
  });

  it('tắt đọc QR: báo content script không đọc, bật lại thì bỏ cờ', async () => {
    mockGateway(() => okResponse([]));
    await fake.chrome.storage.local.set({ safechat_settings: { policyVersion: 2, gatewayEnabled: false, historyScroll: true } });
    thread = { threadId: 'mock:qr', threadLabel: 'QR' };
    await fake.panel({ kind: 'stop_and_clear' });
    await fake.panel({ kind: 'set_qr_scan', value: false });
    startMsgs.length = 0;
    await fake.panel({ kind: 'start', tabId: TAB });
    expect(startMsgs).toEqual([{ kind: 'cs_start', threadId: 'mock:qr', loadHistory: true, allowScroll: true, readQr: false }]);
    await fake.panel({ kind: 'stop_and_clear' });
    await fake.panel({ kind: 'set_qr_scan', value: true });
    startMsgs.length = 0;
    await fake.panel({ kind: 'start', tabId: TAB });
    expect(startMsgs).toEqual([{ kind: 'cs_start', threadId: 'mock:qr', loadHistory: true, allowScroll: true }]);
    await fake.panel({ kind: 'set_qr_scan', value: true });
  });

  it('chọn không cuộn: báo content script không được cuộn, vẫn đọc và đánh giá ngay', async () => {
    const gw = mockGateway(() => okResponse([]));
    await fake.chrome.storage.local.set({
      safechat_settings: { policyVersion: 2, gatewayEnabled: true, gatewayUrl: GW, dailyBudget: 50, historyScroll: false },
    });
    thread = { threadId: 'mock:noscroll', threadLabel: 'Không cuộn' };
    await fake.panel({ kind: 'stop_and_clear' });
    startMsgs.length = 0;
    await fake.panel({ kind: 'start', tabId: TAB });
    await fake.panel({ kind: 'reanalyze' });
    expect(startMsgs).toEqual([{ kind: 'cs_start', threadId: 'mock:noscroll', loadHistory: true, allowScroll: false }]);
    await fake.content(TAB, { kind: 'cs_scan_started', threadId: 'mock:noscroll', target: 50, scroll: false });
    const batch = Array.from({ length: 12 }, (_, i) => ({ sender: 'other', text: `Tin đang hiện ${i + 1}` }));
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:noscroll', batch, initial: { target: 50, complete: true } });
    await new Promise((r) => setTimeout(r, 700));
    const s = (await session())!;
    expect(s.scan).toEqual({ state: 'done', target: 50, scroll: false, read: 12, complete: true });
    expect(s.transcript.messages).toHaveLength(12);
    expect(gw.analyses).toBe(1);
  });

  it('cài đặt cũ 5 tin, 60 giây nhận mặc định mới một lần; đặt lại sau đó thì giữ', async () => {
    await fake.chrome.storage.local.set({ safechat_settings: { gatewayEnabled: true, gatewayUrl: GW, batchSize: 5, idleFlushSec: 60, minIntervalSec: 10 } });
    await fake.panel({ kind: 'reanalyze' });
    const a = (await fake.chrome.storage.local.get(null)) as Record<string, any>;
    expect(a.safechat_settings.batchSize).toBeUndefined();
    expect(a.safechat_settings.policyVersion).toBe(2);
    await fake.chrome.storage.local.set({ safechat_settings: { ...a.safechat_settings, batchSize: 3 } });
    await fake.panel({ kind: 'reanalyze' });
    const b = (await fake.chrome.storage.local.get(null)) as Record<string, any>;
    expect(b.safechat_settings.batchSize).toBe(3);
  });

  it('cs_ready: phiên đang theo dõi trên đúng tab → đọc tiếp; tab khác → không làm gì', async () => {
    contentCalls.length = 0;
    await fake.content(99, { kind: 'cs_ready' });
    await tick();
    expect(contentCalls).not.toContain('cs_start');
    await fake.content(TAB, { kind: 'cs_ready' });
    await tick();
    expect(contentCalls).toContain('cs_start');
  });

  it('Gateway: 401 → cấp lại token thiết bị đúng một lần rồi gọi lại', async () => {
    const gw = mockGateway((n) => (n === 1 ? errResponse(401, 'UNAUTHORIZED') : okResponse([goodSignal])));
    await startAiSession('mock:ai401');
    const s = (await session())!;
    expect(gw.analyses).toBe(2);
    expect(gw.devices).toBe(1);
    expect(gw.auth[1]).not.toBe(gw.auth[0]);
    expect(s.ai.status).toBe('ok');
  });

  it('Gateway: trích dẫn không khớp tin gốc bị loại ở client', async () => {
    mockGateway(() =>
      okResponse([{ ...goodSignal, evidence_message_ids: ['msg-001'], evidence_quotes: ['câu này không hề có trong tin nhắn'] }]),
    );
    await startAiSession('mock:aibad');
    const s = (await session())!;
    expect(s.ai.signals).toHaveLength(0);
    expect(s.ai.error).toContain('Đã loại');
  });

  it('Gateway lỗi → báo lỗi tiếng Việt, mức của bộ quy tắc không bị hạ', async () => {
    mockGateway(() => errResponse(500, 'INTERNAL'));
    await startAiSession('mock:aierr');
    const s = (await session())!;
    expect(s.ai.status).toBe('error');
    expect(s.ai.error).toContain('Bộ quy tắc vẫn tiếp tục chạy');
    expect(s.result?.risk_level).toBe('high');
  });

  it('Cài đặt cũ: khóa Groq bị xóa khỏi storage; tắt gateway thì xóa token thiết bị', async () => {
    await fake.chrome.storage.local.set({
      safechat_settings: { groqEnabled: true, groqApiKey: 'old-key', gatewayEnabled: false, gatewayUrl: '' },
    });
    expect(await fake.panel({ kind: 'reanalyze' })).toMatchObject({ ok: true });
    const local = (await fake.chrome.storage.local.get(null)) as Record<string, any>;
    expect(JSON.stringify(local.safechat_settings)).not.toContain('groq');
    expect(local.safechat_device).toBeUndefined();
  });

  it('chưa đủ 5 tin: đặt alarm, đến giờ thì gọi nốt tin lẻ; dừng phiên thì bỏ alarm', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const gw = mockGateway(() => okResponse([], 'Đã đọc tin lẻ.'));
    await fake.chrome.storage.local.set({
      safechat_settings: { policyVersion: 2, gatewayEnabled: true, gatewayUrl: GW, minIntervalSec: 3, batchSize: 5, idleFlushSec: 1, dailyBudget: 50 },
    });
    thread = { threadId: 'mock:idle', threadLabel: 'Tin lẻ' };
    await fake.panel({ kind: 'stop_and_clear' });
    await fake.panel({ kind: 'start', tabId: TAB });
    await fake.panel({ kind: 'reanalyze' }); // bỏ thời gian nghỉ do lỗi ở test trước
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:idle', batch: [{ sender: 'other', text: 'Em rảnh không?' }] });
    await wait(500);
    expect(gw.analyses).toBe(0);
    expect(fake.alarms.has('safechat_ai_idle')).toBe(true);

    await wait(700); // đã qua 1 giây kể từ tin cuối
    fake.fireAlarm('safechat_ai_idle');
    await wait(300);
    expect(gw.analyses).toBe(1);
    expect((await session())!.ai.lastReason).toBe('Hội thoại dừng 1 giây');

    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:idle', batch: [{ sender: 'other', text: 'Em rảnh không?' }, { sender: 'other', text: 'Trả lời chị nhé' }] });
    await wait(500);
    expect(fake.alarms.has('safechat_ai_idle')).toBe(true);
    await fake.panel({ kind: 'stop_and_clear' });
    expect(fake.alarms.has('safechat_ai_idle')).toBe(false);
  });

  it('Gateway lỗi liên tục: dừng sau 3 lần, thử lại khi có tin mới hoặc đổi cài đặt', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const fail = () => new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'x', retryAfterSec: 0.01 } }), { status: 500 });
    let ok = false;
    const gw = mockGateway(() => (ok ? okResponse([], 'Đã ổn.') : fail()));
    await fake.chrome.storage.local.set({
      safechat_settings: { policyVersion: 2, gatewayEnabled: true, gatewayUrl: GW, minIntervalSec: 0.01, batchSize: 5, dailyBudget: 50 },
    });
    thread = { threadId: 'mock:fail', threadLabel: 'Lỗi' };
    await fake.panel({ kind: 'stop_and_clear' });
    await fake.panel({ kind: 'start', tabId: TAB });
    await fake.panel({ kind: 'reanalyze' });
    const batch = ['một', 'hai', 'ba', 'bốn', 'năm'].map((w) => ({ sender: 'other', text: `Tin số ${w}` }));
    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:fail', batch });
    await wait(4000); // đủ thời gian cho nhiều hơn 3 lần nếu không dừng
    expect(gw.analyses).toBe(3);
    let s = (await session())!;
    expect(s.ai.status).toBe('error');
    expect(s.ai.error).toContain('Đã tạm dừng AI');
    expect(s.result?.risk_level).toBeDefined(); // luật vẫn có kết quả

    await fake.content(TAB, { kind: 'cs_messages', threadId: 'mock:fail', batch: [...batch, { sender: 'other', text: 'Tin số sáu' }] });
    await wait(1500);
    expect(gw.analyses).toBe(4); // tin mới: thử đúng 1 lần rồi dừng tiếp

    // Đổi cài đặt: bỏ thời gian nghỉ dù máy chủ vừa yêu cầu nghỉ 10 phút
    ok = true;
    await fake.panel({ kind: 'reanalyze' });
    await wait(600);
    expect(gw.analyses).toBe(5);
    s = (await session())!;
    expect(s.ai.status).toBe('ok');
    expect(s.ai.failures).toBeUndefined();
    expect(s.ai.gaveUpAtSeq).toBeUndefined();
  }, 15_000);

  it('dừng và xóa → storage.session trống, xác nhận đã xóa', async () => {
    const r = await fake.panel({ kind: 'stop_and_clear' });
    expect(r).toEqual({ ok: true, remainingKeys: [] });
    expect(Object.keys(fake.chrome.storage.session._dump())).toHaveLength(0);
    expect(contentCalls.at(-1)).toBe('cs_stop');
    expect(fake.badge.text).toBe('');
  });
});

describe('background — Context Manager: tiếp tục từ bản nháp', () => {
  const t = emptyTranscript();
  appendObserved(t, [
    { sender: 'other', text: 'Bên chị hoàn toàn miễn phí, không thu phí gì đâu em.' },
    { sender: 'self', text: 'Dạ vâng' },
    { sender: 'other', text: 'Giờ em đóng phí kích hoạt 500k nhé.' },
  ]);
  const snapshot = serializeSnapshot(
    createSnapshot({
      threadLabel: 'Chat thử',
      platform: 'mock',
      startedAt: 1_700_000_000_000,
      maxMessages: 300,
      transcript: t,
      ai: { summary: 'Có đòi phí sau khi nói miễn phí', signals: [], uncertainties: [], lastSeq: 3, calls: 2 },
      marks: { 'upfront_fee:msg-003': 'review' },
      timeline: [],
      stability: { displayed: 'high', maxLevel: 'high', lastEvalKey: '3:2', recentRaw: ['high'] },
    }),
  );

  it('file hỏng → báo lỗi tiếng Việt, không tạo phiên', async () => {
    const r = (await fake.panel({ kind: 'resume_snapshot', tabId: TAB, snapshot: '{"x":1}' })) as { ok: boolean; reason: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('không phải file phiên');
    expect(await session()).toBeNull();
  });

  it('khôi phục bản nháp, tóm tắt AI, đánh dấu, trạng thái cảnh báo; tính lại kết quả; bắt đầu đọc tab', async () => {
    thread = { threadId: 'mock:resume', threadLabel: 'Chat thử' };
    contentCalls.length = 0;
    expect(await fake.panel({ kind: 'resume_snapshot', tabId: TAB, snapshot })).toMatchObject({ ok: true });
    const s = (await session())!;
    expect(s.status).toBe('tracking');
    expect(s.threadId).toBe('mock:resume');
    expect(s.transcript.messages).toHaveLength(3);
    expect(s.ai.summary).toBe('Có đòi phí sau khi nói miễn phí');
    expect(s.marks).toEqual({ 'upfront_fee:msg-003': 'review' });
    expect(s.resumedFrom?.startedAt).toBe(1_700_000_000_000);
    expect(s.result?.risk_level).toBe('high');
    expect(s.result?.signals.map((x) => x.type)).toContain('possible_contradiction');
    expect(contentCalls).toContain('cs_start');
  });

  it('tin đang hiển thị được nối tiếp không trùng lặp', async () => {
    await fake.content(TAB, {
      kind: 'cs_messages',
      threadId: 'mock:resume',
      batch: [
        { sender: 'self', text: 'Dạ vâng' },
        { sender: 'other', text: 'Giờ em đóng phí kích hoạt 500k nhé.' },
        { sender: 'other', text: 'Chuyển khoản vào STK 0123456789 giúp chị.' },
      ],
    });
    await tick();
    const s = (await session())!;
    expect(s.transcript.messages.map((m) => m.id)).toEqual(['msg-001', 'msg-002', 'msg-003', 'msg-004']);
    await fake.panel({ kind: 'stop_and_clear' });
  });
});


describe('background — nhiều khung chat popup, chờ mở lại, lỗi bộ đọc', () => {
  const A = { threadId: 'messenger:1001', threadLabel: 'Người A' };
  const B = { threadId: 'messenger:1002', threadLabel: 'Người B' };

  it('nhiều khung đang mở: phải chọn; chọn cuộc không có trong danh sách bị từ chối', async () => {
    await fake.panel({ kind: 'stop_and_clear' });
    probeOverride = { supported: true, platform: 'messenger', threads: [A, B] };
    expect(await fake.panel({ kind: 'start', tabId: TAB })).toMatchObject({ ok: false });
    expect(await fake.panel({ kind: 'start', tabId: TAB, threadId: 'messenger:9999' })).toMatchObject({ ok: false });
    expect(await fake.panel({ kind: 'start', tabId: TAB, threadId: B.threadId })).toMatchObject({ ok: true });
    const s = (await session())!;
    expect(s.threadId).toBe(B.threadId);
    expect(s.threadLabel).toBe('Người B');
  });

  it('đóng khung chat → giữ phiên ở trạng thái chờ; mở lại → đọc tiếp', async () => {
    await fake.content(TAB, { kind: 'cs_messages', threadId: B.threadId, batch: [{ sender: 'other', text: 'chào', domId: '1002@msgr.1' }] });
    await fake.content(TAB, { kind: 'cs_thread_waiting', threadId: B.threadId, waiting: true });
    await tick();
    let s = (await session())!;
    expect(s.status).toBe('tracking');
    expect(s.waiting).toBe(true);
    expect(s.transcript.messages).toHaveLength(1);
    await fake.content(TAB, { kind: 'cs_thread_waiting', threadId: B.threadId, waiting: false });
    await fake.content(TAB, { kind: 'cs_messages', threadId: B.threadId, batch: [{ sender: 'other', text: 'chào', domId: '1002@msgr.1' }, { sender: 'other', text: 'tiếp', domId: '1002@msgr.2' }] });
    await tick();
    s = (await session())!;
    expect(s.waiting).toBeUndefined();
    expect(s.transcript.messages.map((m) => m.text)).toEqual(['chào', 'tiếp']);
  });

  it('bộ đọc báo mã tin không khớp → ghi lỗi, không thêm tin; đọc lại bình thường thì xóa lỗi', async () => {
    await fake.content(TAB, { kind: 'cs_messages', threadId: B.threadId, batch: [], error: 'Mã tin nhắn không khớp' });
    await tick();
    let s = (await session())!;
    expect(s.readerError).toContain('không khớp');
    expect(s.transcript.messages).toHaveLength(2);
    await fake.content(TAB, { kind: 'cs_messages', threadId: B.threadId, batch: [{ sender: 'other', text: 'mới', domId: '1002@msgr.3' }] });
    await tick();
    s = (await session())!;
    expect(s.readerError).toBeUndefined();
    expect(s.transcript.messages).toHaveLength(3);
    probeOverride = null;
  });
});