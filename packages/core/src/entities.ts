// Bóc tách thực thể từ văn bản GỐC của tin nhắn (không bỏ dấu): đường link, file .apk, ví crypto,
// số tài khoản, số điện thoại. Dùng để sinh tín hiệu kỹ thuật và làm ngữ cảnh cho luật khác.

import { analyzeUrl, findUrls } from './link';
import type { LinkLevel } from './types';

export interface Entities {
  urls: string[];
  /** Link có dấu hiệu. `level` weak là dấu hiệu nhẹ, không làm tăng mức cảnh báo. */
  suspiciousUrls: { url: string; reason: string; level: LinkLevel }[];
  /** Link mời sang kênh kín (t.me, zalo.me…). */
  channelLinks: string[];
  apk: boolean;
  cryptoWallets: string[];
  bankAccounts: string[];
  phones: string[];
}

const CHANNEL_HOSTS = ['t.me', 'telegram.me', 'zalo.me', 'wa.me', 'line.me'];

export function extractEntities(text: string): Entities {
  const lower = text.toLowerCase();
  const urls: string[] = [];
  const suspiciousUrls: Entities['suspiciousUrls'] = [];
  const channelLinks: string[] = [];
  for (const url of findUrls(lower)) {
    const found = analyzeUrl(url);
    if (!found) continue;
    urls.push(url);
    if (CHANNEL_HOSTS.includes(found.host)) channelLinks.push(url);
    if (found.level !== 'none') suspiciousUrls.push({ url, reason: found.reasons[0] ?? '', level: found.level });
  }

  const apk = /\.apk\b|\bfile apk\b|\bapk\b/i.test(lower);
  const cryptoWallets = [...text.matchAll(/\bT[A-HJ-NP-Za-km-z1-9]{33}\b/g)].map((m) => m[0]);

  // Số điện thoại VN (0xx / +84) — có thể viết cách quãng
  const phones: string[] = [];
  const bankAccounts: string[] = [];
  for (const m of text.matchAll(/(?<![\d.,])(?:\+?84|0)?\d(?:[ .-]?\d){7,18}(?![\d.,]*\d)/g)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    if (/^(?:84|0)(?:3|5|7|8|9)\d{8}$/.test(digits.replace(/^\+/, ''))) phones.push(digits);
    else if (digits.length >= 8 && digits.length <= 19 && !/[.,]\d{3}$/.test(raw)) bankAccounts.push(digits);
  }
  return { urls, suspiciousUrls, channelLinks, apk, cryptoWallets, bankAccounts, phones };
}
