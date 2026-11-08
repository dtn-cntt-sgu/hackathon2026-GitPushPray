// Adapter cho khung chat popup Messenger trên facebook.com và messenger.com.
// Chỉ đọc. Ngoại lệ duy nhất: lần quét đầu tự cuộn khung chat để tải lịch sử rồi trả về vị trí cũ.
// DOM của Messenger KHÔNG ổn định và có thể đổi bất cứ lúc nào — TẤT CẢ selector nằm ở đây.
// Cấu trúc đã dò trên giao diện thật (dev/dom-probe.js):
//   khung: [button aria-label="Cài đặt đoạn chat"] › h2/h3/span (tên) · a[href=/<id hoặc username>/]
//   tin:   div[role=log] › … › div[data-message-id="<id>@msgr.…"][aria-label="Lúc …, Bạn: …"] › … div[dir=auto]
import type { ObservedMessage } from '@safechat/core/transcript';
import type { ThreadInfo } from '../shared/protocol';
import type { ChatAdapter } from './adapter';
import { QR_ONLY_TEXT } from '@safechat/core/transcript';
import { collectHistory } from './history';
import { beginQrRead, qrIn } from './qrDecode';
import {
  cleanBubbleText,
  externalLinks,
  isSystemNotice,
  normalizeDomId,
  HEADER_BUTTON_LABELS,
  labelFromComposer,
  messageIdMatchesPeer,
  peerIdFromHref,
  senderFromAria,
  senderFromPosition,
} from './messengerParse';

const linksIn = (el: HTMLElement) => externalLinks([...el.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href));

const SELECTORS = {
  log: '[role="log"]',
  message: '[data-message-id]',
  row: '[role="row"]',
  text: '[dir="auto"]',
  /** Phần tử chứa chữ không thuộc nội dung tin: nút (vd. "Nhập, bản sao trợ năng"), tiêu đề h2, phần ẩn, ô soạn. */
  notText: '[role="button"],[contenteditable="true"],h2,[aria-hidden="true"]',
  composer: '[role="textbox"][contenteditable="true"]',
};
const MAX_ROWS = 300;
const MAX_TEXT = 4000;

interface Thread extends ThreadInfo {
  peer: string;
  log: HTMLElement;
  root: HTMLElement;
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected || el.getClientRects().length === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** Tìm nút phần đầu khung ("Cài đặt đoạn chat"), duyệt cây con của `root` nhưng KHÔNG đi vào vùng tin `log`. */
function findHeader(root: Element, log: Element): Element | undefined {
  const pending = [...root.children];
  while (pending.length) {
    const node = pending.shift()!;
    if (node === log) continue;
    const aria = node.getAttribute('aria-label') ?? '';
    if (node.getAttribute('role') === 'button' && HEADER_BUTTON_LABELS.includes(aria)) return node;
    pending.push(...node.children);
  }
  return undefined;
}

/** Trích xuất định danh duy nhất của người trò chuyện trong khung `root` (đã xác minh có `header`). */
function extractPeerId(root: HTMLElement, log: HTMLElement, name: string): string | null {
  const headerLinks = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => !log.contains(a));

  // 1. Ưu tiên link hồ sơ ở phần đầu khung khớp với tên người trò chuyện
  const matchingLinks = headerLinks
    .filter((a) => {
      const aria = a.getAttribute('aria-label')?.trim();
      const txt = a.textContent?.trim();
      return aria === name || txt === name;
    })
    .map((a) => peerIdFromHref(a.getAttribute('href') ?? ''))
    .filter((x): x is string => !!x);

  const uniqueMatching = [...new Set(matchingLinks)];
  if (uniqueMatching.length === 1) return uniqueMatching[0]!;

  // 2. Nếu phần đầu khung có đúng 1 định danh hồ sơ hợp lệ (dù aria-label của thẻ <a> khác hoặc trống)
  const allHeaderIds = [
    ...new Set(headerLinks.map((a) => peerIdFromHref(a.getAttribute('href') ?? '')).filter((x): x is string => !!x)),
  ];
  if (allHeaderIds.length === 1) return allHeaderIds[0]!;
  const numericHeaderIds = allHeaderIds.filter((id) => /^\d+$/.test(id));
  if (numericHeaderIds.length === 1) return numericHeaderIds[0]!;

  // 3. Lấy từ tiền tố "<id>@msgr." của tin nhắn trong vùng log (nếu có)
  const msgEls = [...log.querySelectorAll<HTMLElement>(SELECTORS.message)];
  const msgPeers = new Set(
    msgEls
      .map((el) => /^(\d+)@msgr\./.exec(el.dataset.messageId ?? '')?.[1])
      .filter((x): x is string => !!x),
  );
  if (msgPeers.size === 1) return [...msgPeers][0]!;

  // 4. Dự phòng cho khung chat đã có nút "Cài đặt đoạn chat" + tên nhưng chưa gắn thẻ <a> (vd. khung E2EE)
  if (name) {
    return `user_${name.toLowerCase().replace(/\s+/g, '_')}`;
  }

  return null;
}

