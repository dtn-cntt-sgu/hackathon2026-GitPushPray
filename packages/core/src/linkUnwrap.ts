// Tách riêng để content script dùng được mà không kéo theo bộ dữ liệu tên miền của link.ts.
const FACEBOOK_WRAP = /^(l|lm)\.facebook\.com$|^l\.messenger\.com$/;

/** Gỡ link bọc của Facebook để xem đúng đích đến. */
export function unwrapFacebookLink(href: string): string {
  try {
    const u = new URL(href);
    if (FACEBOOK_WRAP.test(u.hostname)) return u.searchParams.get('u') || href;
  } catch {
    // giữ nguyên nếu không phân tích được
  }
  return href;
}
