// Xem trước giao diện side panel ngoài Chrome extension (chỉ dùng khi phát triển).
// Dựng chrome.* giả, nạp một kịch bản từ fixtures và chạy phân tích thật. ?s=<id kịch bản>&view=intro
// &threads=N: giả lập N khung chat popup đang mở (màn chọn cuộc) · &waiting=1: khung chat đã chọn đang đóng
import { recompute } from '../src/background/runtime';
import { appendObserved, emptyTranscript } from '@safechat/core/transcript';
import { DEFAULT_SETTINGS, emptyAiState, SESSION_KEY, type Session } from '../src/shared/protocol';
import scenarios from '../../../fixtures/scenarios.json';

type ScenarioItem = { id: string; title: string; messages: { sender: 'self' | 'other'; text: string }[] };
const allScenarios = scenarios as ScenarioItem[];

const params = new URLSearchParams(location.search);
let currentSc = allScenarios.find((s) => s.id === (params.get('s') ?? '05_no_fee_then_fee')) ?? allScenarios[0]!;
let stepIndex = currentSc.messages.length;

function buildSessionUpTo(sc: ScenarioItem, count: number): Session {
  const transcript = emptyTranscript();
  const s: Session = {
    status: 'tracking',
    tabId: 1,
    threadId: `mock:${sc.id}`,
    threadLabel: sc.title,
    platform: 'mock',
    startedAt: Date.now() - 7 * 60_000,
    maxMessages: 300,
    transcript,
    result: null,
    ai: emptyAiState(),
    timeline: [],
    marks: {},
    waiting: params.get('waiting') === '1' || undefined,
  };
  const slice = sc.messages.slice(0, Math.max(0, Math.min(count, sc.messages.length)));
  for (const m of slice) {
    appendObserved(transcript, [...transcript.messages, m].map((x) => ({ sender: x.sender, text: x.text })));
    recompute(s);
  }
  if (slice.length === 0) recompute(s);
  return s;
}

const sessionListeners: Array<() => void> = [];

const makeStore = (init: Record<string, unknown>, notify?: () => void) => {
  const data = { ...init };
  return {
    get: async (k: string) => (k in data ? { [k]: data[k] } : {}),
    set: async (o: Record<string, unknown>) => {
      Object.assign(data, o);
      notify?.();
    },
    remove: async (k: string) => {
      delete data[k];
      notify?.();
    },
    onChanged: {
      addListener(fn: () => void) {
        if (notify) sessionListeners.push(fn);
      },
    },
  };
};

const sessionStore = makeStore(
  params.get('view') === 'intro' ? {} : { [SESSION_KEY]: buildSessionUpTo(currentSc, stepIndex) },
  () => sessionListeners.forEach((fn) => fn()),
);

(globalThis as any).chrome = {
  storage: {
    session: sessionStore,
    local: makeStore({ safechat_settings: DEFAULT_SETTINGS }),
  },
  runtime: {
    sendMessage: async (m: { kind: string; mark?: string; key?: string }) => {
      if (m.kind === 'probe') {
        return Number(params.get('threads')) > 1
          ? {
              supported: true,
              platform: 'messenger',
              threads: Array.from({ length: Number(params.get('threads')), }, (_, i) => ({
                threadId: `messenger:${i}`,
                threadLabel: `Người thử ${i + 1}`,
              })),
            }
          : { supported: true, platform: 'mock', threadLabel: currentSc.title, threadId: `mock:${currentSc.id}` };
      }
      if (m.kind === 'start') {
        stepIndex = currentSc.messages.length;
        await sessionStore.set({ [SESSION_KEY]: buildSessionUpTo(currentSc, stepIndex) });
        return { ok: true };
      }
      if (m.kind === 'stop_and_clear') {
        await sessionStore.remove(SESSION_KEY);
        return { ok: true, remainingKeys: [] };
      }
      if (m.kind === 'pause') {
        const cur = (await sessionStore.get(SESSION_KEY))[SESSION_KEY] as Session | undefined;
        if (cur) {
          cur.status = 'paused';
          cur.pauseReason = 'user';
          await sessionStore.set({ [SESSION_KEY]: { ...cur } });
        }
        return { ok: true };
      }
      if (m.kind === 'resume') {
        const cur = (await sessionStore.get(SESSION_KEY))[SESSION_KEY] as Session | undefined;
        if (cur) {
          cur.status = 'tracking';
          cur.pauseReason = undefined;
          await sessionStore.set({ [SESSION_KEY]: { ...cur } });
        }
        return { ok: true };
      }
      return { ok: true };
    },
  },
  tabs: { query: async () => [{ id: 1 }], onActivated: { addListener() {} }, onUpdated: { addListener() {} } },
  permissions: { request: async () => false },
};

// Thanh điều khiển Demo (chỉ hiển thị ở trang dev preview) để test hiệu ứng chuyển động 60fps
function mountDevToolbar() {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:sticky;top:0;z-index:999;background:#0F172A;color:#F8FAFC;padding:6px 10px;font:600 11.5px/1.4 Inter,system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid #334155;';

  const label = document.createElement('span');
  label.textContent = '🎛️ Demo UI v2:';
  label.style.color = '#38BDF8';

  const select = document.createElement('select');
  select.style.cssText =
    'background:#1E293B;color:#F8FAFC;border:1px solid #475569;border-radius:6px;padding:3px 6px;font:inherit;max-width:155px;';
  for (const s of allScenarios) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.title;
    if (s.id === currentSc.id) opt.selected = true;
    select.append(opt);
  }
  select.onchange = async () => {
    currentSc = allScenarios.find((x) => x.id === select.value) ?? allScenarios[0]!;
    stepIndex = currentSc.messages.length;
    updateStepBtn();
    await sessionStore.set({ [SESSION_KEY]: buildSessionUpTo(currentSc, stepIndex) });
  };

  const stepBtn = document.createElement('button');
  stepBtn.style.cssText =
    'background:#2563EB;color:#fff;border:none;border-radius:6px;padding:3px 8px;font:inherit;cursor:pointer;';
  const updateStepBtn = () => {
    stepBtn.textContent = `▶ Phát từng tin (${stepIndex}/${currentSc.messages.length})`;
  };
  updateStepBtn();

  stepBtn.onclick = async () => {
    if (stepIndex >= currentSc.messages.length) stepIndex = 1;
    else stepIndex += 1;
    updateStepBtn();
    await sessionStore.set({ [SESSION_KEY]: buildSessionUpTo(currentSc, stepIndex) });
  };

  const introBtn = document.createElement('button');
  introBtn.textContent = 'Màn Bắt đầu';
  introBtn.style.cssText =
    'background:#334155;color:#E2E8F0;border:none;border-radius:6px;padding:3px 8px;font:inherit;cursor:pointer;';
  introBtn.onclick = async () => {
    await sessionStore.remove(SESSION_KEY);
  };

  bar.append(label, select, stepBtn, introBtn);
  document.body.prepend(bar);
}

mountDevToolbar();
await import('../src/sidepanel/main');
