// Phần thuần (không DOM) của adapter Messenger — tách riêng để test bằng Vitest.
import type { Sender } from '@safechat/core/types';
import { unwrapFacebookLink } from '@safechat/core/linkUnwrap';

/** Tiền tố nhãn ô soạn tin của khung chat: "Viết cho Mạnh Hùng" → "Mạnh Hùng". */
const COMPOSER_PREFIX = /^(?:viết cho|nhắn tin cho|gửi tin nhắn cho|nhập tin nhắn tới|trả lời|write to|message|send a message to)\s+/i;

export function labelFromComposer(aria: string | null | undefined): string | null {
  const s = aria?.trim();
  if (!s || !COMPOSER_PREFIX.test(s)) return null;
  const name = s.replace(COMPOSER_PREFIX, '').trim();
  return name || null;
}

/** Nhãn nút phần đầu khung chat (đã đối chiếu DOM thật). */
export const HEADER_BUTTON_LABELS = [
  'Cài đặt đoạn chat',
  'Chat settings',
  'Cài đặt chat',
];

const FB_HOSTS = new Set(['www.facebook.com', 'web.facebook.com', 'facebook.com', 'www.messenger.com', 'messenger.com']);

const RESERVED_FB_PATHS = new Set([
  'profile.php',
  'home.php',
  'index.php',
  'l.php',
  'groups',
  'watch',
  'marketplace',
  'gaming',
  'friends',
  'bookmarks',
  'notifications',
  'settings',
  'photo',
  'photos',
  'stories',
  'events',
  'pages',
  'hashtag',
  'help',
  'policies',
  'messages',
  'reel',
  'reels',
  'videos',
  'share',
  'sharer',
  'login',
  'recover',
  'ajax',
  'dialog',
  'onthisday',
  'memories',
  'saved',
  'feeds',
  'fundraisers',
  'climatescienceinfo',
  'crisisresponse',
  'search',
  'ads',
  'business',
  'privacy',
]);

/** Chữ trạng thái Messenger gắn dưới tin của mình ("Đã gửi", "Đã xem"): không phải nội dung tin. */
const STATUS_SUFFIX = /\s*(Đã gửi|Đã xem|Đang gửi|Đã nhận|Sent|Seen|Delivered|Sending)\s*$/u;
export function cleanBubbleText(text: string): string {
  let t = text.trim();
  while (STATUS_SUFFIX.test(t)) t = t.replace(STATUS_SUFFIX, '').trim();
  return t;
}

/** Thông báo của Messenger nằm trong khung chat, không phải tin của ai. */
export function isSystemNotice(text: string): boolean {
  return /^(Tin nhắn và cuộc gọi được bảo mật bằng tính năng mã hóa đầu cuối|Messages and calls are secured with end-to-end encryption)/i.test(text.trim());
}

/** Cùng một tin có thể mang mã "123" ở hàng ngoài và "<id người>@msgr.123" ở hàng trong. */
export function normalizeDomId(id: string | undefined): string | undefined {
  return id?.replace(/^\d+@msgr\./, '') || undefined;
}

/** Địa chỉ link ra ngoài từ các thẻ a trong tin: gỡ link bọc, bỏ link nội bộ của Facebook như hồ sơ, ảnh đại diện. */
export function externalLinks(hrefs: string[]): string[] {
  const out = new Set<string>();
  for (const href of hrefs) {
    const real = unwrapFacebookLink(href);
    try {
      const u = new URL(real, 'https://www.facebook.com');
      if (!FB_HOSTS.has(u.hostname) && !/^javascript:/i.test(u.href)) out.add(u.href);
    } catch {
      // bỏ qua địa chỉ không hợp lệ
    }
    if (out.size >= 10) break;
  }
  return [...out];
}

/** ID hoặc định danh của người kia từ link hồ sơ ở phần đầu khung chat: /<số>/, /profile.php?id=<số>, /people/<tên>/<số>/, /messages/t/<id>/ hoặc /<username>/. */
export function peerIdFromHref(href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;
  let u: URL;
  try {
    u = new URL(href, 'https://www.facebook.com');
  } catch {
    return null;
  }
  if (!FB_HOSTS.has(u.hostname)) return null;
  const mNum = /^\/(\d+)\/?$/.exec(u.pathname);
  if (mNum) return mNum[1]!;
  if (u.pathname === '/profile.php') return /^\d+$/.exec(u.searchParams.get('id') ?? '')?.[0] ?? null;
  const mPeople = /^\/people\/[^/]+\/(\d+)\/?$/i.exec(u.pathname);
  if (mPeople) return mPeople[1]!;
  const mThread = /^\/(?:messages\/(?:e2ee\/)?t|e2ee\/t|t)\/([a-zA-Z0-9._-]+)\/?$/i.exec(u.pathname);
  if (mThread) return mThread[1]!;
  const mSlug = /^\/([a-zA-Z0-9._]{3,100})\/?$/.exec(u.pathname);
  if (mSlug) {
    const slug = mSlug[1]!;
    if (!RESERVED_FB_PATHS.has(slug.toLowerCase()) && !slug.endsWith('.php')) return slug;
  }
  return null;
}

/**
 * Mã tin của Messenger có dạng "<id người kia>@msgr.<…>". Mọi tin đọc được phải khớp người đã chọn —
 * một tin lệch là dấu hiệu bộ đọc đang nhìn nhầm vùng → dừng đọc (không đọc nhầm cuộc khác).
 */
export function messageIdMatchesPeer(messageId: string | undefined, peer: string): boolean {
  return !!messageId && messageId.length <= 180 && messageId.startsWith(`${peer}@msgr.`);
}

/**
 * Người gửi theo aria-label của tin, dạng "Lúc Thứ Sáu 20:29ch, Bạn: Kkk" / "At 8:29 PM, You: …".
 *  1. Chắc nhất: ngay sau "<người gửi>: " là đúng phần đầu nội dung tin (tránh nhầm khi nội dung chứa "Bạn:").
 *  2. Không thấy nội dung trong nhãn: dựa vào tiền tố "Lúc …, Bạn:".
 * Không khớp → null (dùng vị trí trái/phải thay thế).
 */
export function senderFromAria(aria: string | null | undefined, text: string): Sender | null {
  if (!aria) return null;
  const a = aria.replace(/\s+/g, ' ');
  const head = text.trim().replace(/\s+/g, ' ').slice(0, 20);
  if (head) {
    if (a.includes(`, Bạn: ${head}`) || a.includes(`, You: ${head}`)) return 'self';
    if (a.includes(`: ${head}`)) return 'other';
  }
  if (/^(?:Lúc\s+[^,]+,\s*Bạn:|At\s+[^,]+,\s*You:)/i.test(a)) return 'self';
  if (/^(?:Lúc|At)\s+[^,]+,\s*[^:]+:/i.test(a)) return 'other';
  return null;
}

/** Tin của chính người dùng nằm lệch phải trong danh sách tin; quá sát giữa thì 'unknown'. */
export function senderFromPosition(bubble: { left: number; width: number }, list: { left: number; width: number }): Sender {
  if (list.width === 0 || bubble.width === 0) return 'unknown';
  const center = bubble.left + bubble.width / 2;
  const mid = list.left + list.width / 2;
  const margin = list.width * 0.05;
  if (center > mid + margin) return 'self';
  if (center < mid - margin) return 'other';
  return 'unknown';
}
