// Phân tích đường link ngay trên máy, không truy cập link và không gửi gì ra ngoài.
// Mỗi link có một mức: none (chưa thấy dấu hiệu), weak (chỉ một dấu hiệu nhẹ, không tăng mức cảnh báo),
// medium và high. Tên miền chính thức nên được xác minh từ trang chủ của đơn vị.
import { parse } from 'tldts';
import { unwrapFacebookLink } from './linkUnwrap';
import type { ChatMessage, LinkFinding, LinkLevel } from './types';

export { unwrapFacebookLink };

const SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'shorturl.at', 'rb.gy', 'is.gd', 'goo.gl', 't.ly', 'tiny.cc', 'shorten.asia'];
/** Đuôi hay bị lạm dụng: tự nó đã đáng ngờ. Trên SMS dev, tin lừa đảo dùng nhiều còn tin thường không dùng (EXP-024). */
const ABUSED_TLDS = new Set(['top', 'xyz', 'cc', 'online', 'vip', 'icu', 'buzz', 'click', 'win', 'bond', 'cfd', 'sbs', 'rest', 'cyou', 'lat', 'ru', 'tk', 'ml', 'ga', 'cf', 'gq']);
/** Đuôi trang thật cũng hay dùng: đứng một mình không tăng mức, cần thêm dấu hiệu khác. */
const COMMON_NEW_TLDS = new Set(['shop', 'store', 'live', 'site', 'club', 'link', 'work']);
/** Từ khóa cơ quan, thương hiệu hay bị giả mạo trong tên miền. */
const BRAND_WORDS = [
  'vneid', 'dichvucong', 'etax', 'thue', 'bocongan', 'congan', 'evn', 'baohiem', 'bhxh',
  'vietcombank', 'vcb', 'techcombank', 'mbbank', 'agribank', 'bidv', 'vietinbank', 'tpbank', 'acb', 'sacombank', 'vpbank',
  'shopee', 'lazada', 'tiktok', 'momo', 'zalopay', 'viettel', 'vinaphone', 'mobifone',
];
/** Tên miền chính thức và tên miền con. Không thêm nền tảng ai cũng tạo được trang như Google Sites, Forms. */
const OFFICIAL_SUFFIXES = [
  'gov.vn', 'vneid.gov.vn', 'vietcombank.com.vn', 'techcombank.com', 'mbbank.com.vn', 'agribank.com.vn', 'bidv.com.vn',
  'vietinbank.vn', 'tpb.vn', 'acb.com.vn', 'sacombank.com.vn', 'vpbank.com.vn', 'shopee.vn', 'lazada.vn', 'tiktok.com',
  'momo.vn', 'zalopay.vn', 'viettel.vn', 'vinaphone.com.vn', 'mobifone.vn', 'evn.com.vn', 'baohiemxahoi.gov.vn',
  'viettel.com.vn', 'vietteltelecom.vn', 'viettelmoney.vn', 'tv360.vn', 'garena.vn',
];
/** Link ứng dụng chính thức trên dịch vụ link động dùng chung (page.link, go.link): chỉ tin đúng host này. */
const OFFICIAL_HOSTS = ['myvt.page.link', 'mymobifone.page.link', 'myviettel.go.link', 'viettelmoney.go.link'];
/** Trang phổ biến, nhắc tới khi đang tự xưng đơn vị khác không phải là dấu hiệu lệch. */
const COMMON_HOSTS = ['facebook.com', 'fb.com', 'messenger.com', 'youtube.com', 'youtu.be', 'zalo.me', 'google.com'];
const KEYWORD = /(xac-?minh|xac-?thuc|verify|otp|login|dang-?nhap|khoa-?tai-?khoan|nhan-?qua|trung-?thuong|hoan-?tien|bao-?mat)/i;

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith('.' + suffix);
const isOfficialHost = (host: string) => OFFICIAL_HOSTS.includes(host) || OFFICIAL_SUFFIXES.some((s) => hostMatches(host, s));

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

const OFFICIAL_LABELS = [...new Set(OFFICIAL_SUFFIXES.map((s) => s.split('.')[0]!))].filter((l) => l.length >= 6);
const unconfuse = (s: string) => s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/1/g, 'l').replace(/-/g, '');

