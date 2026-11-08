// Phân loại nội dung mã QR và đọc VietQR, chỉ chạy trên máy. Không tự mở nội dung QR.
// Cấu trúc VietQR theo chuẩn EMVCo mà Napas áp dụng; chưa đối chiếu được với bản đặc tả gốc của Napas.
import { maskPii } from './ai';
import { analyzeUrl, findUrls } from './link';
import type { ChatMessage, QrFinding, QrKind } from './types';

/** CRC-16/CCITT-FALSE: đa thức 0x1021, khởi tạo 0xFFFF. Giá trị kiểm tra của "123456789" là 0x29B1. */
export function crc16(text: string): number {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function readTlv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i + 4 <= text.length) {
    const tag = text.slice(i, i + 2);
    const len = Number(text.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(text.slice(i + 2, i + 4)) || i + 4 + len > text.length) break;
    out.set(tag, text.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

export interface VietQr {
  bin?: string;
  account?: string;
  /** Chỉ còn 4 số cuối. */
  accountMasked?: string;
  amount?: number;
  currency?: string;
  merchantName?: string;
  purpose?: string;
  crcValid: boolean;
}

/** Trả về null nếu không phải mã thanh toán theo chuẩn EMVCo. */
export function parseVietQr(payload: string): VietQr | null {
  if (!payload.startsWith('000201')) return null;
  const top = readTlv(payload);
  if (!top.has('00')) return null;
  const crcAt = payload.lastIndexOf('6304');
  const crcValid =
    crcAt >= 0 && crcAt + 8 === payload.length && crc16(payload.slice(0, crcAt + 4)).toString(16).toUpperCase().padStart(4, '0') === payload.slice(crcAt + 4).toUpperCase();
  const beneficiary = readTlv(readTlv(top.get('38') ?? '').get('01') ?? '');
  const account = beneficiary.get('01');
  const amount = Number(top.get('54'));
  const purpose = readTlv(top.get('62') ?? '').get('08');
  return {
    crcValid,
    ...(beneficiary.get('00') ? { bin: beneficiary.get('00') } : {}),
    ...(account ? { account, accountMasked: `***${account.slice(-4)}` } : {}),
    ...(top.get('54') && Number.isFinite(amount) ? { amount } : {}),
    ...(top.get('53') ? { currency: top.get('53') === '704' ? 'đ' : top.get('53') } : {}),
    ...(top.get('59') ? { merchantName: top.get('59') } : {}),
    ...(purpose ? { purpose } : {}),
  };
}

const safeText = (s: string, max = 120) => maskPii(s).replace(/\s+/g, ' ').trim().slice(0, max);
const INSTALL = /^(intent|market):\/\//i;
const CRYPTO = /^(bitcoin|ethereum|litecoin|tron|usdt):|^0x[a-f0-9]{40}$|^T[A-HJ-NP-Za-km-z1-9]{33}$|^bc1[a-z0-9]{20,}$/i;

const finding = (kind: QrKind, label: string, level: QrFinding['level'], reasons: string[], details: QrFinding['details'] = [], extra: Partial<QrFinding> = {}): QrFinding => ({
  kind,
  label,
  level,
  reasons,
  details,
  ...extra,
});

export function classifyQr(rawPayload: string): QrFinding {
  const payload = rawPayload.trim().slice(0, 4096);
  if (INSTALL.test(payload) || /^https?:\/\/\S+\.apk(\?|$)/i.test(payload)) {
    return finding('install', 'QR cài ứng dụng', 'high', ['Mã này mở thẳng việc cài ứng dụng, có thể là ứng dụng độc hại.']);
  }
  const vietQr = parseVietQr(payload);
  if (vietQr) {
    const details: QrFinding['details'] = [];
    if (vietQr.amount !== undefined) details.push({ label: 'Số tiền', value: `${vietQr.amount.toLocaleString('vi-VN')}${vietQr.currency ?? ''}` });
    if (vietQr.accountMasked) details.push({ label: 'Tài khoản', value: vietQr.accountMasked });
    if (vietQr.bin) details.push({ label: 'Mã ngân hàng', value: vietQr.bin });
    if (vietQr.merchantName) details.push({ label: 'Người nhận', value: safeText(vietQr.merchantName, 60) });
    if (vietQr.purpose) details.push({ label: 'Nội dung', value: safeText(vietQr.purpose, 80) });
    const reasons = ['Đây là yêu cầu chuyển tiền. Kiểm tra đúng người nhận trước khi quét.'];
    if (!vietQr.crcValid) reasons.unshift('Mã kiểm tra của QR không khớp, có thể bị sửa hoặc hỏng.');
    return finding('payment', 'QR chuyển tiền', vietQr.crcValid ? 'none' : 'medium', reasons, details, { crcValid: vietQr.crcValid, ...(vietQr.purpose ? { purpose: vietQr.purpose } : {}) });
  }
  if (/^https?:\/\//i.test(payload) || (findUrls(payload).length === 1 && findUrls(payload)[0] === payload)) {
    const link = analyzeUrl(payload);
    if (link) {
      return finding('url', 'QR chứa link', link.level, [...link.reasons, 'Mã QR che đích đến nên khó thấy trước khi mở.'].slice(0, 4), [{ label: 'Tên miền', value: link.domain ?? link.url }], { url: link.url });
    }
  }
  if (CRYPTO.test(payload)) return finding('crypto', 'QR ví tiền ảo', 'medium', ['Giao dịch tiền ảo gần như không thể lấy lại khi bị lừa.']);
  if (/^WIFI:/i.test(payload)) {
    const ssid = /(?:^WIFI:|;)S:((?:[^;\\]|\\.)*)/i.exec(payload)?.[1] ?? '';
    return finding('wifi', 'QR kết nối Wi-Fi', 'none', ['Chỉ kết nối mạng bạn tin tưởng.'], ssid ? [{ label: 'Tên mạng', value: safeText(ssid, 60) }] : []);
  }
  if (/^(tel|sms|smsto|mailto):/i.test(payload)) return finding('contact', 'QR gọi hoặc nhắn tin', 'none', ['Mã này mở cuộc gọi hoặc tin nhắn. Kiểm tra số trước khi gửi.'], [{ label: 'Đích', value: safeText(payload, 60) }]);
  if (/^BEGIN:VCARD/i.test(payload)) return finding('vcard', 'QR danh thiếp', 'none', [], []);
  return finding('text', 'QR chứa văn bản', 'none', [], [{ label: 'Nội dung', value: safeText(payload) }]);
}

const RANK = { high: 3, medium: 2, weak: 1, none: 0 } as const;

/** Mã QR của đối phương để hiển thị, nặng nhất trước. */
export function qrFindings(messages: ChatMessage[], limit = 6): QrFinding[] {
  const seen = new Set<string>();
  const out: QrFinding[] = [];
  for (const m of messages) {
    if (m.sender === 'self') continue;
    for (const p of m.qr ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(classifyQr(p));
    }
  }
  return out.sort((a, b) => RANK[b.level] - RANK[a.level]).slice(0, limit);
}
