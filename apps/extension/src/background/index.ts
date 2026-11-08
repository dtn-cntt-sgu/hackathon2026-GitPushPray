// Service worker: quản lý phiên theo dõi (state machine) và điều phối phân tích.
// idle → tracking ⇄ paused → (dừng và xóa) → không còn phiên
import { parseSnapshot, SnapshotError } from '@safechat/core/context-manager';
import { appendObserved, emptyTranscript, mergeLateQr } from '@safechat/core/transcript';
import { RISK_LEVEL_ORDER, type RiskLevel } from '@safechat/core/types';
import {
  emptyAiState,
  probeThreads,
  type ContentEvent,
  type PanelRequest,
  type ProbeResult,
  type Session,
  type StopResult,
} from '../shared/protocol';
import { AI_IDLE_ALARM, cancelAi, handleNanoResult, kickAi, resetGatewayBackoff, setPanelNanoStatus } from './ai';
import { clearDevice } from './gateway';
import { recompute, sendToTab, serial, updateBadge } from './runtime';
import { clearSessionVerified, loadSession, loadSettings, saveSession, saveSettings } from './store';

/** Mặc định đọc QR, chỉ gửi cờ khi người dùng tắt. */
const qrFlag = (s: { qrScan?: boolean }) => (s.qrScan === false ? { readQr: false } : {});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
// Widget mèo trong content script đọc phiên trực tiếp để hiện mức, bằng chứng và tóm tắt.
chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});


async function probe(tabId: number): Promise<ProbeResult> {
  const r = (await sendToTab(tabId, { kind: 'cs_probe' })) as ProbeResult | undefined;
  return r ?? { supported: false, reason: 'Trang hiện tại không phải trang chat được hỗ trợ (hoặc cần tải lại trang).' };
}

/** Cuộc người dùng chọn phải nằm trong danh sách đang mở; chỉ có một cuộc thì tự chọn. */
function pickThread(p: ProbeResult, wanted?: string) {
  const list = probeThreads(p);
  if (wanted) return list.find((t) => t.threadId === wanted) ?? null;
  return list.length === 1 ? list[0]! : null;
}

