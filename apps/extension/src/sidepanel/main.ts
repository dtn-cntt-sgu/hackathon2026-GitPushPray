// Side panel: giới thiệu & đồng ý → phiên theo dõi → tổng quan / bằng chứng / bản nháp / cài đặt → kết thúc.
// Nội dung chat chỉ được đưa vào DOM qua textContent (không dùng innerHTML) để tránh XSS.
import { createSnapshot, describeSnapshot, parseSnapshot, serializeSnapshot, SnapshotError } from '@safechat/core/context-manager';
import { exportHtml, exportJson, type ExportScope } from '@safechat/core/export';
import {
  CATEGORY_LABEL,
  RISK_LEVEL_ORDER,
  STAGE_LABEL,
  type AnalysisResult,
  type RiskLevel,
  type ScamStage,
  type Severity,
  type Signal,
  type SignalCategory,
  type UserMark,
} from '@safechat/core/types';
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  probeThreads,
  SESSION_KEY,
  SETTINGS_KEY,
  signalKey,
  USAGE_KEY,
  type PanelRequest,
  type ProbeResult,
  type Session,
  type Settings,
  type StopResult,
} from '../shared/protocol';
import { gatewayOriginPattern, normalizeGatewayUrl } from '../background/gateway';
import { downloadNano, nanoStatus, runNano, type NanoStatus } from './nano';

type View = 'overview' | 'analysis' | 'evidence' | 'draft' | 'settings';

const STAGES: ScamStage[] = ['S0', 'S1', 'S2', 'S3', 'S4'];
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 4 mức độ hiển thị thống nhất (không dùng điểm số dao động). */
const LEVEL_DISPLAY: Record<RiskLevel | Severity, string> = {
  low: 'Bình thường',
  attention: 'Cần chú ý',
  medium: 'Cần chú ý',
  high: 'Cao',
  critical: 'Nguy hiểm',
};

let tiersDomCache: {
  root: HTMLElement;
  rows: Record<RiskLevel, { rowEl: HTMLElement; segs: HTMLElement[] }>;
} | null = null;

const state: {
  session: Session | null;
  settings: Settings;
  probe: ProbeResult | null;
  tabId: number | null;
  consent: boolean;
  view: View;
  notice: { kind: 'ok' | 'err'; text: string } | null;
  nano: NanoStatus | null;
  nanoProgress: number | null;
  usageToday: number;
  /** Cuộc trò chuyện người dùng chọn khi đang mở nhiều khung chat. */
  chosenThread: string | null;
  /** File bản nháp đã chọn để tiếp tục (Context Manager). */
  resume: { text: string; info: ReturnType<typeof describeSnapshot> } | { error: string } | null;
  /** Trạng thái mở rộng hộp gợi ý nhanh trên màn hình LIVE. */
  adviceExpanded: boolean;
} = {
  session: null,
  settings: DEFAULT_SETTINGS,
  probe: null,
  tabId: null,
  consent: false,
  view: 'overview',
  notice: null,
  nano: null,
  nanoProgress: null,
  usageToday: 0,
  chosenThread: null,
  resume: null,
  adviceExpanded: true,
};

/** Cuộc trò chuyện sẽ theo dõi: cuộc duy nhất đang mở, hoặc cuộc người dùng đã chọn trong danh sách. */
function targetThread() {
  const list = probeThreads(state.probe);
  if (list.length === 1) return list[0]!;
  return list.find((t) => t.threadId === state.chosenThread) ?? null;
}

function threadPicker(): Node | false {
  const p = state.probe;
  if (p === null) return h('p', { class: 'muted' }, 'Đang kiểm tra trang…');
  if (!p.supported) return h('p', { class: 'err' }, p.reason ?? 'Trang này chưa được hỗ trợ.');
  const list = probeThreads(p);
  const tag = h('span', { class: 'tag' }, p.platform === 'mock' ? 'Giả lập' : 'Messenger');
  if (list.length === 1) return h('p', { style: 'margin:4px 0' }, h('b', {}, list[0]!.threadLabel), tag);
  return h(
    'div',
    {},
    h('p', { class: 'small' }, `Đang mở ${list.length} khung chat. Chọn đúng một người cần kiểm tra — chỉ cuộc được chọn mới được đọc nội dung:`),
    ...list.map((t) =>
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'radio',
          name: 'thread',
          checked: state.chosenThread === t.threadId,
          onchange: () => {
            state.chosenThread = t.threadId;
            render();
          },
        }),
        h('span', {}, t.threadLabel),
      ),
    ),
  );
}

