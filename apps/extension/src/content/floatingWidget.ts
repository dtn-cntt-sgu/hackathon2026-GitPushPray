// Floating Widget nổi trên trang (Shadow DOM cô lập hoàn toàn, không dùng innerHTML, không can thiệp DOM của Messenger).
// Hỗ trợ:
// 1. Khi mới mở Facebook: hiển thị ở góc trên bên phải màn hình (không che vùng chat ở góc dưới phải).
// 2. Kéo thả tự do đến bất kỳ đâu trên màn hình (PointerEvents + giới hạn trong khung nhìn).
// 3. Khi thu gọn hoặc khóa đoạn chat: biến thành Chú Mèo Đen Pixel Art cầm Khiên Pixel bám ngay trên mép đỉnh khung chat
//    với hiệu ứng chuyển động mượt mà và bong bóng gợi ý hiển thị ngay trên đầu mèo.
// 4. Khi bấm vào mèo hoặc "Chi tiết": mở bảng Chi tiết nằm ngay BÊN CẠNH khung chat (ưu tiên bên trái khung chat) để không che tin nhắn.
// 5. Loại bỏ hoàn toàn điểm số dao động (%/100), chỉ hiển thị 4 mức độ trực quan: Bình thường · Cần chú ý · Cao · Nguy hiểm.
import { createSnapshot, serializeSnapshot } from '@safechat/core/context-manager';
import { exportHtml } from '@safechat/core/export';
import {
  RISK_LEVEL_ORDER,
  STAGE_LABEL,
  type AnalysisResult,
  type RiskLevel,
  type ScamStage,
  type Severity,
  type Signal,
  type UserMark,
} from '@safechat/core/types';
import {
  probeThreads,
  SESSION_KEY,
  signalKey,
  type PanelRequest,
  type ProbeResult,
  type Session,
  type ThreadInfo,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  type Settings,
} from '../shared/protocol';
import { decideDrop, switchChatPrompt } from './dropDecision';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STAGES: ScamStage[] = ['S0', 'S1', 'S2', 'S3', 'S4'];
const MARKS: [UserMark, string][] = [
  ['verified', 'Đã xác minh'],
  ['not_relevant', 'Không liên quan'],
  ['review', 'Cần xem lại'],
];

/** 4 mức độ hiển thị thống nhất toàn giao diện (không dùng điểm số dao động). */
const LEVEL_DISPLAY: Record<RiskLevel | Severity, string> = {
  low: 'Bình thường',
  attention: 'Cần chú ý',
  medium: 'Cần chú ý',
  high: 'Cao',
  critical: 'Nguy hiểm',
};

const LEVEL_SUBTITLE: Record<RiskLevel, string> = {
  low: 'Chưa phát hiện dấu hiệu bất thường',
  attention: 'Có chi tiết cần hỏi rõ để xác minh',
  high: 'Phát hiện dấu hiệu rủi ro đáng ngờ',
  critical: 'Cảnh báo nguy hiểm, tuyệt đối cảnh giác',
};

const SHIELD_PIXEL_PALETTE: Record<RiskLevel, { main: string; light: string; dark: string }> = {
  low: { main: '#16a34a', light: '#4ade80', dark: '#14532d' },
  attention: { main: '#2563eb', light: '#60a5fa', dark: '#1e3a8a' },
  high: { main: '#ea580c', light: '#fb923c', dark: '#7c2d12' },
  critical: { main: '#dc2626', light: '#f87171', dark: '#7f1d1d' },
};

type DetailTab = 'overview' | 'evaluate' | 'analysis';
type SessionViewMode = 'mini' | 'detail';

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

const WIDGET_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483640;
  font: 13px/1.45 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #161e2e;
}
* { box-sizing: border-box; }

/* Hiệu ứng chuyển động riêng biệt hoàn toàn cho 4 mức độ + 3 bước Kéo-Thả vào khung chat */
@keyframes cat-breathe {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
@keyframes cat-curious-tilt {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  30% { transform: translateY(-1.5px) rotate(-4deg); }
  70% { transform: translateY(-1px) rotate(4deg); }
}
@keyframes cat-magnifier-scan {
  0%, 100% { transform: translate(0, 0) rotate(-6deg); }
  50% { transform: translate(2.5px, -1.5px) rotate(8deg); }
}
@keyframes cat-flag-wave {
  0%, 100% { transform: rotate(-12deg); }
  50% { transform: rotate(14deg); }
}
@keyframes cat-siren-flash {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.92); }
}
@keyframes cat-alert-stance {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-2.5px) scale(1.03); }
}
@keyframes cat-dangle-sway {
  0%, 100% { transform: translateY(-2px) rotate(-5deg); }
  50% { transform: translateY(1px) rotate(5deg); }
}
@keyframes cat-dangle-legs {
  0%, 100% { transform: rotate(10deg); }
  50% { transform: rotate(-10deg); }
}
@keyframes cat-pounce-wiggle {
  0%, 100% { transform: translateY(0) scale(1.04, 0.96); }
  50% { transform: translateY(-3px) scale(0.97, 1.05); }
}
@keyframes cat-paws-reach {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(1.8px); }
}
@keyframes cat-land-bounce {
  0% { transform: translateY(-14px) scale(0.92, 1.1); }
  45% { transform: translateY(3px) scale(1.12, 0.88); }
  75% { transform: translateY(-3px) scale(0.97, 1.03); }
  100% { transform: translateY(0) scale(1, 1); }
}
@keyframes cat-sleep-breathe {
  0%, 100% { transform: scale(1, 1) translateY(0); }
  50% { transform: scale(1.03, 0.96) translateY(0.4px); }
}
@keyframes cat-zzz-float-1 {
  0% { opacity: 0; transform: translate(0, 2px) scale(0.85); }
  30% { opacity: 1; }
  80% { opacity: 0.9; transform: translate(1.8px, -3px) scale(1); }
  100% { opacity: 0; transform: translate(2.8px, -4.8px) scale(1.05); }
}
@keyframes cat-zzz-float-2 {
  0%, 20% { opacity: 0; transform: translate(0, 2px) scale(0.85); }
  50% { opacity: 1; }
  90% { opacity: 0.95; transform: translate(2.2px, -3.5px) scale(1.05); }
  100% { opacity: 0; transform: translate(3.2px, -5.2px) scale(1.1); }
}
@keyframes cat-wake-stretch {
  0% { transform: translateY(3px) scale(1.12, 0.86); }
  40% { transform: translateY(-6px) scale(0.94, 1.08) rotate(-3deg); }
  75% { transform: translateY(1px) scale(1.03, 0.98) rotate(2deg); }
  100% { transform: translateY(0) scale(1, 1) rotate(0deg); }
}
@keyframes cat-blink {
  0%, 43%, 47%, 89%, 93%, 100% { transform: scaleY(1); }
  45%, 91% { transform: scaleY(0.12); }
}
@keyframes cat-ear-left {
  0%, 80%, 100% { transform: rotate(0deg); }
  84% { transform: rotate(-7deg); }
  88% { transform: rotate(2deg); }
}
@keyframes cat-ear-right {
  0%, 56%, 100% { transform: rotate(0deg); }
  60% { transform: rotate(7deg); }
  64% { transform: rotate(-2deg); }
}
@keyframes cat-tail-sway {
  0%, 100% { transform: rotate(-6deg); }
  50% { transform: rotate(10deg); }
}
@keyframes shield-hug-breathe {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-1.5px) scale(1.03); }
}
@keyframes shield-hug-guard {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-2.5px) scale(1.06); }
}
@keyframes cat-badge-bob {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-2.5px) scale(1.08); }
}
/* Hoạt ảnh bùng nổ trong ~3 giây đầu khi vừa đổi mức cảnh báo để thu hút sự chú ý */
@keyframes cat-burst-attention {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-7px) rotate(-6deg) scale(1.06); }
  55% { transform: translateY(0) rotate(5deg); }
  80% { transform: translateY(-4px) rotate(-3deg); }
}
@keyframes cat-burst-high {
  0%, 100% { transform: translate(0, 0) scale(1); }
  15% { transform: translate(-3px, -8px) rotate(-5deg) scale(1.08); }
  30% { transform: translate(3px, -7px) rotate(5deg) scale(1.08); }
  45% { transform: translate(-3px, -4px) rotate(-4deg) scale(1.05); }
  60% { transform: translate(3px, -4px) rotate(4deg) scale(1.05); }
  75% { transform: translate(-2px, -2px) rotate(-2deg); }
}
@keyframes cat-burst-critical {
  0%, 100% { transform: translate(0, 0) scale(1); }
  12% { transform: translate(-4px, -10px) rotate(-7deg) scale(1.12); }
  24% { transform: translate(4px, -9px) rotate(7deg) scale(1.12); }
  36% { transform: translate(-4px, -6px) rotate(-6deg) scale(1.09); }
  48% { transform: translate(4px, -6px) rotate(6deg) scale(1.09); }
  60% { transform: translate(-3px, -3px) rotate(-4deg) scale(1.05); }
  72% { transform: translate(3px, -3px) rotate(4deg) scale(1.05); }
  84% { transform: translate(-2px, -1px) rotate(-2deg); }
}
@keyframes pulse-dot {
  0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.55); }
  70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes spotlight-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.2), 0 12px 32px rgba(37, 99, 235, 0.22); }
  50% { box-shadow: 0 0 0 8px rgba(37, 99, 235, 0.32), 0 14px 36px rgba(37, 99, 235, 0.34); }
}

.pixel-cat-svg {
  overflow: visible;
  shape-rendering: crispEdges;
  image-rendering: pixelated;
  filter: drop-shadow(0 6px 12px rgba(15, 23, 42, 0.22));
  transform-origin: 50% 85%;
}
.pixel-cat-svg.level-attention {
  filter: drop-shadow(0 6px 14px rgba(37, 99, 235, 0.28));
}
.pixel-cat-svg.level-high {
  filter: drop-shadow(0 6px 15px rgba(234, 88, 12, 0.34));
}
.pixel-cat-svg.level-critical {
  filter: drop-shadow(0 6px 16px rgba(220, 38, 38, 0.42));
}
.pixel-cat-svg.level-attention.burst {
  animation: cat-burst-attention 0.75s cubic-bezier(0.22, 1, 0.36, 1) 3;
}
.pixel-cat-svg.level-high.burst {
  animation: cat-burst-high 0.6s ease-in-out 5;
}
.pixel-cat-svg.level-critical.burst {
  animation: cat-burst-critical 0.5s ease-in-out 6;
}
.pixel-cat-svg.pose-dragging {
  animation: cat-dangle-sway 0.75s ease-in-out infinite;
  filter: drop-shadow(0 14px 20px rgba(15, 23, 42, 0.32));
}
.pixel-cat-svg.pose-pounce {
  animation: cat-pounce-wiggle 0.48s ease-in-out infinite;
  filter: drop-shadow(0 8px 18px rgba(37, 99, 235, 0.45));
}
.pixel-cat-svg.pose-landing {
  animation: cat-land-bounce 0.65s cubic-bezier(0.22, 1, 0.36, 1) 1;
}
.pixel-cat-svg.pose-sleeping {
  filter: drop-shadow(0 4px 10px rgba(15, 23, 42, 0.18));
}
.pixel-cat-svg.pose-waking {
  animation: cat-wake-stretch 0.65s cubic-bezier(0.22, 1, 0.36, 1) 1;
}
.pixel-cat-sleep-body {
  animation: cat-sleep-breathe 3.4s ease-in-out infinite;
  transform-origin: 13px 14px;
}
.pixel-cat-zzz-1 {
  animation: cat-zzz-float-1 2.8s ease-in-out infinite;
  transform-origin: 17px 4px;
}
.pixel-cat-zzz-2 {
  animation: cat-zzz-float-2 2.8s ease-in-out infinite;
  transform-origin: 21px 2px;
}

.pixel-cat-body {
  animation: cat-breathe 2.8s ease-in-out infinite;
  transform-origin: 11px 9px;
}
.pixel-cat-svg.level-attention .pixel-cat-body {
  animation: cat-curious-tilt 2.4s ease-in-out infinite;
}
.pixel-cat-svg.level-high .pixel-cat-body {
  animation: cat-alert-stance 1.6s ease-in-out infinite;
}
.pixel-cat-svg.level-critical .pixel-cat-body {
  animation: cat-alert-stance 1.15s ease-in-out infinite;
}

.pixel-cat-magnifier {
  animation: cat-magnifier-scan 1.6s ease-in-out infinite;
  transform-origin: 6px 7px;
}
.pixel-cat-flag {
  animation: cat-flag-wave 0.75s ease-in-out infinite;
  transform-origin: 18px 11px;
}
.pixel-cat-siren-beams {
  animation: cat-siren-flash 0.45s steps(2, end) infinite;
  transform-origin: 11px 1px;
}
.pixel-cat-dangle-legs {
  animation: cat-dangle-legs 0.55s ease-in-out infinite;
  transform-origin: 11px 16px;
}
.pixel-cat-paws-reach {
  animation: cat-paws-reach 0.45s ease-in-out infinite;
}