async function handlePanel(req: PanelRequest): Promise<unknown> {
  switch (req.kind) {
    case 'probe':
      return probe(req.tabId);

    case 'start': {
      const p = await probe(req.tabId);
      if (!p.supported) return { ok: false, reason: p.reason ?? 'Không nhận diện được cuộc trò chuyện.' };
      const t = pickThread(p, req.threadId);
      if (!t) return { ok: false, reason: 'Hãy chọn một cuộc trò chuyện đang mở để theo dõi.' };
      const settings = await loadSettings();
      if (req.allowScroll !== undefined && req.allowScroll !== settings.historyScroll) {
        settings.historyScroll = req.allowScroll;
        await saveSettings(settings);
      }
      const s: Session = {
        status: 'tracking',
        tabId: req.tabId,
        threadId: t.threadId,
        threadLabel: t.threadLabel || 'Cuộc trò chuyện',
        platform: p.platform ?? 'messenger',
        startedAt: Date.now(),
        maxMessages: settings.maxMessages,
        transcript: emptyTranscript(),
        result: null,
        ai: emptyAiState(),
        timeline: [],
        marks: {},
      };
      recompute(s);
      await saveSession(s);
      await updateBadge(s);
      await sendToTab(req.tabId, { kind: 'cs_start', threadId: s.threadId, loadHistory: true, allowScroll: settings.historyScroll, ...qrFlag(settings) });
      return { ok: true };
    }

    case 'set_qr_scan': {
      const settings = await loadSettings();
      settings.qrScan = req.value;
      await saveSettings(settings);
      return { ok: true };
    }

    case 'set_scan_consent': {
      const settings = await loadSettings();
      settings.scanConsent = req.value;
      await saveSettings(settings);
      return { ok: true };
    }

    case 'resume_snapshot': {
      // Context Manager: dựng lại phiên từ ảnh chụp, gắn vào cuộc chat đang mở (người dùng đã xác nhận ở side panel)
      let snap;
      try {
        snap = parseSnapshot(req.snapshot);
      } catch (e) {
        return { ok: false, reason: e instanceof SnapshotError ? e.message : 'Không đọc được file phiên.' };
      }
      const p = await probe(req.tabId);
      const t = p.supported ? pickThread(p, req.threadId) : null;
      if (!t) return { ok: false, reason: p.reason ?? 'Hãy mở và chọn cuộc trò chuyện cần tiếp tục trước.' };
      const old = await loadSession();
      if (old) await sendToTab(old.tabId, { kind: 'cs_stop' });
      cancelAi();
      if ((await clearSessionVerified()).length) return { ok: false, reason: 'Không xóa được phiên hiện tại.' };
      const settings = await loadSettings();
      const s: Session = {
        status: 'tracking',
        tabId: req.tabId,
        threadId: t.threadId,
        threadLabel: t.threadLabel || snap.threadLabel,
        platform: p.platform ?? snap.platform,
        startedAt: Date.now(),
        maxMessages: Math.max(snap.maxMessages, settings.maxMessages),
        transcript: snap.transcript,
        result: null,
        ai: {
          ...emptyAiState(),
          summary: snap.ai.summary,
          signals: snap.ai.signals,
          uncertainties: snap.ai.uncertainties,
          lastSeq: snap.ai.lastSeq,
          calls: snap.ai.calls,
          downgrade: snap.ai.downgrade,
        },
        timeline: snap.timeline,
        marks: snap.marks,
        stability: snap.stability,
        resumedFrom: { savedAt: snap.savedAt, threadLabel: snap.threadLabel, startedAt: snap.startedAt },
      };
      recompute(s);
      await saveSession(s);
      await updateBadge(s);
      // Content script đọc lại các tin đang hiển thị; tin đã có trong bản nháp được khử trùng lặp theo khóa
      await sendToTab(req.tabId, { kind: 'cs_start', threadId: s.threadId, ...qrFlag(await loadSettings()) });
      kickAi(500);
      return { ok: true };
    }

    case 'pause':
    case 'resume': {
      const s = await loadSession();
      if (!s) return { ok: false };
      if (req.kind === 'pause') {
        s.status = 'paused';
        s.pauseReason = 'user';
        await sendToTab(s.tabId, { kind: 'cs_stop' });
      } else {
        const p = await probe(s.tabId);
        if (!probeThreads(p).some((t) => t.threadId === s.threadId))
          return { ok: false, reason: 'Hãy mở lại đúng cuộc trò chuyện đang theo dõi trên tab cũ để tiếp tục.' };
        s.status = 'tracking';
        s.pauseReason = undefined;
        s.pendingThread = undefined;
        s.waiting = undefined;
        s.readerError = undefined;
        await sendToTab(s.tabId, { kind: 'cs_start', threadId: s.threadId, ...qrFlag(await loadSettings()) });
        kickAi(500);
      }
      await saveSession(s);
      return { ok: true };
    }

    case 'stop_and_clear': {
      const s = await loadSession();
      if (s) await sendToTab(s.tabId, { kind: 'cs_stop' });
      cancelAi();
      const remainingKeys = await clearSessionVerified();
      await updateBadge(null);
      return { ok: remainingKeys.length === 0, remainingKeys } satisfies StopResult;
    }

    case 'switch_to_pending': {
      // Người dùng xác nhận: xóa phiên cũ, bắt đầu phiên mới với chat mới (không trộn dữ liệu)
      const s = await loadSession();
      if (!s) return { ok: false };
      const tabId = s.tabId;
      await sendToTab(tabId, { kind: 'cs_stop' });
      cancelAi();
      const left = await clearSessionVerified();
      if (left.length) return { ok: false, reason: 'Không xóa được hết dữ liệu phiên cũ.' };
      return handlePanel({ kind: 'start', tabId });
    }

    case 'mark': {
      const s = await loadSession();
      if (!s) return { ok: false };
      if (req.mark) s.marks[req.key] = req.mark;
      else delete s.marks[req.key];
      await saveSession(s);
      return { ok: true };
    }

    case 'reanalyze': {
      // Cài đặt AI thay đổi: tắt hết AI thì bỏ tín hiệu AI cũ
      const s = await loadSession();
      if (!s) return { ok: false };
      const settings = await loadSettings();
      const gatewayOn = settings.gatewayEnabled && !!settings.gatewayUrl;
      if (!settings.nanoEnabled && !gatewayOn) {
        s.ai = { ...emptyAiState(), calls: s.ai.calls };
      }
      if (!gatewayOn) await clearDevice(); // bỏ token cũ khi tắt gateway
      // Người dùng có thể vừa đổi địa chỉ máy chủ nên cho thử lại từ đầu
      resetGatewayBackoff();
      s.ai.failures = undefined;
      s.ai.gaveUpAtSeq = undefined;
      recompute(s);
      await saveSession(s);
      await updateBadge(s);
      kickAi(300);
      return { ok: true };
    }

    case 'panel_status':
      setPanelNanoStatus(req.nanoReady);
      return { ok: true };

    case 'ai_result':
      // Chạy ngoài hàng đợi serial vì handleNanoResult tự dùng serial bên trong
      void handleNanoResult(req.id, req.ok, req.ok ? req.content : req.error);
      return { ok: true };
  }
}

