// Đọc mã QR ngay trong trang từ ảnh của đoạn chat đã khóa. Không tải ảnh về, không gửi và không lưu byte ảnh.
// Thử trên Messenger: ảnh tin nhắn là data:, kích thước gốc 148 hoặc 1000 px, canvas đọc được; ảnh đại diện hiển thị 60 px hoặc nhỏ hơn.
import jsQR from 'jsqr';

const MIN_SIZE = 80;
const MAX_FIRST = 1024;
const MAX_SECOND = 2048;
const MAX_PAYLOAD = 4096;
/** Giới hạn mỗi lần đọc để không làm giật trang. Ảnh còn lại xử lý ở lần sau. */
const MAX_DECODES_PER_READ = 3;
const CACHE_SIZE = 200;

const cache = new Map<string, string | null>();
let enabled = true;
let budget = MAX_DECODES_PER_READ;
let pending = false;

export function setQrEnabled(on: boolean) {
  enabled = on;
}

/** Gọi đầu mỗi lần đọc tin. */
export function beginQrRead() {
  budget = MAX_DECODES_PER_READ;
  pending = false;
}

/** Còn ảnh chưa tải xong hoặc vượt giới hạn, cần đọc lại sau. */
export const qrPending = () => pending;

/** Lần đọc vừa rồi có giải mã được thêm ảnh nào không. */
export const qrMadeProgress = () => budget < MAX_DECODES_PER_READ;

function keyOf(src: string): string {
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return `${src.length}:${h >>> 0}`;
}

function tryDecode(img: HTMLImageElement, maxSide: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

function decode(img: HTMLImageElement): string | null {
  try {
    const first = tryDecode(img, MAX_FIRST);
    if (first !== null) return first;
    return Math.max(img.naturalWidth, img.naturalHeight) > MAX_FIRST ? tryDecode(img, MAX_SECOND) : null;
  } catch {
    // Ảnh khác nguồn làm canvas bị khóa: coi như không đọc được, không báo lỗi.
    return null;
  }
}

/** Nội dung các mã QR trong phần tử, bỏ ảnh đại diện và biểu tượng theo kích thước. */
export function qrIn(root: Element): string[] {
  if (!enabled) return [];
  const out: string[] = [];
  for (const img of root.querySelectorAll('img')) {
    const box = img.getBoundingClientRect();
    if (box.width < MIN_SIZE || box.height < MIN_SIZE) continue;
    const src = img.currentSrc || img.src;
    if (!src) continue;
    const key = keyOf(src);
    if (!cache.has(key)) {
      if (!img.complete || img.naturalWidth === 0 || budget <= 0) {
        pending = true;
        continue;
      }
      budget--;
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, decode(img));
    }
    const value = cache.get(key);
    if (value) out.push(value.slice(0, MAX_PAYLOAD));
  }
  return [...new Set(out)];
}