.pixel-cat-eyes {
  animation: cat-blink 5.2s ease-in-out infinite;
  transform-origin: 11px 7px;
}
.pixel-ear-l {
  animation: cat-ear-left 4.6s ease-in-out infinite;
  transform-origin: 8px 4px;
}
.pixel-ear-r {
  animation: cat-ear-right 5.4s ease-in-out infinite;
  transform-origin: 15px 4px;
}
.pixel-cat-svg.level-attention .pixel-ear-l,
.pixel-cat-svg.level-attention .pixel-ear-r {
  animation-duration: 2.2s;
}
.pixel-cat-svg.level-high .pixel-ear-l,
.pixel-cat-svg.level-high .pixel-ear-r,
.pixel-cat-svg.level-critical .pixel-ear-l,
.pixel-cat-svg.level-critical .pixel-ear-r {
  animation-duration: 1.3s;
}
.pixel-cat-tail {
  animation: cat-tail-sway 2.5s ease-in-out infinite;
  transform-origin: 16px 14px;
}
.pixel-cat-svg.level-attention .pixel-cat-tail {
  animation-duration: 1.6s;
}
.pixel-cat-svg.level-high .pixel-cat-tail {
  animation-duration: 0.95s;
}
.pixel-cat-svg.level-critical .pixel-cat-tail,
.pixel-cat-svg.pose-pounce .pixel-cat-tail {
  animation-duration: 0.55s;
}
.pixel-cat-shield {
  animation: shield-hug-breathe 2.6s ease-in-out infinite;
  transform-origin: 11px 13px;
}
.pixel-cat-svg.level-attention .pixel-cat-shield {
  animation: shield-hug-guard 2.0s ease-in-out infinite;
}
.pixel-cat-svg.level-high .pixel-cat-shield {
  animation: shield-hug-guard 1.35s ease-in-out infinite;
}
.pixel-cat-svg.level-critical .pixel-cat-shield {
  animation: shield-hug-guard 0.95s ease-in-out infinite;
}
.pixel-cat-badge {
  animation: cat-badge-bob 1.2s ease-in-out infinite;
  transform-origin: 21px 3px;
}
.pixel-cat-svg.level-critical .pixel-cat-badge {
  animation-duration: 0.7s;
}

.spotlight-box {
  position: fixed;
  pointer-events: none;
  border: 2.5px solid #2563eb;
  border-radius: 14px;
  background: rgba(37, 99, 235, 0.04);
  animation: spotlight-pulse 1.6s ease-in-out infinite;
  transition: top 160ms ease, left 160ms ease, width 160ms ease, height 160ms ease, opacity 160ms ease;
  z-index: 2147483638;
  display: none;
}
.spotlight-tag {
  position: absolute;
  top: -28px;
  left: 8px;
  background: #1d4ed8;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 99px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(29, 78, 216, 0.35);
}