/** Mọi khung chat đang hiển thị xác minh được (bắt buộc có vùng [role="log"] và nút "Cài đặt đoạn chat"). */
function threads(): Thread[] {
  const out: Thread[] = [];
  const seenThreadIds = new Set<string>();

  for (const log of document.querySelectorAll<HTMLElement>(SELECTORS.log)) {
    if (!visible(log)) continue;
    let root = log.parentElement;
    for (let depth = 0; root && depth < 16; depth++, root = root.parentElement) {
      if (root.querySelectorAll(SELECTORS.log).length !== 1) break;
      const header = findHeader(root, log);
      if (!header) continue;

      // Bước lên tối đa 3 cấp nếu thẻ cha vẫn là khung gọn của đúng 1 popup (để bao gồm cả ô soạn tin ở đáy)
      let popupRoot: HTMLElement = root;
      for (
        let extra = 0, p = root.parentElement;
        p && extra < 3 && p.querySelectorAll(SELECTORS.log).length === 1;
        extra++, p = p.parentElement
      ) {
        const r = p.getBoundingClientRect();
        if (r.width >= 200 && r.width <= 520 && r.height >= 200) {
          popupRoot = p;
        } else {
          break;
        }
      }

      const name =
        header.querySelector('h1,h2,h3,h4,[role="heading"],span[dir="auto"]')?.textContent?.trim() ||
        labelFromComposer(popupRoot.querySelector(SELECTORS.composer)?.getAttribute('aria-label')) ||
        '';
      if (!name) continue;

      const peer = extractPeerId(popupRoot, log, name);
      if (!peer) continue;

      const threadId = `messenger:${peer}`;
      if (!seenThreadIds.has(threadId)) {
        seenThreadIds.add(threadId);
        out.push({ threadId, threadLabel: name, peer, log, root: popupRoot });
      }
      break;
    }
  }
  return out;
}

/** Đúng một khung khớp mã đã chọn. */
function selected(threadId: string): Thread | undefined {
  const m = threads().filter((t) => t.threadId === threadId);
  return m.length === 1 ? m[0] : undefined;
}