async function handleContent(ev: ContentEvent, tabId: number | undefined): Promise<void> {
  const s = await loadSession();
  if (!s || tabId !== s.tabId) return; // tab khác hoặc chưa có phiên: không làm gì

  if (ev.kind === 'cs_ready') {
    if (s.status === 'tracking') {
      const settings = await loadSettings();
      await sendToTab(s.tabId, { kind: 'cs_start', threadId: s.threadId, loadHistory: s.transcript.messages.length === 0, allowScroll: settings.historyScroll, ...qrFlag(settings) });
    }
    return;
  }

  if (ev.kind === 'cs_thread_changed') {
    if (ev.threadId === s.threadId) return;
    s.status = 'paused';
    s.pauseReason = ev.threadId ? 'thread_changed' : 'page_unsupported';
    s.pendingThread = ev.threadId ? { threadId: ev.threadId, threadLabel: ev.threadLabel } : undefined;
    await saveSession(s);
    return;
  }

  if (ev.kind === 'cs_scan_started') {
    if (ev.threadId !== s.threadId || s.status !== 'tracking') return;
    s.scan = { state: 'loading', target: ev.target, scroll: ev.scroll };
    await saveSession(s);
    return;
  }

  if (ev.kind === 'cs_thread_waiting') {
    if (ev.threadId !== s.threadId || s.status !== 'tracking') return;
    s.waiting = ev.waiting || undefined;
    await saveSession(s);
    return;
  }

  if (s.status !== 'tracking' || ev.threadId !== s.threadId) return;
  if ((ev.error ?? undefined) !== s.readerError) {
    s.readerError = ev.error;
    await saveSession(s);
  }
  if (ev.initial) s.scan = { state: 'done', target: ev.initial.target, scroll: s.scan?.scroll, read: ev.batch.length, complete: ev.initial.complete };
  if (ev.error) {
    if (ev.initial) await saveSession(s);
    return;
  }
  const before: RiskLevel = s.result?.risk_level ?? 'low';
  const added = appendObserved(s.transcript, ev.batch, s.maxMessages);
  const lateQr = mergeLateQr(s.transcript, ev.batch);
  if (added.length === 0 && !lateQr) {
    if (ev.initial) await saveSession(s);
    return;
  }
  s.lastMessageAt = Date.now();
  recompute(s);
  await saveSession(s);
  if (RISK_LEVEL_ORDER[s.result!.risk_level] !== RISK_LEVEL_ORDER[before]) await updateBadge(s);
  kickAi(300);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const kind = (msg as { kind?: string })?.kind ?? '';
  if (sender.tab && kind.startsWith('cs_')) {
    void serial(() => handleContent(msg as ContentEvent, sender.tab?.id));
    return false;
  }
  let req = msg as PanelRequest;
  if ('tabId' in req && req.tabId === -1 && sender.tab?.id != null) {
    req = { ...req, tabId: sender.tab.id };
  }
  const run = req.kind === 'ai_result' || req.kind === 'panel_status' ? handlePanel(req) : serial(() => handlePanel(req));
  run.then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    const s = await loadSession();
    if (s && s.tabId === tabId && s.status === 'tracking') {
      s.status = 'paused';
      s.pauseReason = 'tab_closed';
      await saveSession(s);
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AI_IDLE_ALARM) kickAi();
});

// Khi SW khởi động lại (trình duyệt vẫn mở), khôi phục badge theo phiên còn trong storage.session
void loadSession().then(updateBadge);