// ---------- tiện ích DOM & SVG an toàn (không dùng innerHTML) ----------
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | ((e: Event) => void)>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: SVGElement[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

// ---------- Chú mèo Pixel Art cầm khiên & 4 mức độ ----------
const SHIELD_PIXEL_PALETTE: Record<RiskLevel, { main: string; light: string; dark: string }> = {
  low: { main: '#16a34a', light: '#4ade80', dark: '#14532d' },
  attention: { main: '#2563eb', light: '#60a5fa', dark: '#1e3a8a' },
  high: { main: '#ea580c', light: '#fb923c', dark: '#7c2d12' },
  critical: { main: '#dc2626', light: '#f87171', dark: '#7f1d1d' },
};

const LEVEL_BADGE_TEXT: Record<RiskLevel, string> = {
  low: 'Chưa thấy dấu hiệu bất thường',
  attention: 'Có chi tiết cần xác minh',
  high: 'Phát hiện dấu hiệu rủi ro',
  critical: 'Cảnh báo nguy hiểm, cần cảnh giác',
};

function px(x: number, y: number, w: number, hgt: number, fill: string): SVGElement {
  return svg('rect', { x, y, width: w, height: hgt, fill });
}

function catShieldSvg(level: RiskLevel): SVGElement {
  const BK = '#090a0f';
  const DK = '#1e222d';
  const LT = '#343946';
  const PK = '#f9a8ba';
  const NS = '#fb7185';
  const WT = '#ffffff';
  const WS = '#dbe4f0';
  const pal = SHIELD_PIXEL_PALETTE[level];

  let eyesAndBrows: SVGElement;
  if (level === 'attention') {
    eyesAndBrows = svg(
      'g',
      {},
      px(7, 5, 2, 1, BK),
      px(13, 4, 2, 1, BK),
      px(8, 6, 1, 1, '#38bdf8'),
      px(8, 7, 1, 1, '#f59e0b'),
      px(13, 6, 1, 1, '#38bdf8'),
      px(13, 7, 1, 1, '#f59e0b'),
    );
  } else if (level === 'high') {
    eyesAndBrows = svg(
      'g',
      {},
      px(7, 5, 2, 1, BK),
      px(9, 6, 1, 1, BK),
      px(13, 5, 2, 1, BK),
      px(12, 6, 1, 1, BK),
      px(8, 6, 1, 1, '#fb923c'),
      px(8, 7, 1, 1, BK),
      px(13, 6, 1, 1, '#fb923c'),
      px(13, 7, 1, 1, BK),
    );
  } else if (level === 'critical') {
    eyesAndBrows = svg(
      'g',
      {},
      px(7, 5, 2, 1, '#fca5a5'),
      px(9, 6, 1, 1, BK),
      px(13, 5, 2, 1, '#fca5a5'),
      px(12, 6, 1, 1, BK),
      px(8, 6, 1, 1, '#fef08a'),
      px(8, 7, 1, 1, '#ef4444'),
      px(13, 6, 1, 1, '#fef08a'),
      px(13, 7, 1, 1, '#ef4444'),
    );
  } else {
    // Mức 1 (Bình thường): mắt híp cong vui vẻ ^ ^
    eyesAndBrows = svg(
      'g',
      {},
      px(7, 6, 2, 1, '#f59e0b'),
      px(7, 7, 1, 1, BK),
      px(9, 7, 1, 1, BK),
      px(13, 6, 2, 1, '#f59e0b'),
      px(12, 7, 1, 1, BK),
      px(14, 7, 1, 1, BK),
    );
  }

  let shieldEmblem: SVGElement;
  if (level === 'low') {
    shieldEmblem = svg(
      'g',
      {},
      px(9, 13, 1, 1, WT),
      px(10, 14, 1, 1, WT),
      px(11, 13, 1, 1, WT),
      px(12, 12, 1, 1, WT),
      px(13, 11, 1, 1, WT),
    );
  } else if (level === 'attention') {
    shieldEmblem = svg(
      'g',
      {},
      px(10, 11, 3, 1, WT),
      px(12, 12, 1, 1, WT),
      px(11, 13, 1, 1, WT),
      px(11, 15, 1, 1, WT),
    );
  } else if (level === 'high') {
    shieldEmblem = svg('g', {}, px(11, 11, 1, 3, WT), px(11, 15, 1, 1, WT));
  } else {
    shieldEmblem = svg('g', {}, px(10, 11, 3, 1, '#fef08a'), px(11, 12, 1, 2, WT), px(11, 15, 1, 1, WT));
  }

  let overheadBadge: SVGElement | null = null;
  if (level === 'attention') {
    // Mức 2 (Cần chú ý): Kính lúp thám tử soi trước mắt + dấu ? trên đầu
    overheadBadge = svg(
      'g',
      {},
      px(2, 4, 4, 1, BK),
      px(1, 5, 1, 3, BK),
      px(6, 5, 1, 3, BK),
      px(2, 8, 4, 1, BK),
      px(2, 5, 4, 3, '#bae6fd'),
      px(2, 5, 2, 1, WT),
      px(2, 6, 1, 1, WT),
      px(5, 8, 1, 1, '#92400e'),
      px(6, 9, 1, 1, '#78350f'),
      px(7, 10, 1, 1, BK),
      px(4, 10, 2, 2, WT),
      px(4, 9, 2, 1, BK),
      px(3, 10, 1, 2, BK),
      px(4, 12, 2, 1, BK),
      px(20, 0, 3, 1, BK),
      px(19, 1, 1, 2, BK),
      px(23, 1, 1, 2, BK),
      px(20, 1, 3, 1, '#60a5fa'),
      px(22, 2, 1, 1, '#2563eb'),
      px(21, 3, 2, 1, '#2563eb'),
      px(20, 3, 1, 2, BK),
      px(21, 4, 1, 1, '#2563eb'),
      px(22, 4, 1, 1, BK),
      px(20, 6, 3, 1, BK),
      px(21, 5, 1, 1, '#2563eb'),
    );
  } else if (level === 'high') {
    // Mức 3 (Cao): Cờ hiệu cảnh báo màu cam có dấu ! trắng
    overheadBadge = svg(
      'g',
      {},
      px(19, 1, 1, 11, BK),
      px(19, 0, 1, 1, '#facc15'),
      px(20, 1, 6, 1, BK),
      px(20, 6, 6, 1, BK),
      px(25, 2, 1, 4, BK),
      px(20, 2, 5, 4, '#ea580c'),
      px(20, 2, 4, 1, '#fb923c'),
      px(22, 2, 1, 2, WT),
      px(22, 5, 1, 1, WT),
      px(17, 9, 2, 2, WT),
      px(17, 8, 2, 1, BK),
      px(17, 11, 2, 1, BK),
    );
  } else if (level === 'critical') {
    // Mức 4 (Nguy hiểm): Đèn còi báo động đỏ (Red Siren) + tia sáng chớp + dấu !!
    overheadBadge = svg(
      'g',
      {},
      px(9, 3, 5, 1, BK),
      px(10, 1, 3, 2, '#dc2626'),
      px(10, 1, 1, 1, '#fca5a5'),
      px(11, 2, 1, 1, '#fef08a'),
      px(9, 1, 1, 2, BK),
      px(13, 1, 1, 2, BK),
      px(10, 0, 3, 1, BK),
      px(7, 0, 1, 1, '#fef08a'),
      px(8, 1, 1, 1, '#ef4444'),
      px(15, 0, 1, 1, '#fef08a'),
      px(14, 1, 1, 1, '#ef4444'),
      px(6, 2, 2, 1, '#f97316'),
      px(15, 2, 2, 1, '#f97316'),
      px(19, 0, 2, 4, BK),
      px(19, 1, 1, 2, '#fef08a'),
      px(19, 5, 2, 1, '#ef4444'),
      px(22, 0, 2, 4, BK),
      px(22, 1, 1, 2, '#fef08a'),
      px(22, 5, 2, 1, '#ef4444'),
    );
  }

  const children: SVGElement[] = [
    svg('ellipse', { cx: 12, cy: 17.4, rx: 9.8, ry: 1.25, fill: 'rgba(15, 23, 42, 0.18)' }),
    // Đuôi pixel bậc thang bên phải (có chóp đuôi trắng Tuxedo)
    px(16, 13, 2, 1, BK),
    px(17, 12, 2, 1, BK),
    px(18, 11, 2, 1, BK),
    px(19, 9, 2, 2, BK),
    px(20, 8, 3, 1, BK),
    px(22, 9, 2, 3, BK),
    px(21, 12, 2, 1, BK),
    px(20, 13, 2, 1, BK),
    px(19, 14, 2, 1, BK),
    px(17, 15, 3, 1, BK),
    px(16, 14, 3, 1, DK),
    px(18, 12, 3, 2, DK),
    px(20, 11, 2, 1, DK),
    px(20, 9, 2, 2, WT),
    // Tai trái pixel
    px(6, 2, 3, 1, BK),
    px(5, 3, 1, 2, BK),
    px(9, 3, 1, 2, BK),
    px(6, 3, 1, 2, PK),
    px(7, 4, 1, 1, PK),
    px(7, 3, 2, 1, LT),
    px(8, 4, 1, 1, DK),
    // Tai phải pixel
    px(14, 2, 3, 1, BK),
    px(13, 3, 1, 2, BK),
    px(17, 3, 1, 2, BK),
    px(16, 3, 1, 2, PK),
    px(15, 4, 1, 1, PK),
    px(14, 3, 2, 1, LT),
    px(14, 4, 1, 1, DK),
    // Đầu mèo Tuxedo nhô trên đỉnh khiên
    px(10, 4, 3, 1, BK),
    px(5, 5, 1, 5, BK),
    px(17, 5, 1, 5, BK),
    px(6, 5, 11, 5, DK),
    px(16, 5, 1, 4, LT),
    px(10, 6, 2, 1, WT),
    px(9, 7, 4, 1, WT),
    px(8, 8, 6, 2, WT),
    px(7, 9, 8, 1, WT),
    px(10, 7, 2, 1, NS),
    px(10, 8, 2, 1, level === 'critical' ? '#ef4444' : level === 'high' ? '#94a3b8' : WS),
    px(3, 7, 2, 1, BK),
    px(3, 9, 2, 1, BK),
    px(18, 7, 2, 1, BK),
    px(18, 9, 2, 1, BK),
    eyesAndBrows,
    // Bàn chân sau đi tất trắng lấp ló hai bên đáy khiên
    px(6, 16, 2, 1, WT),
    px(6, 17, 2, 1, BK),
    px(15, 16, 2, 1, WT),
    px(15, 17, 2, 1, BK),
    // Khiên Pixel LỚN trước ngực (11x9 pixel, x=6..16, y=9..17)
    px(7, 9, 9, 1, BK),
    px(6, 10, 1, 5, BK),
    px(16, 10, 1, 5, BK),
    px(7, 15, 1, 1, BK),
    px(15, 15, 1, 1, BK),
    px(8, 16, 2, 1, BK),
    px(13, 16, 2, 1, BK),
    px(10, 17, 3, 1, BK),
    px(7, 10, 9, 5, pal.main),
    px(8, 15, 7, 1, pal.main),
    px(10, 16, 3, 1, pal.main),
    px(7, 10, 4, 1, pal.light),
    px(7, 11, 1, 3, pal.light),
    px(8, 11, 1, 1, pal.light),
    px(15, 11, 1, 4, pal.dark),
    px(13, 15, 2, 1, pal.dark),
    px(11, 16, 2, 1, pal.dark),
    shieldEmblem,
    // Hai bàn tay đi tất trắng vòng ra hai bên mép khiên ôm chặt lấy khiên
    px(5, 10, 1, 4, BK),
    px(6, 10, 1, 1, DK),
    px(6, 11, 2, 2, WT),
    px(8, 12, 1, 1, WT),
    px(6, 12, 1, 1, WS),
    px(8, 11, 1, 1, BK),
    px(6, 13, 3, 1, BK),
    px(17, 10, 1, 4, BK),
    px(16, 10, 1, 1, DK),
    px(15, 11, 2, 2, WT),
    px(14, 12, 1, 1, WT),
    px(16, 12, 1, 1, WS),
    px(14, 11, 1, 1, BK),
    px(14, 13, 3, 1, BK),
  ];
  if (overheadBadge) children.push(overheadBadge);

  return svg(
    'svg',
    {
      viewBox: '0 0 26 19',
      width: 98,
      height: 72,
      class: 'mascot-float',
      'shape-rendering': 'crispEdges',
      'aria-hidden': 'true',
    },
    ...children,
  );
}

function updateGaugeNode(level: RiskLevel): HTMLElement {
  return h(
    'div',
    { class: 'gauge-panel' },
    catShieldSvg(level),
    h('div', { class: `risk-pill-badge ${level}` }, LEVEL_DISPLAY[level]),
    h('div', { class: 'gauge-caption', style: 'margin-top:4px;text-align:center' }, LEVEL_BADGE_TEXT[level]),
  );
}

function tierSegmentsFor(r: AnalysisResult, rowLevel: RiskLevel): number {
  const curOrder = RISK_LEVEL_ORDER[r.risk_level];
  const rowOrder = RISK_LEVEL_ORDER[rowLevel];
  if (rowLevel === r.risk_level) {
    if (rowLevel === 'critical') return 4;
    if (rowLevel === 'high') return 3;
    if (rowLevel === 'attention') return 2;
    return 1;
  }
  if (rowOrder < curOrder) {
    return rowLevel === 'low' ? 1 : 2;
  }
  return 0;
}

function updateTiersNode(r: AnalysisResult): HTMLElement {
  const rowDefs: { level: RiskLevel; label: string }[] = [
    { level: 'critical', label: LEVEL_DISPLAY.critical },
    { level: 'high', label: LEVEL_DISPLAY.high },
    { level: 'attention', label: LEVEL_DISPLAY.attention },
    { level: 'low', label: LEVEL_DISPLAY.low },
  ];

  if (!tiersDomCache) {
    const rows = {} as Record<RiskLevel, { rowEl: HTMLElement; segs: HTMLElement[] }>;
    const children: HTMLElement[] = [];
    for (const { level, label } of rowDefs) {
      const segs = [0, 1, 2, 3].map((i) =>
        h('span', {
          class: `seg ${level}`,
          style: `transition-delay:${i * 55}ms`,
        }),
      );
      const rowEl = h(
        'div',
        { class: `tier-row ${level}` },
        h('div', { class: 'tier-label-wrap' }, h('span', { class: `tier-dot ${level}` }), h('span', {}, label)),
        h('div', { class: 'tier-segs' }, ...segs),
      );
      rows[level] = { rowEl, segs };
      children.push(rowEl);
    }
    const root = h('div', { class: 'tiers-panel', 'aria-label': 'Thang 4 mức rủi ro' }, ...children);
    tiersDomCache = { root, rows };
  }

  for (const { level } of rowDefs) {
    const entry = tiersDomCache.rows[level];
    const active = r.risk_level === level;
    const litCount = tierSegmentsFor(r, level);
    entry.rowEl.className = `tier-row ${level}${active ? ' active' : ''}`;
    entry.segs.forEach((segEl, idx) => {
      segEl.className = `seg ${level}${idx < litCount ? ' on' : ''}`;
    });
  }

  return tiersDomCache.root;
}

function send<T = { ok: boolean; reason?: string }>(req: PanelRequest): Promise<T> {
  return chrome.runtime.sendMessage(req) as Promise<T>;
}

function setNotice(kind: 'ok' | 'err', text: string) {
  state.notice = { kind, text };
  render();
}

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function duration(from: number): string {
  const m = Math.floor((Date.now() - from) / 60000);
  return m < 1 ? 'dưới 1 phút' : m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

// ---------- màn hình giới thiệu & đồng ý (Khối 1: Launcher Card + Quyền riêng tư) ----------
function introView(): Node {
  const canStart = state.consent && !!targetThread();
  return h(
    'div',
    {},
    // Khối 1: Launcher Hero Card
    h(
      'section',
      { class: 'card launcher-card' },
      h(
        'div',
        { class: 'launcher-info' },
        h(
          'div',
          { class: 'launcher-title-row' },
          h('span', { class: 'launcher-title' }, 'SafeChat AI'),
          h(
            'button',
            {
              class: 'small',
              title: 'Mở cài đặt AI & hạn mức',
              onclick: () => {
                document.getElementById('settings-section')?.scrollIntoView({ behavior: 'smooth' });
              },
            },
            'Cài đặt',
          ),
        ),
        h('div', { class: 'launcher-sub' }, 'Bảo vệ bạn khỏi lừa đảo trực tuyến'),
        h(
          'div',
          { class: 'row', style: 'margin-top:8px' },
          h(
            'button',
            {
              class: 'primary start-btn-pill',
              disabled: !canStart,
              onclick: async () => {
                if (state.tabId === null) return;
                const r = await send({ kind: 'start', tabId: state.tabId, threadId: targetThread()?.threadId });
                if (!r.ok) setNotice('err', r.reason ?? 'Không bắt đầu được.');
                else state.notice = null;
              },
            },
            'Khóa & Theo dõi',
          ),
          h('button', { onclick: () => void refreshProbe() }, 'Bắt đầu quét'),
        ),
      ),
      h(
        'div',
        { class: 'launcher-thread-box' },
        h('div', { class: 'muted small', style: 'font-weight:600;margin-bottom:4px' }, 'Cuộc trò chuyện hiện tại:'),
        threadPicker(),
        historyModeControl(),
        h(
          'label',
          { class: 'check', style: 'margin-top:8px' },
          h('input', {
            type: 'checkbox',
            checked: state.consent,
            onchange: (e: Event) => {
              state.consent = (e.target as HTMLInputElement).checked;
              render();
            },
          }),
          h('span', { class: 'small' }, state.settings.historyScroll
            ? 'Tôi hiểu và đồng ý cho SafeChat AI đọc văn bản và mã QR trong ảnh của riêng cuộc trò chuyện đang mở, gồm tối đa 50 tin gần nhất. Tiện ích có thể tự cuộn khung chat lên để tải các tin này rồi trả về chỗ cũ, không gửi tin và không bấm gì.'
            : 'Tôi hiểu và đồng ý cho SafeChat AI đọc văn bản và mã QR trong ảnh của riêng cuộc trò chuyện đang mở, tối đa 50 tin đang có trên trang. Tiện ích không cuộn khung chat, không gửi tin và không bấm gì.'),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Trước khi bắt đầu'),
      h(
        'p',
        { class: 'small' },
        'SafeChat AI chỉ theo dõi cuộc trò chuyện bạn chọn, trong phạm vi nội dung Messenger đang hiển thị mà extension đọc được. Bản nháp được giữ tạm trong bộ nhớ trình duyệt để phân tích và tự mất khi đóng trình duyệt.',
      ),
      h(
        'ul',
        { class: 'small' },
        h('li', {}, 'Đọc: văn bản tin nhắn của cuộc trò chuyện đang mở.'),
        h('li', {}, 'Không đọc: các cuộc trò chuyện khác, ảnh, file, tin thoại; không tự gửi tin nhắn.'),
        h(
          'li',
          {},
          'Nhận biết dấu hiệu của các kịch bản lừa đảo qua tin nhắn: việc làm/nhiệm vụ, đầu tư, vay online, mạo danh cơ quan hoặc người quen, link/ứng dụng độc hại, quà nước ngoài, "thu hồi tiền", dụ dỗ/cô lập. Không bao phủ cuộc gọi, SMS hay bưu kiện.',
        ),
        h('li', {}, `Giới hạn: tối đa ${state.settings.maxMessages} tin gần nhất; có thể bỏ sót khi Messenger tải từng phần.`),
        h('li', {}, aiDisclosure()),
        h('li', {}, 'Bạn có thể tạm dừng, xuất báo cáo, hoặc dừng và xóa phiên bất cứ lúc nào.'),
      ),
    ),
    resumeCard(),
    settingsCard(),
  );
}

// ---------- Context Manager: tiếp tục từ bản nháp ----------
function resumeCard(): Node {
  const r = state.resume;
  const info = r && 'info' in r ? r.info : null;
  const target = targetThread();
  const labelDiffers = !!(info && target?.threadLabel && info.label && target.threadLabel !== info.label);
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Tiếp tục từ bản nháp'),
    h(
      'p',
      { class: 'muted small' },
      'Chọn file phiên (.json) đã lưu bằng nút "Lưu phiên để tiếp tục". Bản nháp, bằng chứng, tóm tắt AI và trạng thái cảnh báo sẽ được khôi phục; kết quả được tính lại, tin mới trên màn hình được nối tiếp không trùng lặp.',
    ),
    h('input', {
      type: 'file',
      accept: '.json,application/json',
      'aria-label': 'Chọn file phiên đã lưu',
      onchange: async (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        const text = await f.text();
        try {
          state.resume = { text, info: describeSnapshot(parseSnapshot(text)) };
        } catch (err) {
          state.resume = { error: err instanceof SnapshotError ? err.message : 'Không đọc được file.' };
        }
        render();
      },
    }),
    r && 'error' in r && h('p', { class: 'err small' }, r.error),
    info &&
      h(
        'div',
        { style: 'margin-top:8px' },
        h(
          'ul',
          { class: 'small' },
          h('li', {}, `Cuộc trò chuyện: ${info.label || '(không tên)'}`),
          h('li', {}, `Lưu lúc: ${new Date(info.savedAt).toLocaleString('vi-VN')}`),
          h('li', {}, `${info.messages} tin · mức cao nhất: ${LEVEL_DISPLAY[info.maxLevel]} · ${info.aiSignals} tín hiệu AI`),
        ),
        labelDiffers &&
          h(
            'p',
            { class: 'banner small' },
            `Chat đang chọn là "${target!.threadLabel}", khác với chat trong file. Chỉ tiếp tục nếu đây đúng là cùng một cuộc trò chuyện — dữ liệu hai cuộc khác nhau sẽ bị trộn lẫn.`,
          ),
        h(
          'button',
          {
            class: 'primary',
            disabled: !state.consent || !target,
            onclick: async () => {
              if (state.tabId === null || !(r && 'text' in r)) return;
              if (labelDiffers && !confirm('Tên cuộc trò chuyện khác với file. Vẫn tiếp tục?')) return;
              const res = await send({ kind: 'resume_snapshot', tabId: state.tabId, snapshot: r.text, threadId: target?.threadId });
              if (!res.ok) setNotice('err', res.reason ?? 'Không tiếp tục được.');
              else {
                state.resume = null;
                state.notice = null;
              }
            },
          },
          'Tiếp tục phiên này',
        ),
        (!state.consent || !target) && h('p', { class: 'muted small' }, 'Cần tích đồng ý ở trên và mở (chọn) đúng cuộc trò chuyện.'),
      ),
  );
}

// ---------- Khối 2 & 3: Phiên đang chạy (Peeking Cat + SafeChat AI LIVE + Risk Dashboard) ----------
function sessionHeader(s: Session): Node {
  const label =
    s.status === 'tracking'
      ? s.waiting
        ? 'Đang chờ mở lại khung chat'
        : 'Đang theo dõi tin nhắn...'
      : s.pauseReason === 'tab_closed'
        ? 'Tạm dừng — tab đã đóng'
        : s.pauseReason === 'thread_changed'
          ? 'Tạm dừng — đã chuyển chat'
          : s.pauseReason === 'page_unsupported'
            ? 'Tạm dừng — rời trang chat'
            : 'Tạm dừng';
  return h(
    'div',
    { class: 'live-stage-wrapper' },
    // Khối 2: Viên thuốc trạng thái
    h(
      'div',
      { class: 'peeking-bar', style: 'justify-content:flex-end;margin-bottom:6px' },
      h('div', { class: 'tracking-pill', style: 'margin-bottom:0' }, h('span', { class: `dot ${s.status}` }), label),
    ),
    // Khối 3: Bảng SafeChat AI LIVE
    h(
      'section',
      { class: 'live-widget' },
      h(
        'div',
        { class: 'live-header' },
        h(
          'div',
          { class: 'live-brand' },
          h('span', {}, 'SafeChat AI'),
          h('span', { class: `live-badge${s.status !== 'tracking' ? ' paused' : ''}` }, s.status === 'tracking' ? 'LIVE' : 'PAUSED'),
        ),
        h(
          'div',
          { class: 'row' },
          s.status === 'tracking'
            ? h('button', { class: 'small', title: 'Tạm dừng theo dõi', onclick: () => void send({ kind: 'pause' }) }, 'Tạm dừng')
            : h(
                'button',
                {
                  class: 'small primary',
                  onclick: async () => {
                    const r = await send({ kind: 'resume' });
                    if (!r.ok) setNotice('err', r.reason ?? 'Không tiếp tục được.');
                  },
                },
                'Tiếp tục',
              ),
          h('button', { class: 'danger small', title: 'Dừng và xóa phiên', onclick: () => void stopAndClear() }, 'Dừng & xóa'),
        ),
      ),
      h(
        'div',
        { class: 'session-meta' },
        h('div', {}, h('b', {}, s.threadLabel), s.platform === 'mock' && h('span', { class: 'tag' }, 'Giả lập')),
        h('span', {}, `${s.transcript.messages.length}/${s.maxMessages} tin · ${duration(s.startedAt)}`),
      ),
      s.resumedFrom &&
        h('div', { class: 'muted small', style: 'margin-top:4px' }, `Tiếp tục từ bản nháp lưu lúc ${new Date(s.resumedFrom.savedAt).toLocaleString('vi-VN')}`),
      s.status === 'tracking' &&
        s.scan?.state === 'loading' && h('p', { class: 'banner small' }, s.scan.scroll === false ? 'Đang đọc các tin đang hiển thị…' : `Đang đọc lịch sử, tối đa ${s.scan.target} tin…`),
      s.scan?.state === 'done' &&
        s.scan.read !== undefined &&
        s.scan.read < s.scan.target &&
        h(
          'p',
          { class: 'muted small' },
          s.scan.scroll === false
            ? `Đã đọc ${s.scan.read} tin đang hiển thị, không cuộn. Đánh giá có thể thiếu các tin cũ hơn. Muốn đọc thêm, hãy cuộn khung chat lên rồi quét lại, hoặc chọn tự cuộn.`
            : s.scan.complete
            ? `Đã đọc ${s.scan.read} tin, đây là toàn bộ tin tải được. Đánh giá dựa trên phần này.`
            : `Mới đọc được ${s.scan.read} tin trong thời gian cho phép. Đánh giá có thể thiếu các tin cũ hơn.`,
        ),
      s.waiting &&
        h(
          'div',
          { class: 'banner small', style: 'margin-top:8px' },
          `Khung chat với "${s.threadLabel}" đang đóng. Phiên và bản nháp vẫn được giữ; mở lại đúng khung chat này để đọc tiếp. Không đọc các cuộc trò chuyện khác. Tin đến lúc khung đóng có thể bị bỏ sót.`,
        ),
      s.status === 'tracking' &&
        s.readerError &&
        h('div', { class: 'banner small err', style: 'margin-top:8px' }, `Bộ đọc tạm ngừng: ${s.readerError}`),
      s.pendingThread &&
        h(
          'div',
          { class: 'banner', style: 'margin-top:8px' },
          h('div', {}, `Bạn đã chuyển sang cuộc trò chuyện khác (${s.pendingThread.threadLabel || 'không rõ tên'}). Dữ liệu hai cuộc trò chuyện không được trộn lẫn.`),
          h(
            'div',
            { class: 'row', style: 'margin-top:6px' },
            h(
              'button',
              {
                onclick: async () => {
                  if (!confirm('Xóa phiên hiện tại và bắt đầu theo dõi cuộc trò chuyện mới?')) return;
                  const r = await send({ kind: 'switch_to_pending' });
                  if (!r.ok) setNotice('err', r.reason ?? 'Không đổi được cuộc trò chuyện.');
                },
              },
              'Xóa phiên này & theo dõi chat mới',
            ),
          ),
          h('div', { class: 'muted small' }, 'Hoặc quay lại cuộc trò chuyện cũ rồi bấm "Tiếp tục".'),
        ),
      // Gắn trực tiếp Cụm Đo lường Rủi ro Kép (Vòng cung % + 4 Thanh phân cấp) vào trong bảng LIVE
      riskCard(s),
    ),
  );
}

function riskCard(s: Session): Node {
  const r = s.result;
  if (!r) return h('div', { class: 'reason-box' }, 'Chưa có kết quả.');
  const latest = [...r.signals].sort(
    (a, b) => Math.max(...b.evidence_message_ids.map(seqOf)) - Math.max(...a.evidence_message_ids.map(seqOf)),
  )[0];
  return h(
    'div',
    { class: `risk ${r.risk_level}`, style: 'border-left:0;margin-top:4px' },
    h('div', { class: 'risk-dashboard' }, updateGaugeNode(r.risk_level), updateTiersNode(r)),
    h(
      'div',
      { class: `reason-box${s.ai.status === 'running' ? ' ai-shimmer' : ''}` },
      h(
        'div',
        { class: 'row', style: 'justify-content:space-between' },
        h('span', { class: 'level' }, `Mức đánh giá: ${LEVEL_DISPLAY[r.risk_level]}`),
      ),
      r.stability_note && h('div', { class: 'hold small', role: 'status' }, r.stability_note),
      r.raw_level &&
        r.raw_level !== r.risk_level &&
        h('div', { class: 'muted small' }, `Mức tính theo tin mới nhất: ${LEVEL_DISPLAY[r.raw_level]}`),
      s.stability &&
        RISK_LEVEL_ORDER[s.stability.maxLevel] > RISK_LEVEL_ORDER[r.risk_level] &&
        h('div', { class: 'small' }, h('b', {}, 'Mức cao nhất trong phiên: '), LEVEL_DISPLAY[s.stability.maxLevel]),
      h('div', { class: 'small', style: 'margin-top:4px' }, h('span', { class: 'muted' }, 'Vì sao: '), r.level_reason),
      latest && h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Tín hiệu mới nhất: '), latest.title),
      h('div', { class: 'muted small', style: 'margin-top:3px' }, aiStatusText(s)),
    ),
  );
}

const PROVIDER_LABEL = { nano: 'Gemini Nano trên máy', gateway: 'Máy chủ SafeChat' } as const;

function aiStatusText(s: Session): string {
  const ai = s.ai;
  const via = ai.lastProvider
    ? `${PROVIDER_LABEL[ai.lastProvider]}${ai.lastProvider === 'gateway' && ai.lastModel ? ` (${ai.lastModel})` : ''}`
    : '';
  switch (ai.status) {
    case 'off':
      return 'Phân tích bằng bộ quy tắc trên máy (AI đang tắt).';
    case 'idle':
      return 'Quy tắc trên máy; AI sẽ chạy khi có tín hiệu mới hoặc đủ số tin mới.';
    case 'running':
      return `Đang phân tích AI${ai.pending ? ' trên máy' : ''}…`;
    case 'ok':
      return `Quy tắc + AI (${via}), ${ai.calls} lượt trong phiên.${ai.error ? ` ${ai.error}.` : ''}`;
    case 'error':
      return `Chưa phân tích được bằng AI: ${ai.error ?? 'lỗi'}. Kết quả quy tắc vẫn giữ nguyên.`;
  }
}

function aiDisclosure(): string {
  const st = state.settings;
  const parts: string[] = [];
  if (st.nanoEnabled) parts.push('AI trên máy (Gemini Nano) — dữ liệu không rời máy');
  if (st.gatewayEnabled && st.gatewayUrl)
    parts.push('Máy chủ SafeChat — chỉ gửi tin mới kèm vài tin ngữ cảnh và bản tóm tắt, đã che số điện thoại, số tài khoản, email');
  return parts.length
    ? `Phân tích AI đang BẬT: ${parts.join('; ')}.`
    : 'Phân tích chạy hoàn toàn trên máy bằng bộ quy tắc. AI đang tắt.';
}

// ---------- tab Phân tích chi tiết ----------
function analysisView(s: Session): Node {
  const r = s.result;
  if (!r) return h('section', { class: 'card' }, 'Chưa có kết quả.');
  const counts = Object.entries(r.category_counts) as [SignalCategory, number][];
  const maxCount = Math.max(1, ...counts.map(([, n]) => n));
  const ai = s.ai;
  const reached = new Map(r.stages_reached.map((x) => [x.stage, x.first_message_id]));
  return h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Tiến trình kịch bản'),
      h(
        'ol',
        { class: 'stages' },
        ...STAGES.map((st) =>
          h(
            'li',
            { class: `stage${reached.has(st) ? ' on' : ''}${r.stage === st ? ' current' : ''}` },
            h('b', {}, st),
            ` ${STAGE_LABEL[st]}`,
            reached.has(st) && h('span', { class: 'muted small' }, ` · từ ${reached.get(st)}`),
          ),
        ),
      ),
      h(
        'p',
        { class: 'muted small' },
        'Suy ra từ các tín hiệu đã phát hiện, dựa theo các giai đoạn thường gặp của kịch bản lừa đảo. Đi qua nhiều giai đoạn được cộng tối đa 15 điểm.',
      ),
      ai.detectedStage && h('p', { class: 'small' }, `AI đánh giá giai đoạn: ${ai.detectedStage}`),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Tổng hợp dấu hiệu theo mức độ'),
      h('p', { class: 'small' }, r.level_reason),
      r.score_breakdown.length === 0
        ? h('p', { class: 'muted small' }, 'Chưa có tín hiệu.')
        : h(
            'table',
            { class: 'tbl' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Tín hiệu'), h('th', { class: 'num' }, 'Mức độ'))),
            h(
              'tbody',
              {},
              ...r.score_breakdown.map((b) =>
                h(
                  'tr',
                  {},
                  h('td', {}, b.title),
                  h('td', { class: 'num' }, LEVEL_DISPLAY[b.severity]),
                ),
              ),
            ),
          ),
      h(
        'p',
        { class: 'muted small' },
        'Các mức độ được phân thành 4 cấp: Bình thường · Cần chú ý · Cao · Nguy hiểm.',
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Theo nhóm dấu hiệu'),
      counts.length === 0
        ? h('p', { class: 'muted small' }, 'Chưa có.')
        : h(
            'div',
            { class: 'bars' },
            ...counts.map(([c, n]) =>
              h(
                'div',
                { class: 'bar' },
                h('span', { class: 'bar-label' }, CATEGORY_LABEL[c]),
                h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${(n / maxCount) * 100}%` })),
                h('span', { class: 'bar-num' }, String(n)),
              ),
            ),
          ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Diễn biến theo thời gian'),
      s.timeline.length === 0
        ? h('p', { class: 'muted small' }, 'Chưa có thay đổi.')
        : h(
            'ol',
            { class: 'timeline' },
            ...[...s.timeline].reverse().map((t) =>
              h(
                'li',
                { class: `tl ${t.level}` },
                h('div', {}, h('b', {}, LEVEL_DISPLAY[t.level]), h('span', { class: 'muted small' }, ` sau ${t.messageId}`)),
                t.newSignals.length > 0 && h('div', { class: 'small' }, `+ ${t.newSignals.join(', ')}`),
                t.note && h('div', { class: 'muted small' }, t.note),
              ),
            ),
          ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Phân tích AI'),
      h('p', { class: 'small' }, aiStatusText(s)),
      ai.status !== 'off' &&
        h(
          'ul',
          { class: 'small' },
          h('li', {}, `Lượt gọi trong phiên: ${ai.calls}`),
          h('li', {}, `Lượt AI qua máy chủ hôm nay: ${state.usageToday}/${state.settings.dailyBudget}`),
          ai.lastReason && h('li', {}, `Lần gọi gần nhất vì: ${ai.lastReason}`),
          h('li', {}, `Đã phân tích đến: ${ai.lastSeq ? `msg-${String(ai.lastSeq).padStart(3, '0')}` : 'chưa'}`),
        ),
      ai.summary && h('div', {}, h('div', { class: 'muted small' }, 'Tóm tắt do AI viết (đã che dữ liệu cá nhân):'), h('blockquote', {}, ai.summary)),
      ai.insight &&
        h(
          'div',
          { class: 'small' },
          ai.insight.happening && h('p', {}, h('b', {}, 'AI thấy: '), ai.insight.happening),
          ai.insight.tactics.length > 0 && h('p', {}, h('b', {}, 'Chiêu đang dùng: '), ai.insight.tactics.map((t) => TACTIC_TEXT[t] ?? t).join(', ')),
          ai.insight.victim_state !== 'none' && h('p', {}, h('b', {}, 'Trạng thái của bạn: '), VICTIM_TEXT[ai.insight.victim_state] ?? ''),
          ai.insight.likely_next && h('p', {}, h('b', {}, 'Bước tiếp theo có thể: '), ai.insight.likely_next),
          ai.insight.warning && h('p', {}, h('b', {}, 'Cảnh báo của AI: '), ai.insight.warning),
        ),
    ),
  );
}

const TACTIC_TEXT: Record<string, string> = {
  flattery: 'khen, tâng bốc',
  reassurance: 'trấn an',
  authority: 'viện công ty, quy trình',
  urgency: 'giục gấp',
  minimization: 'nói rủi ro nhỏ',
  evasion: 'né câu hỏi',
  bait: 'trả thưởng nhỏ, hứa hẹn',
  secrecy: 'bảo giữ bí mật',
  isolation: 'kéo khỏi người thân, sang kênh khác',
  threat: 'đe dọa',
};
const VICTIM_TEXT: Record<string, string> = {
  doubting: 'đang nghi ngờ, đang hỏi lại',
  convinced: 'có vẻ đã tin, không hỏi thêm',
  about_to_comply: 'sắp làm theo yêu cầu',
  complied: 'có thể đã làm theo yêu cầu',
};

function seqOf(id: string): number {
  return Number(id.replace(/\D/g, '')) || 0;
}

function safetyCard(s: Session): Node | null {
  const a = s.result?.advice;
  if (!s.result?.safety_priority || !a) return null;
  return h(
    'section',
    { class: 'card safety', role: 'alert' },
    h('h2', {}, 'Ưu tiên an toàn của bạn'),
    h('p', {}, a.safety_message ?? ''),
    h('ul', {}, ...(a.support_resources ?? []).map((x) => h('li', {}, x))),
    h('p', { class: 'muted small' }, 'Ở mức này SafeChat AI không gợi ý câu hỏi thăm dò để tránh bạn tiếp tục tương tác nguy hiểm.'),
  );
}

function saveSnapshotFile(s: Session) {
  if (
    !confirm(
      `File sẽ chứa toàn bộ ${s.transcript.messages.length} tin trong bản nháp và được lưu vào máy bạn. Hãy giữ file ở nơi an toàn; SafeChat AI không giữ bản sao. Tiếp tục?`,
    )
  )
    return;
  const snap = createSnapshot({
    threadLabel: s.threadLabel,
    platform: s.platform,
    startedAt: s.resumedFrom?.startedAt ?? s.startedAt,
    maxMessages: s.maxMessages,
    transcript: s.transcript,
    ai: {
      summary: s.ai.summary,
      signals: s.ai.signals,
      uncertainties: s.ai.uncertainties,
      lastSeq: s.ai.lastSeq,
      calls: s.ai.calls,
      downgrade: s.ai.downgrade,
    },
    marks: s.marks,
    timeline: s.timeline,
    stability: s.stability,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  download(`safechat-phien-${stamp}.json`, 'application/json', serializeSnapshot(snap));
}

// ---------- Khối 4 & 5: Hộp Gợi ý làm rõ ý định (Blue Card) + Hộp Giới hạn quét & Tải ngay (Amber Card) ----------
const LINK_LEVEL_TEXT: Record<string, string> = { high: 'Rất đáng ngờ', medium: 'Đáng ngờ', weak: 'Cần xem kỹ', none: 'Chưa thấy dấu hiệu' };

function qrCard(s: Session): Node | null {
  const items = s.result?.qr;
  if (!items?.length) return null;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Mã QR trong đoạn chat'),
    h('p', { class: 'muted small', style: 'margin:4px 0 8px' }, 'Đọc ngay trên máy, ảnh không được gửi đi. Số tài khoản đã che.'),
    ...items.map((q) =>
      h(
        'div',
        { style: 'padding:6px 0;border-top:1px solid #e2e8f0' },
        h('div', { class: 'small', style: 'display:flex;justify-content:space-between;gap:8px' }, h('b', {}, q.label), h('span', {}, q.level === 'none' ? '' : LINK_LEVEL_TEXT[q.level] ?? '')),
        ...q.details.map((d) => h('div', { class: 'small', style: 'word-break:break-all' }, `${d.label}: ${d.value}`)),
        ...q.reasons.map((reason) => h('div', { class: 'muted small' }, reason)),
      ),
    ),
  );
}

function linksCard(s: Session): Node | null {
  const links = s.result?.links;
  if (!links?.length) return null;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Link trong đoạn chat'),
    h('p', { class: 'muted small', style: 'margin:4px 0 8px' }, 'Phân tích ngay trên máy, không mở link. Chỉ hiện tên miền, không bấm được.'),
    ...links.map((l) =>
      h(
        'div',
        { style: 'padding:6px 0;border-top:1px solid #e2e8f0' },
        h('div', { class: 'small', style: 'display:flex;justify-content:space-between;gap:8px' }, h('b', { style: 'word-break:break-all' }, l.domain ?? l.url), h('span', {}, LINK_LEVEL_TEXT[l.level] ?? '')),
        ...l.reasons.map((reason) => h('div', { class: 'muted small' }, reason)),
      ),
    ),
  );
}

function adviceCard(s: Session): Node | null {
  const a = s.result?.advice;
  if (!a) return null;
  const msgPct = Math.min(100, Math.round((s.transcript.messages.length / Math.max(1, s.maxMessages)) * 100));
  const aiPct = state.settings.gatewayEnabled ? Math.min(100, Math.round((state.usageToday / Math.max(1, state.settings.dailyBudget)) * 100)) : 0;
  const usagePct = Math.max(msgPct, aiPct);
  const nearLimit = usagePct >= 80;

  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    // Khối 4: Hộp Gợi ý để làm rõ ý định (màu xanh pastel như ảnh thiết kế)
    h(
      'section',
      { class: 'advice-hero-card' },
      h(
        'div',
        {
          class: 'advice-hero-header',
          onclick: () => {
            state.adviceExpanded = !state.adviceExpanded;
            render();
          },
        },
        h('div', { class: 'advice-hero-title' }, h('span', {}, 'Gợi ý để làm rõ ý định')),
        h('span', { class: `chevron${state.adviceExpanded ? ' open' : ''}` }, '›'),
      ),
      h(
        'ul',
        { class: 'small', style: 'margin-top:8px' },
        ...a.actions.slice(0, state.adviceExpanded ? 6 : 2).map((x) => h('li', {}, x)),
      ),
      a.answer_assessment === 'evasive' && h('p', { class: 'small', style: 'margin:8px 0 0;font-weight:700' }, 'AI: câu trả lời còn né tránh, chung chung.'),
      a.answer_assessment === 'contradictory' && h('p', { class: 'small', style: 'margin:8px 0 0;font-weight:700' }, 'AI: câu trả lời mâu thuẫn với điều đã nói trước đó.'),
      (s.result?.open_questions?.length ?? 0) > 0 &&
        h(
          'div',
          { class: 'small', style: 'margin:8px 0 0;padding:6px 8px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#7f1d1d' },
          h('b', {}, 'Bạn đã hỏi nhưng chưa được trả lời rõ'),
          ...s.result!.open_questions!.map((q) => h('div', {}, `• ${q}`)),
        ),
      a.ai_warning && h('p', { class: 'small', style: 'margin:8px 0 0;font-weight:700' }, `AI nhận định: ${a.ai_warning}`),
      a.likely_next && h('p', { class: 'small', style: 'margin:4px 0 0' }, `Bước tiếp theo có thể: ${a.likely_next}`),
      a.waiting_answer && !s.result?.signals.some((x) => /^user_(complied|intends)_/.test(x.type)) && h('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'Đang chờ đối phương trả lời. Đọc kỹ câu trả lời trước khi làm tiếp.'),
      state.adviceExpanded &&
        a.questions.length > 0 &&
        h(
          'div',
          { style: 'margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)' },
          h('div', { class: 'small', style: 'font-weight:700;margin-bottom:4px' }, 'Câu hỏi bạn có thể tự gửi:'),
          h('p', { class: 'muted small', style: 'margin:0 0 6px' }, 'SafeChat AI không tự gửi tin. Hãy sao chép và tự quyết định có gửi hay không.'),
          a.question_reason && h('p', { class: 'muted small', style: 'margin:0 0 6px' }, `Vì sao nên hỏi câu đầu: ${a.question_reason}`),
          ...a.questions.map((q) =>
            h(
              'div',
              { class: 'q' },
              h('span', { class: 'small' }, q),
              h(
                'button',
                {
                  class: 'link',
                  onclick: async () => {
                    await navigator.clipboard.writeText(q);
                    setNotice('ok', 'Đã sao chép câu hỏi.');
                  },
                },
                'Sao chép',
              ),
            ),
          ),
        ),
    ),
    // Khối 5: Hộp Giới hạn quét & Nút Tải ngay (màu vàng cam như ảnh thiết kế)
    h(
      'section',
      { class: 'quota-card' },
      h(
        'div',
        { class: 'quota-left' },
        h(
          'div',
          {},
          h(
            'div',
            { class: 'quota-title' },
            nearLimit ? `Gần đến giới hạn quét (${usagePct}%)` : `Bộ nhớ phiên (${s.transcript.messages.length}/${s.maxMessages} tin · ${usagePct}%)`,
          ),
          h(
            'div',
            { class: 'quota-desc' },
            nearLimit
              ? 'Vui lòng tải bản lưu thông tin và khởi động lại để tiếp tục sử dụng.'
              : 'Tải bản lưu phiên (.json) bất cứ lúc nào để bảo toàn bằng chứng và khôi phục về sau.',
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'cta-orange',
          onclick: () => saveSnapshotFile(s),
        },
        'Tải ngay',
      ),
    ),
    (s.result?.uncertainties.length ?? 0) > 0 &&
      h('section', { class: 'card' }, h('h2', {}, 'Chưa đủ thông tin'), h('ul', {}, ...s.result!.uncertainties.map((u) => h('li', {}, u)))),
  );
}

const MARKS: [UserMark, string][] = [
  ['verified', 'Đã xác minh'],
  ['not_relevant', 'Không liên quan'],
  ['review', 'Cần xem lại'],
];

function signalCard(s: Session, sig: Signal): Node {
  const key = signalKey(sig);
  const mark = s.marks[key];
  return h(
    'article',
    { class: `sig ${sig.severity}${mark === 'not_relevant' ? ' dim' : ''}` },
    h(
      'h3',
      {},
      sig.title,
      h('span', { class: 'tag' }, sig.source === 'ai' ? 'AI' : sig.source === 'ledger' ? 'Đối chiếu' : sig.ai_note ? 'Quy tắc + AI' : 'Quy tắc'),
      sig.ref && h('span', { class: 'tag' }, sig.ref),
      sig.confidence !== undefined && h('span', { class: 'tag' }, `độ chắc ${Math.round(sig.confidence * 100)}%`),
      sig.mitigation && h('span', { class: 'tag ok' }, 'Đã hạ mức theo ngữ cảnh'),
    ),
    h('div', { class: 'small' }, sig.explanation),
    ...sig.evidence_message_ids.map((id, i) =>
      h(
        'blockquote',
        {},
        h('span', { class: 'mid' }, sig.type === 'possible_contradiction' ? (i === 0 ? `Trước (${id})` : `Sau (${id})`) : id),
        sig.evidence_quotes[i] ?? '',
      ),
    ),
    h('div', { class: 'small' }, h('b', {}, 'Nên làm: '), sig.recommended_action),
    h(
      'div',
      { class: 'marks' },
      ...MARKS.map(([m, label]) =>
        h(
          'button',
          {
            'aria-pressed': mark === m ? 'true' : 'false',
            onclick: () => void send({ kind: 'mark', key, mark: mark === m ? null : m }),
          },
          label,
        ),
      ),
    ),
  );
}

function evidenceView(s: Session): Node {
  const sigs = s.result?.signals ?? [];
  const ledger = s.result?.claims ?? [];
  return h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h('h2', {}, `Tín hiệu và bằng chứng (${sigs.length})`),
      h('p', { class: 'muted small' }, 'Đánh dấu chỉ để bạn ghi chú khi xem lại và đưa vào báo cáo; không làm thay đổi điểm.'),
      sigs.length === 0 ? h('p', {}, 'Chưa thấy dấu hiệu rõ trong phần đã đọc.') : null,
      ...sigs.map((x) => signalCard(s, x)),
    ),
    ledger.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Sổ đối chiếu phát biểu'),
        h(
          'ul',
          {},
          ...ledger.map((c) =>
            h(
              'li',
              {},
              `${c.claim_text} — ${c.source_message_id} `,
              h(
                'span',
                { class: 'tag' },
                { unverified: 'chưa xác minh', consistent: 'nhất quán', possible_contradiction: 'chưa nhất quán', explained: 'đã đính chính' }[c.status],
              ),
            ),
          ),
        ),
      ),
  );
}

function draftView(s: Session): Node {
  const flagged = new Set(s.result?.signals.flatMap((x) => x.evidence_message_ids) ?? []);
  const who = { self: 'Bạn', other: 'Đối phương', unknown: 'Chưa rõ người gửi' } as const;
  const doExport = (fmt: 'html' | 'json', scope: ExportScope) => {
    const what = scope === 'full' ? `toàn bộ ${s.transcript.messages.length} tin trong bản nháp` : 'chỉ cảnh báo và tin nhắn làm bằng chứng';
    if (!confirm(`File sẽ chứa ${what} cùng kết quả phân tích, và được lưu vào máy bạn. SafeChat AI không giữ bản sao file này. Tiếp tục?`)) return;
    const input = {
      threadLabel: s.threadLabel,
      startedAt: s.startedAt,
      exportedAt: Date.now(),
      messages: s.transcript.messages,
      result: s.result,
      marks: s.marks,
      scope,
      aiUsed: s.ai.calls > 0,
    };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (fmt === 'html') download(`safechat-bao-cao-${stamp}.html`, 'text/html', exportHtml(input));
    else download(`safechat-bao-cao-${stamp}.json`, 'application/json', exportJson(input));
  };
  return h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Xuất báo cáo'),
      h(
        'div',
        { class: 'row' },
        h('button', { onclick: () => doExport('html', 'full') }, 'HTML — toàn bộ'),
        h('button', { onclick: () => doExport('html', 'alerts_only') }, 'HTML — chỉ cảnh báo'),
        h('button', { onclick: () => doExport('json', 'full') }, 'JSON'),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Lưu phiên để tiếp tục'),
      h(
        'p',
        { class: 'muted small' },
        'Lưu toàn bộ bản nháp, bằng chứng, tóm tắt AI và trạng thái cảnh báo vào một file trên máy bạn. Khi mở lại trình duyệt, dùng "Tiếp tục từ bản nháp" ở màn hình bắt đầu.',
      ),
      h(
        'button',
        {
          onclick: () => saveSnapshotFile(s),
        },
        'Lưu phiên (.json)',
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, `Bản nháp tạm (${s.transcript.messages.length} tin)`),
      s.transcript.messages.length === 0 ? h('p', { class: 'muted' }, 'Chưa có tin nhắn nào được ghi nhận.') : null,
      ...s.transcript.messages.map((m) =>
        h(
          'div',
          { class: `msg ${m.sender}${flagged.has(m.id) ? ' flag' : ''}` },
          h('div', { class: 'who' }, `${m.id} · ${who[m.sender]}`),
          m.text,
        ),
      ),
    ),
  );
}

/** Cách đọc khi bắt đầu quét. Lưu ngay, áp dụng từ lần quét sau. */
function historyModeControl(): Node {
  const st = state.settings;
  const choose = async (historyScroll: boolean) => {
    state.settings = { ...st, historyScroll };
    await chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
    render();
  };
  const option = (value: boolean, title: string, note: string) =>
    h(
      'label',
      { class: 'check', style: 'margin-top:6px' },
      h('input', { type: 'radio', name: 'history-mode', checked: st.historyScroll === value, onchange: () => void choose(value) }),
      h('span', { class: 'small' }, h('b', {}, title), ` ${note}`),
    );
  return h(
    'div',
    { style: 'margin-top:8px' },
    h('div', { class: 'muted small', style: 'font-weight:600' }, 'Cách đọc khi bắt đầu quét:'),
    option(true, 'Tự cuộn đọc lịch sử.', 'Tự cuộn khung chat lên để tải tối đa 50 tin rồi trả về chỗ cũ. Đánh giá đầy đủ hơn.'),
    option(false, 'Không cuộn.', 'Chỉ đọc các tin đang có trên trang, tối đa 50 tin mới nhất. Khung chat không bị đụng tới, nhưng có thể thiếu tin cũ.'),
  );
}

function settingsCard(): Node {
  const st = state.settings;
  const save = async (next: Settings) => {
    state.settings = next;
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    if (state.session) await send({ kind: 'reanalyze' });
    render();
  };
  return h(
    'section',
    { class: 'card', id: 'settings-section' },
    h('h2', {}, 'Cài đặt'),
    historyModeControl(),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'max' }, 'Số tin tối đa giữ trong bản nháp (áp dụng cho phiên mới)'),
      h('input', {
        id: 'max',
        type: 'number',
        min: '20',
        max: '300',
        value: String(st.maxMessages),
        onchange: (e: Event) => {
          const v = Math.max(20, Math.min(300, Number((e.target as HTMLInputElement).value) || 300));
          void save({ ...st, maxMessages: v });
        },
      }),
    ),
    // ----- Tầng 1: AI trên máy -----
    h('h3', { style: 'margin-top:12px' }, '1. AI trên máy — Gemini Nano (ưu tiên)'),
    h(
      'p',
      { class: 'muted small' },
      'Chạy ngay trong Chrome, dữ liệu không rời máy, không tốn phí hay hạn mức. Cần Chrome máy tính (Windows/macOS/Linux), khoảng 22 GB trống và GPU trên 4 GB hoặc 16 GB RAM. Chỉ chạy khi side panel đang mở. Tiếng Việt chưa được hỗ trợ chính thức nên đây là chế độ thử nghiệm.',
    ),
    nanoControls(st, save),
    // ----- Tầng 2: Máy chủ SafeChat -----
    h('h3', { style: 'margin-top:12px' }, '2. Máy chủ SafeChat — dự phòng / khi đóng side panel'),
    h(
      'p',
      { class: 'muted small' },
      'Không cần khóa API. Chỉ gửi tin MỚI kèm vài tin ngữ cảnh và bản tóm tắt do AI viết, đã che số điện thoại, số tài khoản, email, tới máy chủ SafeChat. Máy chủ giữ khóa mô hình, extension không giữ. "Dừng và xóa" xóa dữ liệu phiên trên máy này nhưng không thu hồi được dữ liệu đã gửi tới máy chủ. Bạn có thể tắt bất cứ lúc nào.',
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'gw' }, 'Địa chỉ máy chủ SafeChat (HTTPS)'),
      h('input', {
        id: 'gw',
        type: 'url',
        placeholder: 'https://…',
        value: st.gatewayUrl,
        autocomplete: 'off',
        onchange: (e: Event) => void save({ ...st, gatewayUrl: (e.target as HTMLInputElement).value.trim() }),
      }),
    ),
    h(
      'div',
      { class: 'row' },
      st.gatewayEnabled
        ? h('button', { onclick: () => void save({ ...st, gatewayEnabled: false }) }, 'Tắt máy chủ SafeChat')
        : h(
            'button',
            {
              disabled: !st.gatewayUrl,
              onclick: async () => {
                const url = normalizeGatewayUrl(st.gatewayUrl);
                if (!url) return setNotice('err', 'Địa chỉ máy chủ không hợp lệ (cần dạng https://…).');
                if (!confirm('Bật máy chủ SafeChat: tin nhắn mới (đã che dữ liệu cá nhân) và bản tóm tắt sẽ được gửi tới máy chủ SafeChat. Bạn đồng ý?')) return;
                const granted = await chrome.permissions.request({ origins: [gatewayOriginPattern(url)] });
                if (!granted) return setNotice('err', 'Chưa được cấp quyền truy cập máy chủ SafeChat.');
                await save({ ...st, gatewayUrl: url, gatewayEnabled: true });
              },
            },
            'Bật máy chủ SafeChat',
          ),
      h('span', { class: st.gatewayEnabled ? 'ok small' : 'muted small' }, st.gatewayEnabled ? 'Đang bật' : 'Đang tắt'),
    ),
    h(
      'label',
      { class: 'small', style: 'display:flex;gap:6px;margin-top:10px' },
      h('input', { type: 'checkbox', checked: st.qrScan !== false, onchange: (e: Event) => void save({ ...st, qrScan: (e.target as HTMLInputElement).checked }) }),
      h('span', {}, 'Đọc mã QR trong ảnh của đoạn chat đã khóa. Chạy ngay trên máy, ảnh không được gửi đi. Áp dụng từ lần quét sau.'),
    ),
    // ----- Tiết kiệm lượt gọi -----
    h('h3', { style: 'margin-top:12px' }, 'Tiết kiệm lượt gọi AI'),
    h(
      'div',
      { class: 'grid3' },
      numField('budget', 'Lượt AI/ngày', st.dailyBudget, 10, 5000, (v) => save({ ...st, dailyBudget: v })),
      numField('batch', 'Gọi khi đủ N tin mới', st.batchSize, 1, 50, (v) => save({ ...st, batchSize: v })),
      numField('gap', 'Cách nhau tối thiểu (giây)', st.minIntervalSec, 3, 600, (v) => save({ ...st, minIntervalSec: v })),
    ),
    h('p', { class: 'muted small' }, `Đã dùng hôm nay: ${state.usageToday}/${st.dailyBudget} lượt qua máy chủ SafeChat. Bộ quy tắc cảnh báo sau từng tin. Khi bắt đầu quét, AI đọc ngay tối đa 50 tin gần nhất. Sau đó AI chạy khi đủ N tin mới của cả hai phía, hoặc khi hội thoại dừng ${st.idleFlushSec} giây mà còn tin chưa đọc.`),
  );
}

function numField(id: string, label: string, value: number, min: number, max: number, onSave: (v: number) => void): Node {
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    h('input', {
      id,
      type: 'number',
      min: String(min),
      max: String(max),
      value: String(value),
      onchange: (e: Event) => onSave(Math.max(min, Math.min(max, Number((e.target as HTMLInputElement).value) || value))),
    }),
  );
}

function nanoControls(st: Settings, save: (s: Settings) => Promise<void>): Node {
  const n = state.nano;
  if (!n) return h('p', { class: 'muted small' }, 'Đang kiểm tra khả năng của trình duyệt…');
  if (!n.supported || !n.lang)
    return h('p', { class: 'small err' }, 'Trình duyệt/máy này chưa hỗ trợ Prompt API (Gemini Nano). Có thể dùng máy chủ SafeChat thay thế.');
  const label: Record<string, string> = {
    available: 'Mô hình đã sẵn sàng',
    downloadable: 'Cần tải mô hình (một lần, vài GB)',
    downloading: 'Đang tải mô hình…',
    unavailable: 'Không khả dụng',
  };
  return h(
    'div',
    {},
    h(
      'p',
      { class: 'small' },
      `${label[n.availability]}${n.experimental ? ' · chạy chế độ thử nghiệm (vi chưa hỗ trợ, dùng en)' : ''}`,
      state.nanoProgress !== null && ` · ${Math.round(state.nanoProgress * 100)}%`,
    ),
    h(
      'div',
      { class: 'row' },
      st.nanoEnabled
        ? h('button', { onclick: () => void save({ ...st, nanoEnabled: false }).then(heartbeat) }, 'Tắt AI trên máy')
        : h(
            'button',
            {
              onclick: async () => {
                try {
                  if (n.availability !== 'available') {
                    state.nanoProgress = 0;
                    render();
                    await downloadNano(n.lang!, (p) => {
                      state.nanoProgress = p;
                      render();
                    });
                    state.nanoProgress = null;
                    state.nano = await nanoStatus();
                  }
                  await save({ ...st, nanoEnabled: true });
                  await heartbeat();
                } catch (e) {
                  state.nanoProgress = null;
                  setNotice('err', `Không bật được AI trên máy: ${(e as Error).message}`);
                }
              },
            },
            n.availability === 'available' ? 'Bật AI trên máy' : 'Tải mô hình & bật',
          ),
      h('span', { class: st.nanoEnabled ? 'ok small' : 'muted small' }, st.nanoEnabled ? 'Đang bật' : 'Đang tắt'),
    ),
  );
}

// ---------- chạy Gemini Nano khi background yêu cầu ----------
let nanoBusy: string | null = null;

async function heartbeat() {
  const ready = state.settings.nanoEnabled && state.nano?.availability === 'available' && !!state.nano.lang;
  await send({ kind: 'panel_status', nanoReady: ready }).catch(() => {});
}

async function servePendingNano(s: Session | null) {
  const p = s?.ai.pending;
  if (!p || nanoBusy === p.id || !state.nano?.lang) return;
  nanoBusy = p.id;
  try {
    const content = await runNano(p.request, state.nano.lang);
    await send({ kind: 'ai_result', id: p.id, ok: true, content });
  } catch (e) {
    await send({ kind: 'ai_result', id: p.id, ok: false, error: (e as Error).message || 'lỗi không rõ' });
  } finally {
    nanoBusy = null;
  }
}

async function refreshUsage() {
  const r = (await chrome.storage.local.get(USAGE_KEY))[USAGE_KEY] as { date: string; count: number } | undefined;
  state.usageToday = r && r.date === new Date().toISOString().slice(0, 10) ? r.count : 0;
}

async function stopAndClear() {
  if (
    !confirm(
      'Dừng theo dõi và xóa: bản nháp tin nhắn, kết quả phân tích, đánh dấu của bạn và trạng thái phiên do extension quản lý. File bạn đã tải về không bị ảnh hưởng. Tiếp tục?',
    )
  )
    return;
  const r = await send<StopResult>({ kind: 'stop_and_clear' });
  state.consent = false;
  state.view = 'overview';
  tiersDomCache = null;
  if (r.ok)
    setNotice(
      'ok',
      'Phiên đã dừng và dữ liệu phiên do extension quản lý đã được xóa. File bạn đã tải về vẫn nằm trên thiết bị và do bạn tự quản lý. Dữ liệu đã gửi đến dịch vụ bên ngoài (nếu có) chịu chính sách của dịch vụ đó.',
    );
  else setNotice('err', `Chưa xóa được hoàn toàn (còn: ${r.remainingKeys.join(', ')}). Hãy thử lại.`);
}

// ---------- render ----------
function render() {
  const app = document.getElementById('app')!;
  const s = state.session;
  const nodes: Child[] = [];
  if (state.notice) nodes.push(h('div', { class: `card ${state.notice.kind}`, role: 'status' }, state.notice.text));

  if (!s) {
    tiersDomCache = null;
    nodes.push(introView());
  } else {
    nodes.push(sessionHeader(s), safetyCard(s));
    const tabs: [View, string][] = [
      ['overview', 'Gợi ý'],
      ['analysis', 'Phân tích'],
      ['evidence', `Bằng chứng (${s.result?.signals.length ?? 0})`],
      ['draft', 'Bản nháp'],
      ['settings', 'Cài đặt'],
    ];
    nodes.push(
      h(
        'nav',
        { class: 'tabs', role: 'tablist' },
        ...tabs.map(([v, label]) =>
          h(
            'button',
            {
              role: 'tab',
              'aria-selected': state.view === v ? 'true' : 'false',
              onclick: () => {
                state.view = v;
                render();
              },
            },
            label,
          ),
        ),
      ),
    );
    nodes.push(
      state.view === 'overview'
        ? adviceCard(s)
        : state.view === 'analysis'
          ? analysisView(s)
          : state.view === 'evidence'
            ? evidenceView(s)
            : state.view === 'draft'
              ? draftView(s)
              : settingsCard(),
    );
    if (state.view === 'overview') nodes.push(qrCard(s), linksCard(s));
  }
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
}

async function refreshProbe() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.probe = null;
  render();
  state.probe = state.tabId === null ? { supported: false, reason: 'Không có tab đang mở.' } : await send<ProbeResult>({ kind: 'probe', tabId: state.tabId });
  render();
}

async function init() {
  const [sess, sett] = await Promise.all([chrome.storage.session.get(SESSION_KEY), chrome.storage.local.get(SETTINGS_KEY)]);
  state.session = (sess[SESSION_KEY] as Session | undefined) ?? null;
  state.settings = { ...DEFAULT_SETTINGS, ...migrateSettings((sett[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {}).settings } as Settings;
  await refreshUsage();
  render();
  await refreshProbe();
  state.nano = await nanoStatus();
  render();
  await heartbeat();
  void servePendingNano(state.session);
  // Báo background định kỳ rằng side panel còn mở và Nano có sẵn sàng không
  setInterval(() => void heartbeat(), 20_000);
  chrome.storage.local.onChanged.addListener((changes) => {
    if (USAGE_KEY in changes) void refreshUsage().then(render);
  });

  chrome.storage.session.onChanged.addListener((changes) => {
    if (!(SESSION_KEY in changes)) return;
    state.session = (changes[SESSION_KEY]?.newValue as Session | undefined) ?? null;
    void servePendingNano(state.session);
    // Không render lại khi người dùng đang gõ trong ô nhập (tránh mất nội dung đang gõ)
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type !== 'checkbox') {
      active.addEventListener('blur', () => render(), { once: true });
      return;
    }
    render();
  });
  chrome.tabs.onActivated.addListener(() => void (!state.session && refreshProbe()));
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.status === 'complete' && !state.session) void refreshProbe();
  });
  // cập nhật thời lượng phiên
  setInterval(() => state.session && render(), 60_000);
}

void init();