function lookalike(domain: string): string | undefined {
  const label = unconfuse(domain.split('.')[0]!);
  // Tên chính thức đã được loại trước khi gọi hàm này, nên giống hệt sau khi quy đổi cũng là giả chữ (vietc0mbank).
  return OFFICIAL_LABELS.find((t) => distance(label, t) <= (t.length < 8 ? 1 : 2));
}

/** Host viết bằng chữ giả: trộn Latin với Cyrillic hoặc Hy Lạp. */
const hasMixedScript = (host: string) => /[a-z]/i.test(host) && /[Ͱ-ϿЀ-ӿ]/.test(host);

/** Bỏ thông tin đăng nhập, query, fragment. Dùng để hiển thị hoặc gửi đi. */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(/^[a-z][a-z0-9+-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    const path = u.pathname === '/' ? '' : u.pathname.slice(0, 200);
    return `${u.protocol === 'http:' && !/^http:/i.test(raw) ? '' : `${u.protocol}//`}${u.host}${path}`;
  } catch {
    return raw.split(/[?#]/)[0]!.slice(0, 200);
  }
}

function levelOf(high: number, medium: number, weak: number): LinkLevel {
  if (high) return 'high';
  if (medium || weak >= 2) return 'medium';
  return weak ? 'weak' : 'none';
}

/** Trả về null nếu không phải đường link. */
export function analyzeUrl(raw: string): LinkFinding | null {
  const text = raw.replace(/[​-‍﻿]/g, '').trim();
  const scheme = /^([a-z][a-z0-9+-]*):(?!\d)/i.exec(text)?.[1]?.toLowerCase();
  if (scheme && ['tel', 'sms', 'smsto', 'mailto'].includes(scheme)) return null;
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return { url: `${scheme}:`, host: '', domain: null, level: 'high', reasons: ['mở ứng dụng hoặc chạy mã thay vì mở trang web'], official: false, shortener: false };
  }
  let u: URL;
  try {
    u = new URL(scheme ? text : `http://${text}`);
  } catch {
    // Có scheme mà không đọc được, ví dụ punycode sai: trình duyệt có thể xử lý khác nên vẫn coi là đáng ngờ.
    if (!scheme) return null;
    return { url: sanitizeUrl(text), host: '', domain: null, level: 'medium', reasons: ['địa chỉ link không hợp lệ'], official: false, shortener: false };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const parsed = parse(host, { allowPrivateDomains: true });
  if (!scheme && !parsed.isIp && !parsed.isIcann && !parsed.isPrivate) return null;
  const rawHost = /^(?:https?:\/\/)?(?:[^/@]*@)?([^/:?#]+)/i.exec(text)?.[1] ?? host;
  const domain = parsed.domain ?? host;
  const official = isOfficialHost(host);
  const shortener = SHORTENERS.includes(host);
  const apk = /\.apk$/i.test(u.pathname);
  const high: string[] = [];
  const medium: string[] = [];
  const weak: string[] = [];

  if (u.username) {
    const inUser = BRAND_WORDS.some((b) => u.username.toLowerCase().includes(b));
    (inUser ? high : medium).push(inUser ? 'giả tên đơn vị ở phần trước dấu @, đích thật là trang khác' : 'có dấu @ trong link, đích thật nằm sau dấu @');
  }
  if (apk) high.push('link tải trực tiếp file .apk');

  let brand: string | undefined;
  if (!official) {
    if (parsed.isIp) medium.push('dùng địa chỉ số thay cho tên miền');
    if (hasMixedScript(rawHost)) high.push('tên miền trộn chữ giả giống chữ Latin');
    if (/(^|\.)xn--/.test(host)) medium.push('tên miền dùng ký tự đặc biệt có thể giả chữ khác');
    if (shortener) medium.push('link rút gọn che giấu đích đến');
    // So trên phần tên đã bỏ đuôi (.vn, .com.vn…), tránh "agame.vn" bị coi là giống "evn"
    const flat = domain.slice(0, domain.length - (parsed.publicSuffix?.length ?? 0)).replace(/[.-]/g, '') + host.slice(0, Math.max(0, host.length - domain.length)).replace(/[.-]/g, '');
    brand = BRAND_WORDS.find((b) => flat.includes(b));
    if (!parsed.isIp && !shortener) {
      if (brand) high.push(`tên miền giống "${brand}" nhưng không phải trang chính thức`);
      else {
        const like = lookalike(domain);
        if (like) {
          brand = like;
          high.push(`tên miền gần giống "${like}" nhưng không phải trang chính thức`);
        }
      }
    }
    const tld = parsed.publicSuffix?.split('.').pop() ?? '';
    if (ABUSED_TLDS.has(tld)) medium.push(`tên miền đuôi .${tld} thường dùng cho trang tạm`);
    if (COMMON_NEW_TLDS.has(tld)) weak.push(`tên miền đuôi .${tld}, cần xem kỹ đơn vị`);
    if (KEYWORD.test(host + u.pathname)) weak.push('đường dẫn có từ như đăng nhập, xác minh');
    if (u.port && u.port !== '80' && u.port !== '443') weak.push('dùng cổng lạ');
    if (parsed.subdomain && parsed.subdomain.split('.').length > 3) weak.push('có quá nhiều tên miền con');
  }
  return {
    url: sanitizeUrl(text),
    host,
    domain,
    level: levelOf(high.length, medium.length, weak.length),
    reasons: [...high, ...medium, ...weak].slice(0, 4),
    official,
    shortener,
    ...(brand ? { brand } : {}),
  };
}

const SCHEME_URL = /\b(?:https?|intent|market):\/\/[^\s<>"'`]+/giu;
const BARE_URL = /(?<![\p{L}\p{N}@._/-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,24}(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/gu;
const trimTail = (s: string) => s.replace(/[.,;:!?)\]}]+$/, '');

/** Các chuỗi trông như link trong văn bản. Tên miền trần chỉ giữ khi đuôi có thật, để "ok.nha", "1.5" không bị tính. */
export function findUrls(text: string): string[] {
  const withScheme = [...text.matchAll(SCHEME_URL)].map((m) => trimTail(m[0]));
  const rest = text.replace(SCHEME_URL, ' ');
  const bare = [...rest.matchAll(BARE_URL)].map((m) => trimTail(m[0])).filter((u) => analyzeUrl(u) !== null);
  return [...withScheme, ...bare];
}

const RANK: Record<LinkLevel, number> = { high: 3, medium: 2, weak: 1, none: 0 };

/**
 * Gộp theo host: Messenger hiện cùng một trang hai lần (link đầy đủ và dòng tên miền của thẻ xem trước).
 * Giữ bản nặng hơn, bằng nhau thì giữ bản có đường dẫn dài hơn.
 */
function keepOnePerHost(seen: Map<string, LinkFinding>, f: LinkFinding) {
  const key = f.host || f.url;
  const old = seen.get(key);
  if (!old || RANK[f.level] > RANK[old.level] || (RANK[f.level] === RANK[old.level] && f.url.length > old.url.length)) seen.set(key, f);
}

export function messageLinks(m: ChatMessage): LinkFinding[] {
  const seen = new Map<string, LinkFinding>();
  const fromQr = (m.qr ?? []).filter((p) => /^https?:\/\//i.test(p.trim()));
  for (const raw of [...findUrls(m.text), ...(m.links ?? []), ...fromQr]) {
    const f = analyzeUrl(unwrapFacebookLink(raw));
    if (f) keepOnePerHost(seen, f);
  }
  return [...seen.values()];
}

/** Danh sách link của đối phương để hiển thị, nặng nhất trước, mỗi host một dòng. */
export function linkFindings(messages: ChatMessage[], limit = 8): LinkFinding[] {
  const seen = new Map<string, LinkFinding>();
  for (const m of messages) {
    if (m.sender === 'self') continue;
    for (const f of messageLinks(m)) keepOnePerHost(seen, f);
  }
  return [...seen.values()].sort((a, b) => RANK[b.level] - RANK[a.level]).slice(0, limit);
}

/** Link không phải của đơn vị đang được tự xưng: không chính thức và không phải trang phổ biến. */
export function isUnrelatedLink(f: LinkFinding): boolean {
  return !f.official && !COMMON_HOSTS.some((h) => hostMatches(f.host, h));
}