/* Vị trí mặc định khi mới mở Facebook: Góc trên bên phải màn hình */
.widget-pos {
  position: fixed;
  top: 62px;
  right: 18px;
  pointer-events: auto;
  z-index: 2147483640;
  touch-action: none;
  user-select: none;
}
.widget-pos.docked-transition {
  transition: left 180ms cubic-bezier(0.22, 1, 0.36, 1), top 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.drag-handle {
  cursor: grab;
}
.drag-handle:active {
  cursor: grabbing;
}

/* Chế độ Mèo Đen Pixel Cầm Khiên (khi thu gọn hoặc bám trên đỉnh khung chat) */
.cat-perch-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 328px;
  animation: pop-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.cat-perch-container.compact-orb {
  width: auto;
}

/* Bong bóng gợi ý trên đầu mèo */
.cat-bubble {
  position: relative;
  width: 100%;
  background: #ffffff;
  border: 2px solid #cbd5e1;
  border-radius: 16px;
  padding: 9px 11px;
  box-shadow: 0 14px 28px -6px rgba(15, 23, 42, 0.22), 0 4px 10px -2px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
}
.cat-bubble::after {
  content: '';
  position: absolute;
  bottom: -9px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 14px;
  height: 14px;
  background: inherit;
  border-right: 2px solid inherit;
  border-bottom: 2px solid inherit;
}
.cat-bubble.low { border-color: #86efac; background: #ffffff; }
.cat-bubble.low::after { border-color: #86efac; background: #ffffff; }
.cat-bubble.attention { border-color: #93c5fd; background: #ffffff; }
.cat-bubble.attention::after { border-color: #93c5fd; background: #ffffff; }
.cat-bubble.high { border-color: #fdba74; background: #fffaf5; }
.cat-bubble.high::after { border-color: #fdba74; background: #fffaf5; }
.cat-bubble.critical { border-color: #fca5a5; background: #fef2f2; }
.cat-bubble.critical::after { border-color: #fca5a5; background: #fef2f2; }

.bubble-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.bubble-thread-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.bubble-thread-name {
  font-weight: 800;
  font-size: 12px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}
.level-pill {
  padding: 2.5px 9px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
  letter-spacing: 0.01em;
  flex-shrink: 0;
}
.level-pill.low { background: #dcfce7; color: #15803d; }
.level-pill.attention { background: #dbeafe; color: #1d4ed8; }
.level-pill.high { background: #ffedd5; color: #c2410c; }
.level-pill.critical { background: #fee2e2; color: #b91c1c; }

.bubble-hint-box {
  font-size: 11.5px;
  color: #1e293b;
  line-height: 1.4;
  background: rgba(241, 245, 249, 0.75);
  border-radius: 10px;
  padding: 6px 9px;
  border-left: 3px solid #64748b;
}
.cat-bubble.low .bubble-hint-box { border-left-color: #16a34a; }
.cat-bubble.attention .bubble-hint-box { border-left-color: #2563eb; background: #eff6ff; }
.cat-bubble.high .bubble-hint-box { border-left-color: #ea580c; background: #ffedd5; }
.cat-bubble.critical .bubble-hint-box { border-left-color: #dc2626; background: #fee2e2; color: #7f1d1d; }

.bubble-question-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed rgba(148, 163, 184, 0.4);
  font-size: 11px;
  color: #0f172a;
}

.bubble-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding-top: 2px;
}
.bubble-actions-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Sân khấu chú mèo Pixel bám mép khung chat */
.cat-stage-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: transparent;
  border: 0;
  padding: 0 8px;
  cursor: grab;
  transition: transform 180ms ease;
}
.cat-stage-btn:hover {
  transform: translateY(-2px) scale(1.04);
}
.cat-stage-btn:active {
  cursor: grabbing;
}
.cat-shield-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 99px;
  font-size: 11.5px;
  font-weight: 800;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);
  border: 1.5px solid #ffffff;
}
.cat-shield-tag.low { background: #16a34a; color: #ffffff; }
.cat-shield-tag.attention { background: #2563eb; color: #ffffff; }
.cat-shield-tag.high { background: #ea580c; color: #ffffff; }
.cat-shield-tag.critical { background: #dc2626; color: #ffffff; }

/* Khung chính khi mở rộng */
.wrap {
  width: 348px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: pop-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* Màn hình 1: Thẻ Mở lên & Quét dò Popup */
.launcher {
  background: #ffffff;
  border: 1px solid #dbeafe;
  border-radius: 18px;
  padding: 13px 14px;
  box-shadow: 0 18px 38px -8px rgba(29, 78, 216, 0.2), 0 4px 12px -2px rgba(22, 30, 46, 0.07);
}
.launcher-drag-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px dashed #e2e8f0;
  font-size: 11px;
  color: #64748b;
}
.launcher-hero {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.brand-title {
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
}
.sub { font-size: 11.5px; color: #475569; margin: 3px 0 0; line-height: 1.35; }

.btn-scan {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #ffffff;
  border: 0;
  border-radius: 10px;
  padding: 9px 14px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 16px -3px rgba(37, 99, 235, 0.45);
  transition: transform 150ms ease, opacity 150ms ease;
}
.btn-scan:hover:not(:disabled) { transform: translateY(-1px); }
.btn-scan:disabled { opacity: 0.6; cursor: wait; }

.scan-results {
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.scan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 700;
  color: #334155;
}
.thread-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 165px;
  overflow-y: auto;
}
.thread-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}
.thread-card:hover {
  border-color: #60a5fa;
  background: #eff6ff;
}
.thread-card.selected {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}
.thread-name {
  font-weight: 700;
  font-size: 12.5px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thread-sub {
  font-size: 10.5px;
  color: #64748b;
}
.btn-lock {
  background: #2563eb;
  color: #ffffff;
  border: 0;
  border-radius: 8px;
  padding: 5px 10px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.btn-lock:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}
.consent-label {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  cursor: pointer;
  font-size: 11.5px;
  color: #475569;
  padding-top: 4px;
  border-top: 1px solid #e2e8f0;
}

.btn-detail {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  border-radius: 7px;
  padding: 4px 8px;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 150ms ease;
}
.btn-detail:hover {
  background: #dbeafe;
}
.waiting-switch-box {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-top: 5px;
  border-top: 1px dashed #cbd5e1;
}

.text-btn {
  height: 24px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid #e1e7f0;
  background: #f8fafc;
  color: #475569;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.text-btn:hover { background: #e2e8f0; color: #0f172a; }
.text-btn.pin-active { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }

.dot { width: 7px; height: 7px; border-radius: 50%; background: #16a34a; animation: pulse-dot 2s infinite; flex-shrink: 0; }
.dot.paused { background: #d97706; animation: none; }

/* Màn hình 3: Bảng Chi Tiết & Đánh Giá (Expanded Detail Modal - 2 dòng header không bao giờ đè chữ) */
.live-card {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 18px;
  padding: 12px 13px;
  box-shadow: 0 20px 44px -10px rgba(15, 23, 42, 0.24), 0 4px 14px -2px rgba(15, 23, 42, 0.08);
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-height: 82vh;
  overflow-y: auto;
}
.live-head {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e1e7f0;
}
.live-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.live-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 800;
  font-size: 14px;
  min-width: 0;
  flex: 1;
}
.live-thread-name {
  font-weight: 600;
  font-size: 12px;
  color: #475569;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 145px;
}
.win-btns {
  display: flex;
  gap: 5px;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
}

/* Thanh Tab trong bảng chi tiết */
.detail-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  background: #f1f5f9;
  padding: 3.5px;
  border-radius: 10px;
}
.tab-btn {
  border: 0;
  background: transparent;
  color: #475569;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  padding: 5.5px 6px;
  border-radius: 7px;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}
.tab-btn.active {
  background: #ffffff;
  color: #1d4ed8;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.dash-2col {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 8px;
}
.sub-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 9px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.level-status-sub {
  font-size: 10.5px;
  color: #64748b;
  margin-top: 2px;
  line-height: 1.3;
}

.tiers-list { align-items: stretch; justify-content: space-between; gap: 4px; }
.tier-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4.5px 8px;
  border-radius: 99px;
  font-size: 11px;
  color: #475569;
}
.tier-item.active { font-weight: 800; color: #0f172a; }
.tier-item.critical.active { background: #fee2e2; color: #b91c1c; }
.tier-item.high.active { background: #ffedd5; color: #c2410c; }
.tier-item.attention.active { background: #dbeafe; color: #1d4ed8; }
.tier-item.low.active { background: #dcfce7; color: #15803d; }
.tdot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.tdot.critical { background: #dc2626; }
.tdot.high { background: #f59e0b; }
.tdot.attention { background: #3b82f6; }
.tdot.low { background: #16a34a; }
.segs { display: inline-flex; gap: 2.5px; }
.seg { width: 5px; height: 11px; border-radius: 3px; background: #dfe5ef; }
.seg.on.critical { background: #dc2626; }
.seg.on.high { background: #f59e0b; }
.seg.on.attention { background: #3b82f6; }
.seg.on.low { background: #16a34a; }

.reason-strip {
  font-size: 11.5px;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 7px 10px;
}

.safety-alert {
  background: #fef2f2;
  border: 1.5px solid #fca5a5;
  border-radius: 10px;
  padding: 9px 11px;
  color: #991b1b;
  font-size: 11.5px;
}
.safety-alert h4 { margin: 0 0 4px; font-size: 12.5px; color: #dc2626; }
.safety-alert ul { margin: 4px 0 0; padding-left: 16px; }

.advice-box {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 11px;
  padding: 9px 11px;
}
.advice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  color: #1d4ed8;
  font-size: 12px;
  cursor: pointer;
}
.advice-list { margin: 5px 0 0; padding-left: 16px; font-size: 11.5px; color: #1e293b; }
.advice-list li { margin: 2.5px 0; }
.q-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  background: #ffffff;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  padding: 5px 8px;
  margin-top: 5px;
  font-size: 11px;
}
.btn-copy {
  border: 0;
  background: #dbeafe;
  color: #1d4ed8;
  border-radius: 6px;
  padding: 3px 7px;
  font: inherit;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.quota-box {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 11px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.quota-title { font-size: 11.5px; font-weight: 700; color: #ea580c; }
.quota-sub { font-size: 10.5px; color: #64748b; line-height: 1.3; margin-top: 1px; }
.btn-orange {
  background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%);
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

/* Tab Đánh giá tín hiệu & Bằng chứng */
.sig-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 310px;
  overflow-y: auto;
  padding-right: 2px;
}
.sig-item {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-left: 3.5px solid #3b82f6;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 11.5px;
}
.sig-item.high { border-left-color: #f59e0b; }
.sig-item.critical { border-left-color: #dc2626; }
.sig-item.dim { opacity: 0.55; }
.sig-title {
  font-weight: 700;
  color: #0f172a;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.sig-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 99px;
  background: #e2e8f0;
  color: #334155;
}
.sig-quote {
  margin: 5px 0;
  padding: 4px 8px;
  border-left: 2px solid #cbd5e1;
  background: #ffffff;
  border-radius: 4px;
  font-size: 11px;
  color: #334155;
}
.mark-bar {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.mark-btn {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  border-radius: 6px;
  padding: 3px 7px;
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.mark-btn.active {
  background: #1d4ed8;
  color: #ffffff;
  border-color: #1d4ed8;
}

/* Tab Phân tích & Tiến trình */
.stage-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stage-pill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  font-size: 11px;
  color: #64748b;
}
.stage-pill.on {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e293b;
}
.stage-pill.current {
  background: #dbeafe;
  border-color: #3b82f6;
  font-weight: 700;
  color: #1d4ed8;
}
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.mini-table th, .mini-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
}
.mini-table td.num, .mini-table th.num { text-align: right; }
`;

function px(x: number, y: number, w: number, hgt: number, fill: string): SVGElement {
  return svg('rect', { x, y, width: w, height: hgt, fill });
}

type CatPose = 'idle' | 'dragging' | 'pounce' | 'landing' | 'sleeping' | 'waking';

/**
 * Vẽ chú Mèo Tuxedo (Đen - Trắng) Pixel Art ÔM KHIÊN LỚN trước ngực, với:
 * - 4 HÀNH ĐỘNG & ĐẠO CỤ KHÁC BIỆT HOÀN TOÀN theo 4 mức độ khi ở trạng thái canh gác (pose === 'idle'):
 *   1. low (Bình thường): Mèo ngồi lim dim thư giãn (mắt híp vui vẻ ^ ^), hai tay đi tất trắng ôm khiên xanh lá (✓).
 *   2. attention (Cần chú ý): Mèo Thám Tử tay trái cầm KÍNH LÚP PIXEL đưa lên mắt soi qua lại (?), tay phải giữ khiên xanh dương.
 *   3. high (Cao): Mèo đứng dậy tay phải cầm CỜ HIỆU CẢNH BÁO CAM (!) vẫy liên hồi, tay trái giữ khiên cam.
 *   4. critical (Nguy hiểm): Mèo XÙ LÔNG chiến đấu, nhe nanh, đỉnh đầu bật ĐÈN CÒI BÁO ĐỘNG ĐỎ nhấp nháy tia sáng, 2 tay ghì khiên chắn đỏ khổng lồ (!!).
 * - 3 TƯ THẾ KÉO - THẢ VÀO KHUNG CHAT:
 *   + dragging: Mèo đang được nhấc lơ lửng, mắt tròn xoe, 2 chân sau đi tất trắng buông thõng đung đưa trong không trung.
 *   + pounce: Khi kéo rê trúng khung chat — mèo vươn 2 bàn tay trắng ra trước chuẩn bị vồ/bám, mắt sáng rực khóa mục tiêu.
 *   + landing: Khi vừa thả xuống khung chat — mèo nhún chân đáp xuống bám chặt lên đỉnh khung chat.
 * - TƯ THẾ NGỦ & THỨC DẬY (sau 2 phút không sử dụng ở chế độ thu gọn):
 *   + sleeping: Mèo cuộn tròn tựa đầu lên khiên ngủ ngon lành (mắt nhắm - -, nhịp thở chậm + chữ Zzz pixel bay lên).
 *   + waking: Mèo giật mình tỉnh dậy, mở tròn mắt và vươn vai khi người dùng chạm chuột hoặc nắm kéo.
 */
function pixelCatShieldSvg(
  level: RiskLevel,
  width = 98,
  height = 72,
  isBurst = false,
  pose: CatPose = 'idle',
): SVGElement {
  const BK = '#090a0f';
  const DK = '#1e222d';
  const LT = '#343946';
  const PK = '#f9a8ba';
  const NS = '#fb7185';
  const WT = '#ffffff';
  const WS = '#dbe4f0';
  const pal = SHIELD_PIXEL_PALETTE[level];

  if (pose === 'sleeping') {
    const sleepShieldGroup = svg(
      'g',
      {},
      // Viền đen chiếc khiên đặt nghiêng bên trái làm gối tựa (x=2..11, y=9..17)
      px(3, 9, 8, 1, BK),
      px(2, 10, 1, 5, BK),
      px(11, 10, 1, 5, BK),
      px(3, 15, 1, 1, BK),
      px(10, 15, 1, 1, BK),
      px(4, 16, 2, 1, BK),
      px(8, 16, 2, 1, BK),
      px(6, 17, 2, 1, BK),
      // Nền khiên
      px(3, 10, 8, 5, pal.main),
      px(4, 15, 6, 1, pal.main),
      px(6, 16, 2, 1, pal.main),
      px(3, 10, 4, 1, pal.light),
      px(3, 11, 1, 3, pal.light),
      px(10, 11, 1, 4, pal.dark),
      px(8, 15, 2, 1, pal.dark),
      // Dấu ✓ trắng trên khiên
      px(5, 13, 1, 1, WT),
      px(6, 14, 1, 1, WT),
      px(7, 13, 1, 1, WT),
      px(8, 12, 1, 1, WT),
      px(9, 11, 1, 1, WT),
    );

    const sleepCatBody = svg(
      'g',
      { class: 'pixel-cat-sleep-body' },
      // Lưng mèo Tuxedo cuộn tròn ấm áp bên phải (x=13..22, y=8..16)
      px(14, 8, 6, 1, BK),
      px(20, 9, 2, 1, BK),
      px(22, 10, 1, 5, BK),
      px(13, 16, 9, 1, BK),
      px(14, 9, 6, 7, DK),
      px(20, 10, 2, 6, DK),
      px(15, 9, 4, 1, LT),
      px(19, 10, 2, 2, LT),
      // Tai trái & tai phải cụp nhẹ thư giãn (y=4..6)
      px(6, 4, 3, 1, BK),
      px(5, 5, 1, 2, BK),
      px(9, 5, 1, 1, BK),
      px(6, 5, 2, 1, PK),
      px(8, 5, 1, 1, LT),
      px(14, 4, 3, 1, BK),
      px(13, 5, 1, 1, BK),
      px(17, 5, 1, 2, BK),
      px(15, 5, 2, 1, PK),
      px(14, 5, 1, 1, LT),
      // Đầu mèo Tuxedo tựa lên khiên (x=5..17, y=5..13)
      px(9, 5, 5, 1, BK),
      px(5, 6, 1, 6, BK),
      px(17, 6, 1, 5, BK),
      px(6, 6, 11, 6, DK),
      px(15, 6, 2, 3, LT),
      // Mặt nạ trắng Tuxedo ở mũi, má và ngực
      px(10, 8, 2, 1, WT),
      px(9, 9, 4, 1, WT),
      px(8, 10, 6, 2, WT),
      px(7, 12, 8, 2, WT),
      // Đôi mắt nhắm nghiền bình yên (- -) + hai má hồng
      px(7, 9, 2, 1, BK),
      px(13, 9, 2, 1, BK),
      px(6, 10, 1, 1, PK),
      px(15, 10, 1, 1, PK),
      // Mũi hồng nhỏ xinh
      px(10, 10, 2, 1, NS),
      px(10, 11, 2, 1, WS),
      // Râu hai bên má
      px(3, 9, 2, 1, BK),
      px(3, 11, 2, 1, BK),
      px(18, 9, 2, 1, BK),
      px(18, 11, 2, 1, BK),
      // Hai bàn tay đi tất trắng đặt gọn dưới cằm / ôm mép khiên
      px(6, 13, 3, 2, WT),
      px(5, 13, 1, 2, BK),
      px(6, 15, 3, 1, BK),
      px(11, 13, 3, 2, WT),
      px(14, 13, 1, 2, BK),
      px(11, 15, 3, 1, BK),
      // Chiếc đuôi đen có chóp đuôi trắng quấn gọn quanh thân trước
      px(15, 14, 7, 1, BK),
      px(22, 15, 2, 2, BK),
      px(15, 17, 8, 1, BK),
      px(18, 15, 4, 2, DK),
      px(15, 15, 3, 2, WT),
      px(14, 15, 1, 2, BK),
    );

    // Chữ Zzz pixel bay lơ lửng trên đầu mèo
    const zzzSmall = svg(
      'g',
      { class: 'pixel-cat-zzz-1' },
      px(16, 3, 3, 1, '#2563eb'),
      px(17, 4, 1, 1, '#60a5fa'),
      px(16, 5, 3, 1, '#2563eb'),
    );
    const zzzLarge = svg(
      'g',
      { class: 'pixel-cat-zzz-2' },
      px(20, 0, 4, 1, '#1d4ed8'),
      px(22, 1, 1, 1, '#3b82f6'),
      px(21, 2, 1, 1, '#3b82f6'),
      px(20, 3, 4, 1, '#1d4ed8'),
    );

    return svg(
      'svg',
      {
        viewBox: '0 0 26 19',
        width,
        height,
        class: `pixel-cat-svg level-${level} pose-sleeping`,
        'shape-rendering': 'crispEdges',
        'aria-hidden': 'true',
      },
      svg('ellipse', {
        cx: 13,
        cy: 17.5,
        rx: 10.6,
        ry: 1.35,
        fill: 'rgba(15, 23, 42, 0.18)',
      }),
      sleepShieldGroup,
      sleepCatBody,
      zzzSmall,
      zzzLarge,
    );
  }

  // Đuôi mèo Tuxedo pixel bậc thang bên phải (có chóp đuôi trắng; xù gai nếu ở mức critical)
  const tailGroup = svg(
    'g',
    { class: 'pixel-cat-tail' },
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
    // Gai lông đuôi xù dựng đứng khi ở mức Nguy hiểm (critical)
    ...(level === 'critical' && pose === 'idle'
      ? [px(18, 8, 1, 1, BK), px(21, 7, 1, 1, BK), px(23, 8, 1, 1, BK), px(23, 11, 1, 1, BK)]
      : []),
  );

  // Tai trái pixel (hình chữ L màu hồng bên trong)
  const leftEarGroup = svg(
    'g',
    { class: 'pixel-ear-l' },
    px(6, 2, 3, 1, BK),
    px(5, 3, 1, 2, BK),
    px(9, 3, 1, 2, BK),
    px(6, 3, 1, 2, PK),
    px(7, 4, 1, 1, PK),
    px(7, 3, 2, 1, LT),
    px(8, 4, 1, 1, DK),
  );

  // Tai phải pixel (hình chữ L màu hồng đối xứng)
  const rightEarGroup = svg(
    'g',
    { class: 'pixel-ear-r' },
    px(14, 2, 3, 1, BK),
    px(13, 3, 1, 2, BK),
    px(17, 3, 1, 2, BK),
    px(16, 3, 1, 2, PK),
    px(15, 4, 1, 1, PK),
    px(14, 3, 2, 1, LT),
    px(14, 4, 1, 1, DK),
  );

  // Biểu cảm mắt & lông mày theo tư thế kéo-thả/thức dậy hoặc theo 4 mức độ
  let eyesAndBrows: SVGElement;
  if (pose === 'dragging' || pose === 'waking') {
    // Đang được nhấc kéo lơ lửng hoặc vừa giật mình tỉnh dậy: mắt tròn xoe long lanh
    eyesAndBrows = svg(
      'g',
      { class: 'pixel-cat-eyes' },
      px(7, 6, 2, 2, '#f59e0b'),
      px(7, 6, 1, 1, WT),
      px(8, 7, 1, 1, BK),
      px(13, 6, 2, 2, '#f59e0b'),
      px(13, 6, 1, 1, WT),
      px(14, 7, 1, 1, BK),
    );
  } else if (pose === 'pounce') {
    // Rê trúng khung chat: mắt sáng xanh-vàng khóa mục tiêu
    eyesAndBrows = svg(
      'g',
      { class: 'pixel-cat-eyes' },
      px(7, 5, 2, 1, BK),
      px(13, 5, 2, 1, BK),
      px(8, 6, 1, 1, '#38bdf8'),
      px(8, 7, 1, 1, '#fef08a'),
      px(13, 6, 1, 1, '#38bdf8'),
      px(13, 7, 1, 1, '#fef08a'),
    );
  } else if (level === 'low') {
    // Mức 1 (Bình thường): mắt híp cong vui vẻ thư giãn (^ ^)
    eyesAndBrows = svg(
      'g',
      { class: 'pixel-cat-eyes' },
      px(7, 7, 1, 1, '#f59e0b'),
      px(8, 6, 2, 1, '#f59e0b'),
      px(9, 7, 1, 1, BK),
      px(13, 7, 1, 1, BK),
      px(13, 6, 2, 1, '#f59e0b'),
      px(15, 7, 1, 1, '#f59e0b'),
    );
  } else if (level === 'attention') {
    // Mức 2 (Cần chú ý - Soi kính lúp): mắt phải nheo dò xét, mắt trái mở to trong kính lúp
    eyesAndBrows = svg(
      'g',
      { class: 'pixel-cat-eyes' },
      px(13, 5, 2, 1, BK),
      px(13, 6, 1, 1, '#38bdf8'),
      px(13, 7, 1, 1, BK),
    );
  } else if (level === 'high') {
    // Mức 3 (Cao - Phất cờ hiệu cam): mày xếch nghiêm nghị + mắt cam rực
    eyesAndBrows = svg(
      'g',
      { class: 'pixel-cat-eyes' },
      px(7, 5, 2, 1, BK),
      px(9, 6, 1, 1, BK),
      px(13, 5, 2, 1, BK),
      px(12, 6, 1, 1, BK),
      px(8, 6, 1, 1, '#fb923c'),
      px(8, 7, 1, 1, BK),
      px(13, 6, 1, 1, '#fb923c'),
      px(13, 7, 1, 1, BK),
    );
  } else {
    // Mức 4 (Nguy hiểm - Xù lông + Còi báo động đỏ): mày chữ V rực lửa + mắt sáng vàng-đỏ
    eyesAndBrows = svg(
      'g',
      { class: 'pixel-cat-eyes' },
      px(7, 5, 2, 1, '#fca5a5'),
      px(9, 6, 1, 1, BK),
      px(13, 5, 2, 1, '#fca5a5'),
      px(12, 6, 1, 1, BK),
      px(8, 6, 1, 1, '#fef08a'),
      px(8, 7, 1, 1, '#ef4444'),
      px(13, 6, 1, 1, '#fef08a'),
      px(13, 7, 1, 1, '#ef4444'),
    );
  }

  // Hai chân sau của mèo: nếu đang bị nhấc kéo (dragging) thì buông thõng đung đưa, còn lại bám dưới đáy khiên
  const hindFeetGroup =
    pose === 'dragging'
      ? svg(
          'g',
          { class: 'pixel-cat-dangle-legs' },
          px(7, 16, 2, 2, WT),
          px(7, 18, 2, 1, BK),
          px(14, 16, 2, 2, WT),
          px(14, 18, 2, 1, BK),
        )
      : svg(
          'g',
          {},
          px(6, 16, 2, 1, WT),
          px(6, 17, 2, 1, BK),
          px(15, 16, 2, 1, WT),
          px(15, 17, 2, 1, BK),
        );

  // Đầu mèo Tuxedo nhô lên phía trên đỉnh khiên (kèm lông xù & nanh trắng nếu ở mức critical)
  const bodyGroup = svg(
    'g',
    { class: 'pixel-cat-body' },
    leftEarGroup,
    rightEarGroup,
    px(10, 4, 3, 1, BK),
    px(5, 5, 1, 5, BK),
    px(17, 5, 1, 5, BK),
    px(6, 5, 11, 5, DK),
    px(16, 5, 1, 4, LT),
    // Gai lông xù dựng đứng hai bên má & vai khi ở mức Nguy hiểm (critical)
    ...(level === 'critical' && pose === 'idle'
      ? [
          px(4, 5, 1, 1, BK),
          px(3, 6, 2, 1, DK),
          px(4, 8, 1, 1, BK),
          px(18, 5, 1, 1, BK),
          px(18, 6, 2, 1, DK),
          px(18, 8, 1, 1, BK),
        ]
      : []),
    // Mặt nạ trắng Tuxedo hình chữ V ngược giữa sống mũi & hai má
    px(10, 6, 2, 1, WT),
    px(9, 7, 4, 1, WT),
    px(8, 8, 6, 2, WT),
    px(7, 9, 8, 1, WT),
    // Mũi hồng & miệng theo mức cảnh báo (critical: miệng gầm + 2 răng nanh trắng)
    px(10, 7, 2, 1, NS),
    ...(level === 'critical' && pose === 'idle'
      ? [px(9, 8, 4, 1, '#dc2626'), px(9, 8, 1, 1, WT), px(12, 8, 1, 1, WT)]
      : [px(10, 8, 2, 1, level === 'high' ? '#ea580c' : WS)]),
    // Hai cặp râu ngang 2 bên má
    px(3, 7, 2, 1, BK),
    px(3, 9, 2, 1, BK),
    px(18, 7, 2, 1, BK),
    px(18, 9, 2, 1, BK),
    eyesAndBrows,
    hindFeetGroup,
  );

  // Biểu tượng ở tâm chiếc khiên lớn theo 4 mức độ
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
    shieldEmblem = svg(
      'g',
      {},
      px(9, 11, 2, 3, '#fef08a'),
      px(9, 15, 2, 1, WT),
      px(12, 11, 2, 3, '#fef08a'),
      px(12, 15, 2, 1, WT),
    );
  }

  // Hai bàn tay mèo + Đạo cụ riêng biệt theo từng mức độ hoặc tư thế kéo-thả
  let pawsAndPropsGroup: SVGElement;
  if (pose === 'pounce') {
    // Khi rê trúng khung chat: hai bàn tay trắng vươn rộng hướng xuống chuẩn bị vồ/bám mép chat!
    pawsAndPropsGroup = svg(
      'g',
      { class: 'pixel-cat-paws-reach' },
      // Tay trái vươn xuống
      px(4, 11, 1, 4, BK),
      px(5, 11, 2, 3, WT),
      px(5, 14, 3, 1, WT),
      px(5, 15, 3, 1, BK),
      // Tay phải vươn xuống
      px(18, 11, 1, 4, BK),
      px(16, 11, 2, 3, WT),
      px(15, 14, 3, 1, WT),
      px(15, 15, 3, 1, BK),
    );
  } else if (pose === 'idle' && level === 'attention') {
    // MỨC 2 (Cần chú ý): Tay trái cầm KÍNH LÚP PIXEL đưa lên mắt soi qua lại, tay phải ôm khiên!
    pawsAndPropsGroup = svg(
      'g',
      {},
      // Tay phải đi tất trắng giữ mép phải khiên
      px(17, 10, 1, 4, BK),
      px(16, 10, 1, 1, DK),
      px(15, 11, 2, 2, WT),
      px(14, 12, 1, 1, WT),
      px(16, 12, 1, 1, WS),
      px(14, 11, 1, 1, BK),
      px(14, 13, 3, 1, BK),
      // Tay trái + KÍNH LÚP PIXEL chuyển động soi xét (.pixel-cat-magnifier)
      svg(
        'g',
        { class: 'pixel-cat-magnifier' },
        // Bàn tay trái trắng cầm cán kính lúp
        px(3, 9, 3, 2, WT),
        px(2, 9, 1, 2, BK),
        px(3, 11, 3, 1, BK),
        // Cán kính lúp vàng đồng
        px(4, 8, 2, 1, '#f59e0b'),
        // Vành kính lúp tròn (x=4..9, y=3..8)
        px(5, 3, 4, 1, '#1e3a8a'),
        px(5, 8, 4, 1, '#1e3a8a'),
        px(4, 4, 1, 4, '#1e3a8a'),
        px(9, 4, 1, 4, '#1e3a8a'),
        // Mặt kính xanh sáng trong suốt + con mắt mèo phóng to bên trong kính lúp
        px(5, 4, 4, 4, '#bae6fd'),
        px(5, 4, 2, 1, WT),
        px(5, 5, 1, 1, WT),
        px(7, 5, 2, 2, '#f59e0b'),
        px(7, 6, 1, 1, BK),
      ),
    );
  } else if (pose === 'idle' && level === 'high') {
    // MỨC 3 (Cao): Tay trái giữ khiên cam, tay phải giơ cao CỜ HIỆU CẢNH BÁO CAM (!) vẫy qua lại liên hồi!
    pawsAndPropsGroup = svg(
      'g',
      {},
      // Tay trái đi tất trắng ôm mép trái khiên
      px(5, 10, 1, 4, BK),
      px(6, 10, 1, 1, DK),
      px(6, 11, 2, 2, WT),
      px(8, 12, 1, 1, WT),
      px(6, 12, 1, 1, WS),
      px(8, 11, 1, 1, BK),
      px(6, 13, 3, 1, BK),
      // Tay phải + CỜ HIỆU CẢNH BÁO CAM vẫy liên tục (.pixel-cat-flag)
      svg(
        'g',
        { class: 'pixel-cat-flag' },
        // Bàn tay phải trắng giơ lên nắm cán cờ
        px(16, 9, 3, 2, WT),
        px(16, 8, 3, 1, BK),
        px(16, 11, 3, 1, BK),
        // Cán cờ đứng (x=18, y=1..12)
        px(18, 1, 1, 11, BK),
        px(18, 0, 1, 1, '#fbbf24'),
        // Lá cờ cảnh báo màu cam phần phật (x=19..25, y=1..6)
        px(19, 1, 6, 1, BK),
        px(25, 2, 1, 4, BK),
        px(19, 6, 6, 1, BK),
        px(19, 2, 6, 4, '#ea580c'),
        px(19, 2, 3, 1, '#fb923c'),
        // Dấu chấm than trắng (!) nổi bật trên lá cờ cam
        px(22, 2, 1, 2, WT),
        px(22, 5, 1, 1, WT),
      ),
    );
  } else {
    // MỨC 1 (Bình thường), MỨC 4 (Nguy hiểm) hoặc khi đang kéo (dragging): 2 bàn tay trắng ôm chặt 2 bên mép khiên
    pawsAndPropsGroup = svg(
      'g',
      {},
      // Bàn tay trái đi tất trắng ôm mép trái khiên
      px(5, 10, 1, 4, BK),
      px(6, 10, 1, 1, DK),
      px(6, 11, 2, 2, WT),
      px(8, 12, 1, 1, WT),
      px(6, 12, 1, 1, WS),
      px(8, 11, 1, 1, BK),
      px(6, 13, 3, 1, BK),
      // Bàn tay phải đi tất trắng ôm mép phải khiên
      px(17, 10, 1, 4, BK),
      px(16, 10, 1, 1, DK),
      px(15, 11, 2, 2, WT),
      px(14, 12, 1, 1, WT),
      px(16, 12, 1, 1, WS),
      px(14, 11, 1, 1, BK),
      px(14, 13, 3, 1, BK),
    );
  }

  // Chiếc Khiên Pixel LỚN trước ngực mèo (rộng 11px x cao 9px: x=6..16, y=9..17)
  const shieldAndPawsGroup = svg(
    'g',
    { class: 'pixel-cat-shield' },
    // Hào quang viền sáng đỏ khi ở mức Nguy hiểm (critical)
    ...(level === 'critical' && pose === 'idle'
      ? [px(6, 8, 11, 1, '#fca5a5'), px(5, 9, 1, 6, '#fca5a5'), px(17, 9, 1, 6, '#fca5a5')]
      : []),
    // Viền đen ngoài của chiếc khiên lớn
    px(7, 9, 9, 1, BK),
    px(6, 10, 1, 5, BK),
    px(16, 10, 1, 5, BK),
    px(7, 15, 1, 1, BK),
    px(15, 15, 1, 1, BK),
    px(8, 16, 2, 1, BK),
    px(13, 16, 2, 1, BK),
    px(10, 17, 3, 1, BK),
    // Nền màu chính của khiên theo 4 mức độ
    px(7, 10, 9, 5, pal.main),
    px(8, 15, 7, 1, pal.main),
    px(10, 16, 3, 1, pal.main),
    // Viền sáng pixel góc trái trên & bóng khối góc phải dưới của khiên
    px(7, 10, 4, 1, pal.light),
    px(7, 11, 1, 3, pal.light),
    px(8, 11, 1, 1, pal.light),
    px(15, 11, 1, 4, pal.dark),
    px(13, 15, 2, 1, pal.dark),
    px(11, 16, 2, 1, pal.dark),
    shieldEmblem,
    pawsAndPropsGroup,
  );

  // Ký hiệu / Đèn còi báo động trên đầu mèo
  let overheadBadge: SVGElement | null = null;
  if (pose === 'pounce') {
    // Mũi tên tâm ngắm xanh báo hiệu sẵn sàng bám xuống khung chat
    overheadBadge = svg(
      'g',
      { class: 'pixel-cat-badge' },
      px(11, 0, 1, 3, '#2563eb'),
      px(10, 1, 3, 1, '#60a5fa'),
    );
  } else if (pose === 'idle' && level === 'attention') {
    // Dấu ? xanh dương trên đầu mèo Thám tử
    overheadBadge = svg(
      'g',
      { class: 'pixel-cat-badge' },
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
  } else if (pose === 'idle' && level === 'critical') {
    // MỨC 4 (Nguy hiểm): ĐÈN CÒI BÁO ĐỘNG ĐỎ (Red Siren) gắn ngay trên đỉnh đầu mèo + tia chớp nhấp nháy!
    overheadBadge = svg(
      'g',
      {},
      // Đế đèn & vòm đèn còi báo động đỏ (x=9..13, y=1..4)
      px(9, 3, 5, 1, BK),
      px(10, 1, 3, 1, BK),
      px(9, 2, 1, 1, BK),
      px(13, 2, 1, 1, BK),
      px(10, 2, 3, 1, '#dc2626'),
      px(11, 2, 1, 1, '#fef08a'),
      // Chùm tia sáng còi hú nhấp nháy hai bên (.pixel-cat-siren-beams)
      svg(
        'g',
        { class: 'pixel-cat-siren-beams' },
        px(7, 1, 2, 1, '#ef4444'),
        px(6, 0, 2, 1, '#fef08a'),
        px(14, 1, 2, 1, '#ef4444'),
        px(15, 0, 2, 1, '#fef08a'),
        px(11, 0, 1, 1, '#fef08a'),
      ),
    );
  }

  const children: SVGElement[] = [
    svg('ellipse', {
      cx: 12,
      cy: 17.5,
      rx: pose === 'dragging' ? 6.5 : 9.8,
      ry: pose === 'dragging' ? 0.8 : 1.25,
      fill: pose === 'dragging' ? 'rgba(15, 23, 42, 0.10)' : 'rgba(15, 23, 42, 0.18)',
    }),
    tailGroup,
    bodyGroup,
    shieldAndPawsGroup,
  ];
  if (overheadBadge) children.push(overheadBadge);

  const poseClass = pose !== 'idle' ? ` pose-${pose}` : '';
  return svg(
    'svg',
    {
      viewBox: '0 0 26 19',
      width,
      height,
      class: `pixel-cat-svg level-${level}${isBurst ? ' burst' : ''}${poseClass}`,
      'aria-hidden': 'true',
    },
    ...children,
  );
}

function segCountFor(r: AnalysisResult, rowLevel: RiskLevel): number {
  const cur = RISK_LEVEL_ORDER[r.risk_level];
  const row = RISK_LEVEL_ORDER[rowLevel];
  if (rowLevel === r.risk_level) {
    if (rowLevel === 'critical') return 4;
    if (rowLevel === 'high') return 3;
    if (rowLevel === 'attention') return 2;
    return 1;
  }
  return row < cur ? (rowLevel === 'low' ? 1 : 2) : 0;
}

/** Trạng thái AI ngắn gọn để người dùng biết AI có đang đọc không. */
function aiChip(s: Session): string | null {
  const ai = s.ai;
  if (!ai || ai.status === 'off') return null;
  if (ai.status === 'running') return 'AI đang đọc ngữ cảnh…';
  if (ai.status === 'error') return `AI tạm dừng: ${(ai.error ?? 'lỗi kết nối').split('.')[0]}. Vẫn cảnh báo bằng luật.`;
  if (ai.lastSeq) return `AI đã đọc tới tin ${ai.lastSeq}${ai.lastModel ? ` · ${ai.lastModel}` : ''}`;
  return 'AI đang chờ đủ tin mới';
}

const LINK_LEVEL_TEXT: Record<string, string> = {
  high: 'Rất đáng ngờ',
  medium: 'Đáng ngờ',
  weak: 'Cần xem kỹ',
  none: 'Chưa thấy dấu hiệu',
};

const ASSESSMENT_TEXT: Record<string, string | undefined> = {
  evasive: 'AI: câu trả lời còn né tránh, chung chung.',
  contradictory: 'AI: câu trả lời mâu thuẫn với điều đã nói trước đó.',
};

export function initFloatingWidget(
  probeLocal: () => ProbeResult,
  getThreadRect?: (threadId: string) => DOMRect | null,
) {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('safechat-ai-overlay-host')) return;

  const host = document.createElement('div');
  host.id = 'safechat-ai-overlay-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = WIDGET_CSS;

  const spotlightTag = h('div', { class: 'spotlight-tag' }, '');
  const spotlightEl = h('div', { class: 'spotlight-box' }, spotlightTag);
  const mount = h('div', { class: 'widget-pos' });

  shadow.append(styleEl, spotlightEl, mount);
  document.body.append(host);

  let session: Session | null = null;
  let minimized = true;
  let consent = true;
  // Cách đọc khi bắt đầu quét, dùng chung với cài đặt của side panel.
  let scrollHistory = DEFAULT_SETTINGS.historyScroll;
  // Đã từng đồng ý trong bảng này. Bỏ dấu đồng ý thì lần thả mèo sau phải đọc lại.
  let scanConsented = false;
  // Đọc mã QR trong ảnh, chạy ngay trên máy.
  let readQr = true;
  chrome.storage?.local
    ?.get?.(SETTINGS_KEY)
    ?.then((res) => {
      const stored = res?.[SETTINGS_KEY] as Partial<Settings> | undefined;
      scanConsented = stored?.scanConsent === true;
      if (stored?.qrScan === false) readQr = false;
      const saved = stored?.historyScroll;
      if (typeof saved === 'boolean' && saved !== scrollHistory) {
        scrollHistory = saved;
        renderWidget();
      }
    })
    .catch(() => {});
  let hasScanned = false;
  let isScanning = false;
  let chosenThreadId: string | null = null;
  let scanNotice = '';
  let lastThreadSignature = '';

  let sessionViewMode: SessionViewMode = 'mini';
  let detailTab: DetailTab = 'overview';
  let dockedToChat = true;
  let freePos: { x: number; y: number } | null = null;
  let isDragging = false;
  let suppressClick = false;
  let copyFeedback = '';

  let expandedAdvice = false;
  let spotlightTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRiskLevel: RiskLevel = 'low';
  let levelBurstUntil = 0;
  let burstTimer: ReturnType<typeof setTimeout> | undefined;
  let catPose: CatPose = 'idle';
  let dragHoverThread: ThreadInfo | null = null;
  let landingThreadLabel = '';
  let landingTimer: ReturnType<typeof setTimeout> | undefined;
  const SLEEP_IDLE_MS = 2 * 60 * 1000; // 2 phút (120.000 ms) không tương tác thì mèo nằm ngủ
  let lastActivityAt = Date.now();
  let lastMsgCount = 0;

  function canCatSleep(): boolean {
    if (isDragging) return false;
    if (minimized && !session) return true;
    if (
      session &&
      sessionViewMode === 'mini' &&
      (session.result?.risk_level ?? 'low') === 'low' &&
      session.scan?.state !== 'loading'
    ) {
      return true;
    }
    return false;
  }

  function wakeUpCatIfNeeded() {
    lastActivityAt = Date.now();
    if (catPose === 'sleeping' && !isDragging) {
      clearTimeout(landingTimer);
      catPose = 'waking';
      renderWidget();
      landingTimer = setTimeout(() => {
        if (catPose === 'waking' && !isDragging) {
          catPose = 'idle';
          renderWidget();
        }
      }, 850);
    }
  }

  function checkLevelBurst(lv: RiskLevel): boolean {
    if (lv !== lastRiskLevel) {
      lastRiskLevel = lv;
      if (lv !== 'low') {
        levelBurstUntil = Date.now() + 3100;
        clearTimeout(burstTimer);
        burstTimer = setTimeout(() => {
          renderWidget();
        }, 3150);
      } else {
        levelBurstUntil = 0;
      }
    }
    return Date.now() < levelBurstUntil;
  }

  function sendReq<T = { ok: boolean; reason?: string }>(req: PanelRequest): Promise<T> {
    return chrome.runtime.sendMessage(req) as Promise<T>;
  }

  function showSpotlight(threadId: string, label: string, durationMs = 0, customTag?: string) {
    clearTimeout(spotlightTimer);
    const rect = getThreadRect?.(threadId);
    if (!rect || rect.width < 20 || rect.height < 20) {
      spotlightEl.style.display = 'none';
      return;
    }
    spotlightTag.textContent = customTag ?? `Khung chat: ${label}`;
    spotlightEl.style.display = 'block';
    spotlightEl.style.left = `${Math.max(2, rect.left - 4)}px`;
    spotlightEl.style.top = `${Math.max(2, rect.top - 4)}px`;
    spotlightEl.style.width = `${rect.width + 8}px`;
    spotlightEl.style.height = `${rect.height + 8}px`;
    if (durationMs > 0) {
      spotlightTimer = setTimeout(() => {
        spotlightEl.style.display = 'none';
      }, durationMs);
    }
  }

  function hideSpotlight() {
    clearTimeout(spotlightTimer);
    spotlightEl.style.display = 'none';
  }

  function findThreadUnderDrag(
    clientX: number,
    clientY: number,
    boxLeft: number,
    boxTop: number,
    boxW: number,
    boxH: number,
    candidates: ThreadInfo[],
  ): ThreadInfo | null {
    if (!getThreadRect || candidates.length === 0) return null;
    const pawX = boxLeft + boxW / 2;
    const pawY = boxTop + boxH - 10;
    const centerX = boxLeft + boxW / 2;
    const centerY = boxTop + boxH * 0.62;

    let best: ThreadInfo | null = null;
    let bestDist = Infinity;

    for (const t of candidates) {
      const rect = getThreadRect(t.threadId);
      if (!rect || rect.width < 40 || rect.height < 40) continue;
      const left = rect.left - 24;
      const right = rect.right + 24;
      const top = rect.top - 72;
      const bottom = rect.bottom + 16;

      const pointerIn = clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
      const pawIn = pawX >= left && pawX <= right && pawY >= top && pawY <= bottom;
      const centerIn = centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;

      if (pointerIn || pawIn || centerIn) {
        const rcx = rect.left + rect.width / 2;
        const rcy = rect.top + Math.min(80, rect.height / 3);
        const dist = Math.hypot(clientX - rcx, clientY - rcy);
        if (dist < bestDist) {
          bestDist = dist;
          best = t;
        }
      }
    }
    return best;
  }

  function clampCoords(x: number, y: number, w: number, hgt: number) {
    const maxX = Math.max(8, window.innerWidth - w - 8);
    const maxY = Math.max(8, window.innerHeight - hgt - 8);
    return {
      x: Math.max(8, Math.min(maxX, x)),
      y: Math.max(8, Math.min(maxY, y)),
    };
  }

  function updateWidgetPosition() {
    if (isDragging) return;
    const rectMount = mount.getBoundingClientRect();
    const w = rectMount.width || (session && sessionViewMode === 'mini' ? 328 : 348);
    const hgt = rectMount.height || (session && sessionViewMode === 'mini' ? 148 : 380);

    const dockThreadId =
      session && !session.waiting ? session.threadId : catPose === 'landing' ? chosenThreadId : null;

    if (dockThreadId && dockedToChat && getThreadRect) {
      const chatRect = getThreadRect(dockThreadId);
      if (chatRect && chatRect.width > 40 && chatRect.height > 40) {
        mount.classList.add('docked-transition');
        if (!session || sessionViewMode === 'mini') {
          const perchEl = mount.querySelector<HTMLElement>('.cat-perch-container');
          const targetW = Math.max(280, Math.min(348, chatRect.width));
          if (perchEl) perchEl.style.width = `${targetW}px`;
          const actualW = perchEl ? targetW : w;
          const idealX = chatRect.left + (chatRect.width - actualW) / 2;
          // Đặt chân mèo bám sát ngay trên mép đỉnh khung chat (chồng nhẹ 6px vào viền trên của khung chat)
          const idealY =
            chatRect.top >= hgt - 6
              ? chatRect.top - hgt + 6
              : Math.max(6, chatRect.top + 4);
          const clamped = clampCoords(idealX, idealY, actualW, hgt);
          mount.style.left = `${clamped.x}px`;
          mount.style.top = `${clamped.y}px`;
          mount.style.right = 'auto';
          mount.style.bottom = 'auto';
          return;
        } else {
          // Khi mở bảng Chi tiết: đặt NGAY BÊN CẠNH khung chat (ưu tiên bên trái khung chat) để không che tin nhắn
          let idealX: number;
          if (chatRect.left >= w + 14) {
            idealX = chatRect.left - w - 12;
          } else if (window.innerWidth - chatRect.right >= w + 14) {
            idealX = chatRect.right + 12;
          } else {
            idealX = Math.max(12, chatRect.left - w * 0.75);
          }
          const idealY = Math.max(62, Math.min(chatRect.bottom - hgt, window.innerHeight - hgt - 12));
          const clamped = clampCoords(idealX, idealY, w, hgt);
          mount.style.left = `${clamped.x}px`;
          mount.style.top = `${clamped.y}px`;
          mount.style.right = 'auto';
          mount.style.bottom = 'auto';
          return;
        }
      }
    }

    mount.classList.remove('docked-transition');
    if (freePos) {
      const clamped = clampCoords(freePos.x, freePos.y, w, hgt);
      mount.style.left = `${clamped.x}px`;
      mount.style.top = `${clamped.y}px`;
      mount.style.right = 'auto';
      mount.style.bottom = 'auto';
    } else {
      // Mặc định khi mới mở Facebook: góc trên bên phải màn hình
      mount.style.top = '62px';
      mount.style.right = '18px';
      mount.style.left = 'auto';
      mount.style.bottom = 'auto';
    }
  }

  mount.addEventListener('pointerenter', () => {
    wakeUpCatIfNeeded();
  });
  mount.addEventListener('pointermove', () => {
    if (!isDragging) {
      wakeUpCatIfNeeded();
    }
  });
  mount.addEventListener(
    'pointerdown',
    () => {
      wakeUpCatIfNeeded();
    },
    true,
  );

  mount.addEventListener(
    'click',
    (e) => {
      lastActivityAt = Date.now();
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick = false;
      }
    },
    true,
  );

  function bindDragHandle(el: HTMLElement) {
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      lastActivityAt = Date.now();
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target !== el &&
        target.closest('button, input, label, a, select') &&
        !el.classList.contains('cat-stage-btn')
      ) {
        return;
      }
      const startX = e.clientX;
      const startY = e.clientY;
      const box = mount.getBoundingClientRect();
      const origLeft = box.left;
      const origTop = box.top;
      let moved = false;
      const wasDocked = dockedToChat;
      const isCatMode = (minimized && !session) || (Boolean(session) && sessionViewMode === 'mini');
      let cachedThreads: ThreadInfo[] = [];

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > 5) {
          moved = true;
          isDragging = true;
          suppressClick = true;
          dockedToChat = false;
          mount.classList.remove('docked-transition');
          if (isCatMode) {
            clearTimeout(landingTimer);
            cachedThreads = probeThreads(probeLocal());
            catPose = 'dragging';
            dragHoverThread = null;
            renderWidget();
          }
        }
        if (moved) {
          const next = clampCoords(origLeft + dx, origTop + dy, box.width, box.height);
          freePos = next;
          mount.style.left = `${next.x}px`;
          mount.style.top = `${next.y}px`;
          mount.style.right = 'auto';
          mount.style.bottom = 'auto';

          if (isCatMode) {
            const hit = findThreadUnderDrag(
              ev.clientX,
              ev.clientY,
              next.x,
              next.y,
              box.width,
              box.height,
              cachedThreads,
            );
            const prevId = dragHoverThread?.threadId ?? null;
            const nextId = hit?.threadId ?? null;
            const nextPose: CatPose = hit ? 'pounce' : 'dragging';
            if (prevId !== nextId || catPose !== nextPose) {
              dragHoverThread = hit;
              catPose = nextPose;
              if (hit) {
                showSpotlight(
                  hit.threadId,
                  hit.threadLabel,
                  0,
                  `Thả mèo vào đây để khóa: ${hit.threadLabel}`,
                );
              } else {
                hideSpotlight();
              }
              renderWidget();
            }
          }
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (moved) {
          isDragging = false;
          if (isCatMode && dragHoverThread) {
            const targetChat = dragHoverThread;
            dragHoverThread = null;
            const action = decideDrop({
              sessionThreadId: session?.threadId ?? null,
              targetThreadId: targetChat.threadId,
              consented: scanConsented,
            });
            const cancelled =
              action === 'confirm_switch' &&
              !window.confirm(
                switchChatPrompt(session!.threadLabel, targetChat.threadLabel, LEVEL_DISPLAY[session!.result?.risk_level ?? 'low']),
              );
            if (cancelled) {
              // Giữ nguyên phiên đang theo dõi.
              catPose = 'idle';
              hideSpotlight();
              renderWidget();
            } else if (action === 'ask_consent') {
              // Chưa đọc gì: mở bảng có lời đồng ý và cách đọc, chọn sẵn chat vừa thả.
              catPose = 'idle';
              hideSpotlight();
              chosenThreadId = targetChat.threadId;
              minimized = false;
              runScan();
            } else {
              catPose = 'landing';
              landingThreadLabel = targetChat.threadLabel;
              chosenThreadId = targetChat.threadId;
              dockedToChat = true;
              minimized = false;
              sessionViewMode = 'mini';
              clearTimeout(landingTimer);
              landingTimer = setTimeout(() => {
                catPose = 'idle';
                renderWidget();
              }, 1050);

              if (action === 'lock') {
                consent = true;
                void lockThread(targetChat);
              } else if (action === 'confirm_switch') {
                // Đã có phiên nghĩa là đã đồng ý trước đó.
                consent = true;
                void (async () => {
                  await sendReq({ kind: 'stop_and_clear' });
                  await lockThread(targetChat);
                })();
              } else {
                showSpotlight(
                  targetChat.threadId,
                  targetChat.threadLabel,
                  950,
                  `Đã bám vào chat: ${targetChat.threadLabel}`,
                );
              }
              renderWidget();
            }
          } else {
            if (isCatMode) {
              catPose = 'idle';
              dragHoverThread = null;
              hideSpotlight();
              renderWidget();
            } else if (wasDocked && session) {
              renderWidget();
            }
          }
          setTimeout(() => {
            suppressClick = false;
          }, 50);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  function downloadSnap(s: Session) {
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
    const url = URL.createObjectURL(new Blob([serializeSnapshot(snap)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `safechat-phien-${stamp}.json` });
    shadow.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function downloadHtmlReport(s: Session) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const html = exportHtml({
      threadLabel: s.threadLabel,
      startedAt: s.startedAt,
      exportedAt: Date.now(),
      messages: s.transcript.messages,
      result: s.result,
      marks: s.marks,
      scope: 'full',
      aiUsed: s.ai.calls > 0,
    });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = h('a', { href: url, download: `safechat-bao-cao-${stamp}.html` });
    shadow.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function runScan() {
    isScanning = true;
    hasScanned = true;
    scanNotice = '';
    renderWidget();
    setTimeout(() => {
      isScanning = false;
      const fresh = probeLocal();
      const list = probeThreads(fresh);
      if (list.length > 0) {
        if (!chosenThreadId || !list.some((t) => t.threadId === chosenThreadId)) {
          chosenThreadId = list[0]!.threadId;
        }
        const chosen = list.find((t) => t.threadId === chosenThreadId) ?? list[0]!;
        showSpotlight(chosen.threadId, chosen.threadLabel, 1400);
      } else {
        chosenThreadId = null;
        hideSpotlight();
      }
      renderWidget();
    }, 320);
  }

  async function lockThread(t: ThreadInfo) {
    if (!consent) return;
    scanNotice = '';
    chosenThreadId = t.threadId;
    dockedToChat = true;
    sessionViewMode = 'mini';
    showSpotlight(t.threadId, t.threadLabel, 900);
    if (!scanConsented) {
      scanConsented = true;
      await sendReq({ kind: 'set_scan_consent', value: true });
    }
    const res = await sendReq({ kind: 'start', tabId: -1, threadId: t.threadId, allowScroll: scrollHistory });
    if (!res?.ok) {
      scanNotice = res?.reason ?? 'Không thể khóa đoạn chat này. Hãy bấm Quét lại.';
      renderWidget();
    }
  }

  async function stopAndScanOthers() {
    await sendReq({ kind: 'stop_and_clear' });
    session = null;
    chosenThreadId = null;
    minimized = false;
    hasScanned = true;
    runScan();
  }

  async function closeToDefaultCat() {
    await sendReq({ kind: 'stop_and_clear' });
    session = null;
    chosenThreadId = null;
    minimized = true;
    hideSpotlight();
    renderWidget();
  }

  function renderOverviewTab(s: Session): Node {
    const r = s.result;
    const lv: RiskLevel = r?.risk_level ?? 'low';

    const tierRows: { level: RiskLevel; label: string }[] = [
      { level: 'critical', label: LEVEL_DISPLAY.critical },
      { level: 'high', label: LEVEL_DISPLAY.high },
      { level: 'attention', label: LEVEL_DISPLAY.attention },
      { level: 'low', label: LEVEL_DISPLAY.low },
    ];

    const usagePct = Math.min(100, Math.round((s.transcript.messages.length / Math.max(1, s.maxMessages)) * 100));
    const actions = r?.advice.actions.slice(0, expandedAdvice ? 5 : 2) ?? [];
    const questions = r?.safety_priority ? [] : (r?.advice.questions.slice(0, expandedAdvice ? 4 : 2) ?? []);

    return h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:8px' },
      h(
        'div',
        { class: 'dash-2col' },
        h(
          'div',
          { class: 'sub-card' },
          pixelCatShieldSvg(lv, 96, 70, checkLevelBurst(lv)),
          h('div', { class: `level-pill ${lv}`, style: 'margin-top:4px' }, LEVEL_DISPLAY[lv]),
          h('div', { class: 'level-status-sub' }, LEVEL_SUBTITLE[lv]),
        ),
        h(
          'div',
          { class: 'sub-card tiers-list' },
          ...tierRows.map(({ level, label }) => {
            const lit = r ? segCountFor(r, level) : level === 'low' ? 1 : 0;
            return h(
              'div',
              { class: `tier-item ${level}${lv === level ? ' active' : ''}` },
              h('span', { style: 'display:inline-flex;align-items:center' }, h('span', { class: `tdot ${level}` }), label),
              h(
                'span',
                { class: 'segs' },
                ...[0, 1, 2, 3].map((i) => h('span', { class: `seg ${level}${i < lit ? ' on' : ''}` })),
              ),
            );
          }),
        ),
      ),
      r &&
        h(
          'div',
          { class: 'reason-strip' },
          h('b', {}, `Mức ${LEVEL_DISPLAY[lv]}: `),
          r.level_reason,
          r.stability_note && h('div', { style: 'color:#b45309;margin-top:3px;font-size:10.5px' }, r.stability_note),
        ),
      r?.safety_priority &&
        r.advice.safety_message &&
        h(
          'div',
          { class: 'safety-alert', role: 'alert' },
          h('h4', {}, 'Ưu tiên an toàn của bạn'),
          h('div', {}, r.advice.safety_message),
          (r.advice.support_resources?.length ?? 0) > 0 &&
            h('ul', {}, ...(r.advice.support_resources ?? []).map((item) => h('li', {}, item))),
        ),
      h(
        'div',
        { class: 'advice-box' },
        h(
          'div',
          {
            class: 'advice-head',
            onclick: () => {
              expandedAdvice = !expandedAdvice;
              renderWidget();
            },
          },
          h('span', {}, 'Gợi ý để làm rõ ý định'),
          h('span', {}, expandedAdvice ? 'Thu gọn' : 'Xem thêm'),
        ),
        h(
          'ul',
          { class: 'advice-list' },
          ...actions.map((act) => h('li', {}, act)),
        ),
        ...questions.map((q) =>
          h(
            'div',
            { class: 'q-row' },
            h('span', {}, `"${q}"`),
            h(
              'button',
              {
                class: 'btn-copy',
                onclick: async () => {
                  await navigator.clipboard?.writeText?.(q).catch(() => {});
                  copyFeedback = q;
                  renderWidget();
                  setTimeout(() => {
                    copyFeedback = '';
                    renderWidget();
                  }, 1500);
                },
              },
              copyFeedback === q ? 'Đã chép' : 'Sao chép',
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'quota-box' },
        h(
          'div',
          {},
          h(
            'div',
            { class: 'quota-title' },
            usagePct >= 80
              ? `Gần đến giới hạn bộ nhớ phiên (${s.transcript.messages.length}/${s.maxMessages} tin)`
              : `Đã đọc ${s.transcript.messages.length}/${s.maxMessages} tin nhắn`,
          ),
          h('div', { class: 'quota-sub' }, 'Lưu bản nháp (.json) hoặc xuất báo cáo (.html) để giữ bằng chứng.'),
        ),
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:4px' },
          h(
            'button',
            {
              class: 'btn-orange',
              onclick: () => downloadSnap(s),
            },
            'Lưu phiên',
          ),
          h(
            'button',
            {
              class: 'mark-btn',
              style: 'text-align:center',
              onclick: () => downloadHtmlReport(s),
            },
            'Báo cáo HTML',
          ),
        ),
      ),
    );
  }

  function renderEvaluateTab(s: Session): Node {
    const sigs = s.result?.signals ?? [];
    const claims = s.result?.claims ?? [];
    return h(
      'div',
      { class: 'sig-list' },
      h(
        'div',
        { style: 'font-size:11px;color:#475569' },
        'Xem các dấu hiệu phát hiện được và tự đánh giá mức độ phù hợp với ngữ cảnh thực tế của bạn:',
      ),
      sigs.length === 0
        ? h(
            'div',
            { class: 'reason-strip', style: 'text-align:center;padding:16px 10px' },
            'Chưa phát hiện tín hiệu rủi ro nào trong phần tin nhắn đã đọc.',
          )
        : null,
      ...sigs.map((sig: Signal) => {
        const key = signalKey(sig);
        const currentMark = s.marks[key];
        return h(
          'div',
          { class: `sig-item ${sig.severity}${currentMark === 'not_relevant' ? ' dim' : ''}` },
          h(
            'div',
            { class: 'sig-title' },
            h('span', {}, sig.title),
            h(
              'span',
              { class: 'sig-tag' },
              `${LEVEL_DISPLAY[sig.severity]} · ${sig.source === 'ai' ? 'AI' : sig.source === 'ledger' ? 'Đối chiếu' : 'Quy tắc'}`,
            ),
          ),
          h('div', { style: 'margin-top:3px;color:#334155' }, sig.explanation),
          ...sig.evidence_quotes.slice(0, 2).map((q, idx) =>
            h(
              'div',
              { class: 'sig-quote' },
              h('b', {}, `${sig.evidence_message_ids[idx] ?? 'Tin'}: `),
              `"${q}"`,
            ),
          ),
          h('div', { style: 'margin-top:4px;font-size:11px;color:#0f172a' }, h('b', {}, 'Nên làm: '), sig.recommended_action),
          h(
            'div',
            { class: 'mark-bar' },
            ...MARKS.map(([m, label]) =>
              h(
                'button',
                {
                  class: `mark-btn${currentMark === m ? ' active' : ''}`,
                  onclick: () => void sendReq({ kind: 'mark', key, mark: currentMark === m ? null : m }),
                },
                label,
              ),
            ),
          ),
        );
      }),
      claims.length > 0 &&
        h(
          'div',
          { class: 'reason-strip', style: 'margin-top:4px' },
          h('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Sổ đối chiếu phát biểu trước - sau:'),
          ...claims.map((c) =>
            h(
              'div',
              { style: 'font-size:11px;margin:3px 0' },
              `• ${c.claim_text} (${c.source_message_id}) — `,
              h(
                'b',
                {},
                {
                  unverified: 'Chưa xác minh',
                  consistent: 'Nhất quán',
                  possible_contradiction: 'Chưa nhất quán',
                  explained: 'Đã đính chính',
                }[c.status],
              ),
            ),
          ),
        ),
    );
  }

  function renderAnalysisTab(s: Session): Node {
    const r = s.result;
    const reached = new Map((r?.stages_reached ?? []).map((x) => [x.stage, x.first_message_id]));
    return h(
      'div',
      { class: 'sig-list' },
      h('div', { style: 'font-weight:700;font-size:12px;color:#0f172a' }, 'Tiến trình kịch bản (S0 → S4)'),
      h(
        'div',
        { class: 'stage-row' },
        ...STAGES.map((st) =>
          h(
            'div',
            { class: `stage-pill${reached.has(st) ? ' on' : ''}${r?.stage === st ? ' current' : ''}` },
            h('span', {}, `${st} · ${STAGE_LABEL[st]}`),
            h('span', { style: 'font-size:10px' }, reached.has(st) ? `từ ${reached.get(st)}` : r?.stage === st ? 'Hiện tại' : '—'),
          ),
        ),
      ),
      r?.open_questions?.length
        ? h(
            'div',
            { style: 'margin-top:6px;padding:6px 8px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:11.5px;color:#7f1d1d' },
            h('div', { style: 'font-weight:700' }, 'Bạn đã hỏi nhưng chưa được trả lời rõ'),
            ...r.open_questions.map((q) => h('div', { style: 'margin-top:2px' }, `• ${q}`)),
            h('div', { style: 'margin-top:3px;font-size:10.5px;color:#991b1b' }, 'Đối phương chỉ trấn an hoặc viện quy trình. Chưa có câu trả lời kiểm chứng được thì đừng làm tiếp.'),
          )
        : null,
      r?.qr?.length
        ? h(
            'div',
            {},
            h('div', { style: 'font-weight:700;font-size:12px;color:#0f172a;margin-top:6px' }, 'Mã QR trong đoạn chat'),
            ...r.qr.map((q) =>
              h(
                'div',
                { style: 'margin-top:4px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11.5px;color:#334155' },
                h('div', { style: 'display:flex;justify-content:space-between;gap:6px' }, h('b', {}, q.label), h('span', { style: 'flex:none;font-weight:700' }, q.level === 'none' ? '' : LINK_LEVEL_TEXT[q.level])),
                ...q.details.map((d) => h('div', { style: 'margin-top:2px;word-break:break-all' }, `${d.label}: ${d.value}`)),
                ...q.reasons.map((reason) => h('div', { style: 'margin-top:2px;font-size:10.5px;color:#64748b' }, reason)),
              ),
            ),
          )
        : null,
      r?.links?.length
        ? h(
            'div',
            {},
            h('div', { style: 'font-weight:700;font-size:12px;color:#0f172a;margin-top:6px' }, 'Link trong đoạn chat'),
            ...r.links.map((l) =>
              h(
                'div',
                { style: 'margin-top:4px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11.5px;color:#334155' },
                h('div', { style: 'display:flex;justify-content:space-between;gap:6px' }, h('b', { style: 'word-break:break-all' }, l.domain ?? l.url), h('span', { style: 'flex:none;font-weight:700' }, LINK_LEVEL_TEXT[l.level])),
                ...l.reasons.map((reason) => h('div', { style: 'margin-top:2px;font-size:10.5px;color:#64748b' }, reason)),
              ),
            ),
          )
        : null,
      h('div', { style: 'font-weight:700;font-size:12px;color:#0f172a;margin-top:6px' }, 'Tổng hợp dấu hiệu theo mức độ'),
      !r || r.score_breakdown.length === 0
        ? h('div', { class: 'reason-strip' }, 'Chưa ghi nhận dấu hiệu rủi ro nào.')
        : h(
            'table',
            { class: 'mini-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Dấu hiệu'), h('th', { class: 'num' }, 'Mức độ'))),
            h(
              'tbody',
              {},
              ...r.score_breakdown.map((b) => {
                const pillClass = b.severity === 'medium' ? 'attention' : b.severity;
                return h(
                  'tr',
                  {},
                  h('td', {}, b.title),
                  h('td', { class: 'num' }, h('span', { class: `level-pill ${pillClass}` }, LEVEL_DISPLAY[b.severity])),
                );
              }),
            ),
          ),
      h(
        'button',
        {
          class: 'btn-detail',
          style: 'width:100%;padding:7px;margin-top:6px;text-align:center',
          onclick: () => void stopAndScanOthers(),
        },
        'Quét và đổi sang đoạn chat khác',
      ),
    );
  }

  function renderWidget() {
    // 1. Mặc định khi mở lên (hoặc thu gọn khi chưa khóa chat, hoặc đang kéo/nhảy đáp/ngủ): chú mèo Tuxedo Pixel cầm khiên + nút Quét chat
    if ((minimized || catPose !== 'idle') && !session) {
      const openAndScan = () => {
        catPose = 'idle';
        lastActivityAt = Date.now();
        minimized = false;
        runScan();
      };
      const bubbleTitle =
        catPose === 'pounce' && dragHoverThread
          ? `Nhận diện: ${dragHoverThread.threadLabel}`
          : catPose === 'dragging'
            ? 'Kéo mèo thả vào khung chat để bám & khóa'
            : catPose === 'landing'
              ? `Đã bám vào: ${landingThreadLabel || 'đoạn chat'}!`
              : catPose === 'sleeping'
                ? 'Zzz... Mèo đang ngủ nghỉ ngơi'
                : catPose === 'waking'
                  ? 'Meow! Mèo đã thức dậy!'
                  : 'Bấm vào mèo để quét đoạn chat';
      const bubbleSub =
        catPose === 'pounce' && dragHoverThread
          ? 'Thả chuột ra để mèo vồ bám & khóa ngay!'
          : catPose === 'landing'
            ? 'Đang khóa và bắt đầu quét tin nhắn...'
            : catPose === 'sleeping'
              ? 'Chạm chuột hoặc nắm kéo để gọi mèo dậy'
              : 'Hoặc kéo mèo thả thẳng vào khung chat';
      const shieldTagText =
        catPose === 'pounce'
          ? 'Thả để khóa!'
          : catPose === 'dragging'
            ? 'Đang kéo...'
            : catPose === 'landing'
              ? 'Đã bám chat!'
              : catPose === 'sleeping'
                ? 'Zzz Đang ngủ'
                : catPose === 'waking'
                  ? 'Sẵn sàng!'
                  : 'Quét chat';

      const catBtn = h(
        'button',
        {
          class: 'cat-stage-btn',
          title: 'Giữ kéo mèo thả vào khung chat để khóa ngay · Hoặc bấm để quét đoạn chat',
          onclick: openAndScan,
        },
        pixelCatShieldSvg('low', 88, 62, false, catPose),
        h(
          'span',
          { class: `cat-shield-tag ${catPose === 'pounce' || catPose === 'landing' || catPose === 'sleeping' ? 'low' : 'attention'}` },
          shieldTagText,
        ),
      );
      bindDragHandle(catBtn);

      const orbWrap = h(
        'div',
        { class: 'cat-perch-container compact-orb' },
        h(
          'div',
          {
            class: `cat-bubble ${catPose === 'pounce' || catPose === 'landing' || catPose === 'sleeping' ? 'low' : 'attention'}`,
            style: 'padding:6px 10px;width:auto;max-width:236px;cursor:pointer',
            onclick: openAndScan,
          },
          h('div', { style: 'font-size:11px;font-weight:700;color:#1e293b;text-align:center' }, bubbleTitle),
          h('div', { style: 'font-size:10px;color:#475569;text-align:center;margin-top:2px' }, bubbleSub),
        ),
        catBtn,
      );
      mount.replaceChildren(orbWrap);
      requestAnimationFrame(updateWidgetPosition);
      return;
    }

    // 2. Khi chưa có phiên khóa chat: Màn hình Bắt đầu quét popup trên Facebook (ở góc trên bên phải màn hình)
    if (!session) {
      const liveProbe = probeLocal();
      const threads = probeThreads(liveProbe);
      lastThreadSignature = threads.map((t) => `${t.threadId}:${t.threadLabel}`).join('|');

      if (threads.length > 0 && (!chosenThreadId || !threads.some((t) => t.threadId === chosenThreadId))) {
        chosenThreadId = threads[0]!.threadId;
      }
      const selectedThread = threads.find((t) => t.threadId === chosenThreadId) ?? threads[0] ?? null;

      const dragHeader = h(
        'div',
        { class: 'launcher-drag-bar drag-handle', title: 'Giữ chuột và kéo để di chuyển tới bất kỳ đâu trên màn hình' },
        h('span', {}, 'Giữ kéo để di chuyển tiện ích'),
        h(
          'button',
          {
            class: 'text-btn',
            title: 'Thu gọn thành chú mèo Pixel cầm khiên',
            onclick: () => {
              minimized = true;
              hideSpotlight();
              renderWidget();
            },
          },
          'Thu gọn',
        ),
      );
      bindDragHandle(dragHeader);

      const launcherEl = h(
        'div',
        { class: 'wrap' },
        h(
          'section',
          { class: 'launcher' },
          dragHeader,
          h(
            'div',
            { class: 'launcher-hero' },
            pixelCatShieldSvg('attention', 78, 55),
            h(
              'div',
              { style: 'min-width:0;flex:1' },
              h('div', { class: 'brand-title' }, 'SafeChat AI'),
              h('div', { class: 'sub' }, 'Chọn đoạn chat để chú mèo Pixel cầm khiên bám lên canh gác lừa đảo.'),
            ),
          ),
          h(
            'button',
            {
              class: 'btn-scan',
              disabled: isScanning,
              onclick: () => runScan(),
            },
            isScanning
              ? 'Đang quét dò popup trên màn hình...'
              : hasScanned
                ? `Quét lại popup trên màn hình (${threads.length})`
                : 'Bắt đầu quét popup',
          ),
          scanNotice &&
            h(
              'div',
              { style: 'margin-top:8px;padding:6px 9px;border-radius:8px;background:#fef2f2;color:#dc2626;font-size:11px' },
              scanNotice,
            ),
          h(
            'div',
            { class: 'scan-results' },
            h(
              'div',
              { class: 'scan-head' },
              h(
                'span',
                {},
                threads.length > 0
                  ? `Phát hiện ${threads.length} đoạn chat đang mở:`
                  : hasScanned
                    ? 'Chưa tìm thấy popup đoạn chat'
                    : 'Trạng thái dò khung chat:',
              ),
            ),
            threads.length === 0
              ? h(
                  'div',
                  { style: 'font-size:11.5px;color:#64748b;line-height:1.4' },
                  liveProbe.reason ?? 'Hãy mở một khung chat popup (không thu nhỏ) với người cần kiểm tra rồi bấm "Bắt đầu quét popup".',
                )
              : h(
                  'div',
                  { class: 'thread-list' },
                  ...threads.map((t) => {
                    const isSel = selectedThread?.threadId === t.threadId;
                    return h(
                      'div',
                      {
                        class: `thread-card${isSel ? ' selected' : ''}`,
                        onmouseenter: () => showSpotlight(t.threadId, t.threadLabel),
                        onmouseleave: () => hideSpotlight(),
                        onclick: () => {
                          chosenThreadId = t.threadId;
                          showSpotlight(t.threadId, t.threadLabel, 1000);
                          renderWidget();
                        },
                      },
                      h(
                        'div',
                        { style: 'min-width:0;flex:1' },
                        h('div', { class: 'thread-name' }, t.threadLabel),
                        h('div', { class: 'thread-sub' }, 'Rê chuột để định vị · Bấm Khóa để mèo bám lên chat'),
                      ),
                      h(
                        'button',
                        {
                          class: 'btn-lock',
                          disabled: !consent,
                          onclick: (ev: Event) => {
                            ev.stopPropagation();
                            void lockThread(t);
                          },
                        },
                        'Khóa chat',
                      ),
                    );
                  }),
                ),
            h(
              'div',
              { style: 'margin-top:8px;font-size:11.5px;font-weight:700;color:#334155' },
              'Cách đọc khi khóa chat:',
            ),
            ...[
              { value: true, title: 'Tự cuộn đọc lịch sử', note: 'tải tối đa 50 tin rồi trả về chỗ cũ' },
              { value: false, title: 'Không cuộn', note: 'chỉ đọc các tin đang có, có thể thiếu tin cũ' },
            ].map((o) =>
              h(
                'label',
                { class: 'consent-label', style: 'margin-top:4px' },
                h('input', {
                  type: 'radio',
                  name: 'safechat-read-mode',
                  checked: scrollHistory === o.value,
                  onchange: () => {
                    scrollHistory = o.value;
                    renderWidget();
                  },
                }),
                h('span', {}, h('b', {}, o.title), `: ${o.note}.`),
              ),
            ),
            h(
              'label',
              { class: 'consent-label', style: 'margin-top:4px' },
              h('input', {
                type: 'checkbox',
                checked: readQr,
                onchange: (e: Event) => {
                  readQr = (e.target as HTMLInputElement).checked;
                  void sendReq({ kind: 'set_qr_scan', value: readQr });
                  renderWidget();
                },
              }),
              h('span', {}, h('b', {}, 'Đọc mã QR trong ảnh'), ': chạy ngay trên máy, ảnh không được gửi đi.'),
            ),
            h(
              'label',
              { class: 'consent-label' },
              h('input', {
                type: 'checkbox',
                checked: consent,
                onchange: (e: Event) => {
                  consent = (e.target as HTMLInputElement).checked;
                  if (!consent && scanConsented) {
                    scanConsented = false;
                    void sendReq({ kind: 'set_scan_consent', value: false });
                  }
                  renderWidget();
                },
              }),
              h(
                'span',
                {},
                scrollHistory
                  ? `Đồng ý cho SafeChat AI đọc văn bản${readQr ? ' và mã QR trong ảnh' : ''} của đoạn chat bạn chọn khóa, gồm tối đa 50 tin gần nhất, có thể tự cuộn khung chat rồi trả về chỗ cũ.`
                  : `Đồng ý cho SafeChat AI đọc văn bản${readQr ? ' và mã QR trong ảnh' : ''} của đoạn chat bạn chọn khóa, tối đa 50 tin đang có trên trang, không cuộn khung chat.`,
              ),
            ),
          ),
        ),
      );

      mount.replaceChildren(launcherEl);
      requestAnimationFrame(updateWidgetPosition);
      return;
    }

    // 3. Khi ĐÃ KHÓA đoạn chat & ở chế độ CHÚ MÈO PIXEL CẦM KHIÊN BÁM TRÊN ĐỈNH KHUNG CHAT (sessionViewMode === 'mini')
    const r = session.result;
    const lv: RiskLevel = r?.risk_level ?? 'low';
    const sigCount = r?.signals.length ?? 0;
    const latestSig = r?.signals.at(-1);
    const topAction = r?.advice.actions[0];
    const topQuestion = r?.safety_priority ? undefined : r?.advice.questions[0];
    const assessmentText = r?.safety_priority ? undefined : ASSESSMENT_TEXT[r?.advice.answer_assessment ?? 'none'];

    const otherOpenThreads = probeThreads(probeLocal()).filter((t) => t.threadId !== session?.threadId);

    if (sessionViewMode === 'mini') {
      const suggestionText =
        catPose === 'pounce' && dragHoverThread
          ? dragHoverThread.threadId === session.threadId
            ? `Thả chuột để mèo bám lại lên đỉnh khung chat "${dragHoverThread.threadLabel}"!`
            : `Nhận diện: "${dragHoverThread.threadLabel}" — Thả chuột ra để mèo nhảy sang bám & khóa đoạn chat này!`
          : catPose === 'dragging'
            ? 'Kéo mèo tới vị trí bất kỳ, hoặc thả vào khung chat khác để đổi sang khóa & quét chat đó.'
            : catPose === 'landing'
              ? `Đã bám chặt vào khung chat "${landingThreadLabel || session.threadLabel}"! Đang canh gác...`
              : catPose === 'sleeping'
                ? 'Zzz... Cuộc trò chuyện đang yên ắng. Chạm chuột hoặc nắm kéo để gọi mèo dậy!'
                : catPose === 'waking'
                  ? 'Meow! Mèo đã tỉnh dậy và tiếp tục canh gác đoạn chat này!'
                  : session.waiting
                    ? `Khung chat "${session.threadLabel}" đã đóng — mở lại hoặc chọn chat khác bên dưới.`
                    : session.readerError
                      ? session.readerError
                      : r?.advice.ai_warning && lv !== 'low'
                        ? `AI nhận định: ${r.advice.ai_warning}`
                        : r?.safety_priority && r.advice.safety_message
                        ? r.advice.safety_message
                        : latestSig
                          ? `${r?.advice.focus_title ?? latestSig.title}${topAction ? ` — Gợi ý: ${topAction}` : ''}`
                          : topAction && lv !== 'low'
                            ? `Gợi ý: ${topAction}`
                            : session.scan?.state === 'loading'
                              ? session.scan.scroll === false
                                ? 'Đang đọc các tin đang hiển thị…'
                                : `Đang đọc lịch sử, tối đa ${session.scan.target} tin…`
                              : `Đang canh gác (${session.transcript.messages.length} tin) · ${LEVEL_SUBTITLE[lv]}`;

      const bubbleHead = h(
        'div',
        {
          class: 'bubble-top drag-handle',
          title: dockedToChat
            ? 'Đang bám trên đỉnh khung chat · Giữ kéo để tách rời hoặc thả vào chat khác'
            : 'Chế độ tự do · Giữ kéo thả vào chat để bám hoặc bấm Ghim lên chat',
        },
        h(
          'div',
          { class: 'bubble-thread-wrap' },
          h('span', { class: `dot${session.status !== 'tracking' || session.waiting ? ' paused' : ''}` }),
          h(
            'span',
            { class: 'bubble-thread-name', title: dragHoverThread?.threadLabel ?? session.threadLabel },
            catPose === 'pounce' && dragHoverThread ? `→ ${dragHoverThread.threadLabel}` : session.threadLabel,
          ),
        ),
        h('span', { class: `level-pill ${lv}` }, LEVEL_DISPLAY[lv]),
      );
      bindDragHandle(bubbleHead);

      const isBurst = checkLevelBurst(lv);
      const miniShieldTag =
        catPose === 'pounce'
          ? 'Thả để khóa!'
          : catPose === 'dragging'
            ? 'Đang kéo...'
            : catPose === 'landing'
              ? 'Đã bám chat!'
              : catPose === 'sleeping'
                ? 'Zzz Đang ngủ'
                : catPose === 'waking'
                  ? 'Sẵn sàng!'
                  : LEVEL_DISPLAY[lv];
      const catStageBtn = h(
        'button',
        {
          class: 'cat-stage-btn',
          title: 'Bấm vào mèo để mở bảng Chi tiết bên cạnh khung chat · Giữ kéo thả vào khung chat để bám',
          onclick: () => {
            catPose = 'idle';
            lastActivityAt = Date.now();
            sessionViewMode = 'detail';
            detailTab = sigCount > 0 ? 'evaluate' : 'overview';
            renderWidget();
          },
        },
        pixelCatShieldSvg(lv, 102, 74, isBurst, catPose),
        h('span', { class: `cat-shield-tag ${lv}` }, miniShieldTag),
      );
      bindDragHandle(catStageBtn);

      const perchWrap = h(
        'section',
        { class: 'cat-perch-container' },
        // Bong bóng gợi ý nằm ngay trên đầu mèo
        h(
          'div',
          { class: `cat-bubble ${lv}` },
          bubbleHead,
          h(
            'div',
            {
              class: 'bubble-hint-box',
              style: 'cursor:pointer',
              title: 'Bấm để mở bảng Chi tiết bên cạnh khung chat',
              onclick: () => {
                sessionViewMode = 'detail';
                detailTab = sigCount > 0 ? 'evaluate' : 'overview';
                renderWidget();
              },
            },
            h('div', {}, suggestionText),
            assessmentText && !session.waiting && h('div', { style: 'margin-top:4px;font-size:11px;font-weight:700;color:#b45309' }, assessmentText),
            r?.advice.likely_next &&
              lv !== 'low' &&
              !session.waiting &&
              h('div', { style: 'margin-top:4px;font-size:11px;color:#7c2d12' }, `Bước tiếp theo có thể: ${r.advice.likely_next}`),
            aiChip(session) && h('div', { style: 'margin-top:4px;font-size:10.5px;color:#64748b' }, aiChip(session)!),
            (r?.open_questions?.length ?? 0) > 0 &&
              !session.waiting &&
              h('div', { style: 'margin-top:4px;font-size:11px;font-weight:700;color:#b91c1c' }, `Bạn đã hỏi ${r!.open_questions!.length} câu nhưng chưa được trả lời rõ. Xem ở Chi tiết.`),
            r?.advice.waiting_answer &&
              !r.signals.some((s) => /^user_(complied|intends)_/.test(s.type)) &&
              !session.waiting &&
              h('div', { style: 'margin-top:4px;font-size:11px;color:#64748b' }, 'Đang chờ đối phương trả lời. Đọc kỹ câu trả lời trước khi làm tiếp.'),
            topQuestion &&
              !session.waiting &&
              h(
                'div',
                {
                  class: 'bubble-question-row',
                  onclick: (ev: Event) => ev.stopPropagation(),
                },
                h(
                  'span',
                  { style: 'min-width:0;flex:1' },
                  `Hỏi thử: "${topQuestion}"`,
                  r?.advice.question_reason && h('div', { style: 'margin-top:2px;font-size:10.5px;color:#64748b' }, `Vì sao nên hỏi: ${r.advice.question_reason}`),
                ),
                h(
                  'button',
                  {
                    class: 'btn-copy',
                    onclick: async (ev: Event) => {
                      ev.stopPropagation();
                      await navigator.clipboard?.writeText?.(topQuestion).catch(() => {});
                      copyFeedback = topQuestion;
                      renderWidget();
                      setTimeout(() => {
                        copyFeedback = '';
                        renderWidget();
                      }, 1500);
                    },
                  },
                  copyFeedback === topQuestion ? 'Đã chép' : 'Sao chép',
                ),
              ),
          ),
          h(
            'div',
            { class: 'bubble-actions' },
            h(
              'button',
              {
                class: 'btn-detail',
                onclick: () => {
                  sessionViewMode = 'detail';
                  renderWidget();
                },
              },
              sigCount > 0 ? `Chi tiết (${sigCount})` : 'Chi tiết',
            ),
            h(
              'div',
              { class: 'bubble-actions-right' },
              !dockedToChat &&
                h(
                  'button',
                  {
                    class: 'text-btn pin-active',
                    title: 'Cho mèo bám lại ngay trên đỉnh khung chat này',
                    onclick: () => {
                      dockedToChat = true;
                      renderWidget();
                    },
                  },
                  'Ghim lên chat',
                ),
              h(
                'button',
                {
                  class: 'text-btn',
                  title: 'Quét và đổi sang đoạn chat khác',
                  onclick: () => void stopAndScanOthers(),
                },
                'Đổi chat',
              ),
              h(
                'button',
                {
                  class: 'text-btn',
                  title: 'Dừng canh gác đoạn chat này',
                  onclick: () => void closeToDefaultCat(),
                },
                'Đóng',
              ),
            ),
          ),
          session.waiting &&
            h(
              'div',
              { class: 'waiting-switch-box' },
              ...otherOpenThreads.slice(0, 3).map((t) =>
                h(
                  'button',
                  {
                    class: 'btn-lock',
                    title: `Khóa và quét ngay đoạn chat với ${t.threadLabel}`,
                    onmouseenter: () => showSpotlight(t.threadId, t.threadLabel),
                    onmouseleave: () => hideSpotlight(),
                    onclick: async () => {
                      await sendReq({ kind: 'stop_and_clear' });
                      await lockThread(t);
                    },
                  },
                  `Quét: ${t.threadLabel}`,
                ),
              ),
              h(
                'button',
                {
                  class: 'btn-detail',
                  onclick: () => void stopAndScanOthers(),
                },
                'Quét tìm đoạn chat khác',
              ),
            ),
        ),
        // Chú mèo Pixel cầm khiên bám ngay dưới bong bóng
        catStageBtn,
      );

      mount.replaceChildren(perchWrap);
      requestAnimationFrame(updateWidgetPosition);
      return;
    }

    // 4. Khi bấm vào mèo hoặc "Chi tiết" (sessionViewMode === 'detail'):
    //    Hiển thị bên cạnh khung chat, với phần đầu 2 hàng rõ ràng không bao giờ đè chữ!
    const liveHead = h(
      'div',
      { class: 'live-head drag-handle', title: 'Giữ kéo để di chuyển bảng chi tiết tới bất kỳ đâu' },
      h(
        'div',
        { class: 'live-head-top' },
        h(
          'div',
          { class: 'live-title' },
          h('span', { class: `dot${session.status !== 'tracking' || session.waiting ? ' paused' : ''}` }),
          h('span', {}, 'SafeChat AI'),
          h('span', { class: 'live-thread-name', title: session.threadLabel }, `· ${session.threadLabel}`),
        ),
        h('span', { class: `level-pill ${lv}` }, LEVEL_DISPLAY[lv]),
      ),
      h(
        'div',
        { class: 'win-btns' },
        !dockedToChat &&
          h(
            'button',
            {
              class: 'text-btn pin-active',
              title: 'Đặt lại ngay bên cạnh khung chat đang khóa',
              onclick: () => {
                dockedToChat = true;
                renderWidget();
              },
            },
            'Ghim cạnh chat',
          ),
        h(
          'button',
          {
            class: 'btn-detail',
            title: 'Thu gọn về chú mèo Pixel cầm khiên bám trên khung chat',
            onclick: () => {
              sessionViewMode = 'mini';
              renderWidget();
            },
          },
          'Về mèo canh gác',
        ),
        h(
          'button',
          {
            class: 'text-btn',
            title: session.status === 'tracking' ? 'Tạm dừng theo dõi' : 'Tiếp tục theo dõi',
            onclick: async () => {
              await sendReq({ kind: session?.status === 'tracking' ? 'pause' : 'resume' });
            },
          },
          session.status === 'tracking' ? 'Tạm dừng' : 'Tiếp tục',
        ),
        h(
          'button',
          {
            class: 'text-btn',
            title: 'Quét và đổi sang đoạn chat khác',
            onclick: () => void stopAndScanOthers(),
          },
          'Đổi chat',
        ),
        h(
          'button',
          {
            class: 'text-btn',
            title: 'Dừng và về mèo canh gác mặc định',
            onclick: () => void closeToDefaultCat(),
          },
          'Đóng',
        ),
      ),
    );
    bindDragHandle(liveHead);

    const tabsNav = h(
      'div',
      { class: 'detail-tabs', role: 'tablist' },
      h(
        'button',
        {
          class: `tab-btn${detailTab === 'overview' ? ' active' : ''}`,
          onclick: () => {
            detailTab = 'overview';
            renderWidget();
          },
        },
        'Tổng quan',
      ),
      h(
        'button',
        {
          class: `tab-btn${detailTab === 'evaluate' ? ' active' : ''}`,
          onclick: () => {
            detailTab = 'evaluate';
            renderWidget();
          },
        },
        `Đánh giá (${sigCount})`,
      ),
      h(
        'button',
        {
          class: `tab-btn${detailTab === 'analysis' ? ' active' : ''}`,
          onclick: () => {
            detailTab = 'analysis';
            renderWidget();
          },
        },
        'Phân tích',
      ),
    );

    const detailWrap = h(
      'div',
      { class: 'wrap' },
      h(
        'section',
        { class: 'live-card' },
        liveHead,
        tabsNav,
        detailTab === 'overview'
          ? renderOverviewTab(session)
          : detailTab === 'evaluate'
            ? renderEvaluateTab(session)
            : renderAnalysisTab(session),
      ),
    );

    mount.replaceChildren(detailWrap);
    requestAnimationFrame(updateWidgetPosition);
  }

  window.addEventListener('resize', () => updateWidgetPosition());
  window.addEventListener('scroll', () => updateWidgetPosition(), true);
  setInterval(() => {
    if (isDragging) return;
    if (catPose === 'sleeping' && !canCatSleep()) {
      catPose = 'idle';
      lastActivityAt = Date.now();
      renderWidget();
      return;
    }
    if (catPose === 'idle' && canCatSleep() && Date.now() - lastActivityAt >= SLEEP_IDLE_MS) {
      catPose = 'sleeping';
      renderWidget();
      return;
    }
    if (session && dockedToChat && !session.waiting) {
      updateWidgetPosition();
    }
    if ((!session && !minimized) || session?.waiting) {
      const sig = probeThreads(probeLocal())
        .map((t) => `${t.threadId}:${t.threadLabel}`)
        .join('|');
      if (sig !== lastThreadSignature) {
        lastThreadSignature = sig;
        renderWidget();
      }
    }
  }, 400);

  chrome.storage?.session
    ?.get?.(SESSION_KEY)
    .then((res) => {
      session = (res?.[SESSION_KEY] as Session | undefined) ?? null;
      lastMsgCount = session?.transcript.messages.length ?? 0;
      renderWidget();
    })
    .catch(() => renderWidget());

  chrome.storage?.session?.onChanged?.addListener?.((changes) => {
    if (SESSION_KEY in changes) {
      const prev = session;
      session = (changes[SESSION_KEY]?.newValue as Session | undefined) ?? null;
      const nextMsgCount = session?.transcript.messages.length ?? 0;
      const nextLv = session?.result?.risk_level ?? 'low';
      if (nextMsgCount !== lastMsgCount || nextLv !== 'low') {
        lastMsgCount = nextMsgCount;
        lastActivityAt = Date.now();
        if (catPose === 'sleeping') {
          catPose = 'waking';
          clearTimeout(landingTimer);
          landingTimer = setTimeout(() => {
            if (catPose === 'waking' && !isDragging) {
              catPose = 'idle';
              renderWidget();
            }
          }, 850);
        }
      }
      if (!prev && session) {
        sessionViewMode = 'mini';
        dockedToChat = true;
      } else if (prev && !session) {
        chosenThreadId = null;
        hasScanned = true;
      }
      renderWidget();
    }
  });
}