/** Phần tử cuộn gần nhất của vùng tin, đi từ tin cuối lên tới khung chat. */
function findScroller(t: Thread): HTMLElement | null {
  let el: HTMLElement | null = t.log.querySelector<HTMLElement>(`${SELECTORS.message}:last-of-type`) ?? t.log;
  while (el && el !== t.root.parentElement) {
    const o = getComputedStyle(el).overflowY;
    if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

function findAriaLabelNear(el: HTMLElement, stopAt: HTMLElement): string | null {
  const direct = el.getAttribute('aria-label');
  if (direct) return direct;
  let curr = el.parentElement;
  while (curr && curr !== stopAt) {
    const a = curr.getAttribute('aria-label');
    if (a) return a;
    curr = curr.parentElement;
  }
  const childWithAria = el.querySelector<HTMLElement>('[aria-label]');
  if (childWithAria?.getAttribute('aria-label')) return childWithAria.getAttribute('aria-label');
  return null;
}

export const messengerAdapter: ChatAdapter = {
  platform: 'messenger',
  keepsSelection: true,

  listThreads() {
    return threads().map(({ threadId, threadLabel }) => ({ threadId, threadLabel }));
  },

  whyNotDetected() {
    const logs = [...document.querySelectorAll<HTMLElement>(SELECTORS.log)].filter(visible).length;
    if (logs > 0)
      return 'Thấy khung chat nhưng chưa xác minh được người đang trò chuyện (chat nhóm hoặc giao diện khác chưa được hỗ trợ).';
    return 'Chưa thấy khung chat nào đang mở. Hãy mở khung chat (không thu nhỏ) với người cần kiểm tra.';
  },

  readMessages(threadId) {
    const t = selected(threadId);
    if (!t) return { messages: [] };

    const listRect = t.log.getBoundingClientRect();
    beginQrRead();

    // Nhánh 1: Các tin nhắn có thuộc tính [data-message-id]
    const msgRows = [...t.log.querySelectorAll<HTMLElement>(SELECTORS.message)]
      .filter((r) => !r.parentElement?.closest(SELECTORS.message))
      .slice(-MAX_ROWS);

    if (msgRows.length > 0) {
      const firstMsgPeer = /^(\d+)@msgr\./.exec(msgRows[0]?.dataset.messageId ?? '')?.[1] ?? null;
      const expectedPeer = /^\d+$/.test(t.peer) && firstMsgPeer === t.peer ? t.peer : firstMsgPeer;

      if (expectedPeer && msgRows.some((r) => /^(\d+)@msgr\./.test(r.dataset.messageId ?? '') && !messageIdMatchesPeer(r.dataset.messageId, expectedPeer))) {
        return { messages: [], error: 'Mã tin nhắn không khớp người đã chọn — đã ngừng đọc để tránh đọc nhầm cuộc khác.' };
      }

      const out: ObservedMessage[] = [];
      for (const row of msgRows) {
        const els = [...row.querySelectorAll<HTMLElement>(SELECTORS.text)].filter(
          (n) => !n.querySelector(SELECTORS.text) && !n.closest(SELECTORS.notText),
        );
        const parts = els.map((n) => (n.innerText ?? n.textContent ?? '').trim()).filter(Boolean);
        const qr = qrIn(row);
        const said = cleanBubbleText(parts.join(' '));
        if ((!said && qr.length === 0) || isSystemNotice(said)) continue;
        const text = said || QR_ONLY_TEXT;
        if (text.length > MAX_TEXT) continue;
        const sender =
          senderFromAria(row.getAttribute('aria-label') ?? findAriaLabelNear(row, t.log), parts[parts.length - 1] ?? '') ??
          senderFromPosition((els[els.length - 1] ?? row).getBoundingClientRect(), listRect);
        const links = linksIn(row);
        out.push({ sender, text, domId: normalizeDomId(row.dataset.messageId), ...(links.length ? { links } : {}), ...(qr.length ? { qr } : {}) });
      }
      if (out.length > 0) return { messages: out };
    }

    // Nhánh 2: Khung chat E2EE hoặc giao diện dùng [role="row"] trong vùng log
    const fallbackRows = [...t.log.querySelectorAll<HTMLElement>(SELECTORS.row)]
      .filter((r) => !r.parentElement?.closest(SELECTORS.row) && !t.root.querySelector(SELECTORS.composer)?.contains(r))
      .slice(-MAX_ROWS);

    if (fallbackRows.length > 0) {
      const out: ObservedMessage[] = [];
      for (const row of fallbackRows) {
        const els = [...row.querySelectorAll<HTMLElement>(SELECTORS.text)].filter(
          (n) => !n.querySelector(SELECTORS.text) && !n.closest(SELECTORS.notText),
        );
        const parts = els.map((n) => (n.innerText ?? n.textContent ?? '').trim()).filter(Boolean);
        const qr = qrIn(row);
        const said = cleanBubbleText(parts.join(' '));
        if ((!said && qr.length === 0) || isSystemNotice(said)) continue;
        const text = said || QR_ONLY_TEXT;
        if (text.length > MAX_TEXT) continue;
        const aria = findAriaLabelNear(row, t.log);
        const sender =
          senderFromAria(aria, parts[parts.length - 1] ?? '') ??
          senderFromPosition((els[els.length - 1] ?? row).getBoundingClientRect(), listRect);
        const links = linksIn(row);
        out.push({ sender, text, ...(links.length ? { links } : {}), ...(qr.length ? { qr } : {}) });
      }
      if (out.length > 0) return { messages: out };
    }

    // Nhánh 3: Khung chat E2EE chỉ chứa các bong bóng chữ [dir="auto"] trực tiếp bên trong [role="log"]
    const textLeaves = [...t.log.querySelectorAll<HTMLElement>(SELECTORS.text)]
      .filter((n) => !n.querySelector(SELECTORS.text) && !n.closest(SELECTORS.notText))
      .slice(-MAX_ROWS);
    const imageWraps = [...t.log.querySelectorAll<HTMLImageElement>('img')].filter((i) => i.getBoundingClientRect().width >= 80).map((i) => i.parentElement!).filter(Boolean);
    const ordered = [...textLeaves, ...imageWraps].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    const out: ObservedMessage[] = [];
    for (const el of ordered) {
      if (!textLeaves.includes(el)) {
        const qr = qrIn(el);
        if (!qr.length) continue;
        const aria = findAriaLabelNear(el, t.log);
        out.push({ sender: senderFromAria(aria, '') ?? senderFromPosition(el.getBoundingClientRect(), listRect), text: QR_ONLY_TEXT, qr });
        continue;
      }
      const text = cleanBubbleText(el.innerText ?? el.textContent ?? '');
      if (!text || text.length > MAX_TEXT || isSystemNotice(text)) continue;
      const aria = findAriaLabelNear(el, t.log);
      const sender = senderFromAria(aria, text) ?? senderFromPosition(el.getBoundingClientRect(), listRect);
      if (sender === 'unknown' && !aria) continue;
      const links = linksIn(el);
      out.push({ sender, text, ...(links.length ? { links } : {}) });
    }
    return { messages: out };
  },

  async loadHistory(threadId, target, cancelled) {
    const t = selected(threadId);
    const scroller = t ? findScroller(t) : null;
    // Khoảng cách tới đáy không đổi khi có tin cũ chèn lên trên, nên dùng để trả về đúng chỗ cũ.
    const fromBottom = scroller ? scroller.scrollHeight - scroller.scrollTop : 0;
    return collectHistory(
      {
        read: () => this.readMessages(threadId),
        scrollUp: () => {
          if (!scroller?.isConnected) return false;
          scroller.scrollTop = 0;
          return true;
        },
        restore: () => {
          if (scroller?.isConnected) scroller.scrollTop = scroller.scrollHeight - fromBottom;
        },
        cancelled,
      },
      target,
    );
  },

  observeRoot(threadId) {
    return selected(threadId)?.log ?? null;
  },

  getThreadRect(threadId) {
    const t = selected(threadId);
    if (!t) return null;
    const rr = t.root.getBoundingClientRect();
    if (rr.width >= 180 && rr.height >= 120) return rr;
    return t.log.getBoundingClientRect();
  },
};
