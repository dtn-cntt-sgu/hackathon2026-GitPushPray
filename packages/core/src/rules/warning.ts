// Nhận ra tin đang CẢNH BÁO hoặc DẶN DÒ về lừa đảo: người thân kể lại chiêu trò, cơ quan nhắc cảnh giác.
// Các tin này chứa đúng từ khóa của kịch bản nhưng không yêu cầu người nhận làm gì, nên không dùng làm bằng chứng.
// Kẻ gian có thể chèn câu cảnh báo để né luật, vì vậy chỉ bỏ qua khi tin KHÔNG xưng danh và KHÔNG yêu cầu hành động.

const WARNING_MARKER =
  /\b((ban (minh|toi|tao)|nguoi quen|hang xom|dong nghiep|nhieu nguoi|co nguoi) (da |vua |cung )?bi (lua|gat) (dat coc|coc|nap|chuyen|dong|mat)|canh giac|canh bao|chieu (lua dao|tro|gia danh)|thu doan|vu gia danh|chung no|ke gian|bon lua dao|khong bao gio (lam viec|doi|yeu cau)|tuyet doi khong (chup|doc|cung cap|chia se|gui))\b/;

/** Xưng danh: "tôi là…", "em là…", "bên mình là…". Kẻ gian thường tự giới thiệu ngay sau câu cảnh báo. */
const SELF_CLAIM = /\b(toi|minh|anh|em|chi|ben (em|minh)) la\b/;

/** Lời kể về kẻ gian hoặc lời dặn đứng ngay trước động từ thì không phải yêu cầu với người nhận. */
const NOT_A_REQUEST = String.raw`(?<!\b(doi|bat|ep|yeu cau|bao|khong|dung|neu|chung no|ke gian)\s+(\S+\s+){0,2})`;

const REQUEST_TO_RECEIVER = new RegExp(
  `${NOT_A_REQUEST}\\b(chuyen khoan|chuyen tien|chuyen toan bo|dat coc|nap|dong|gui|doc|cung cap|cai|tai|bam|nhap|quet)\\b.{0,40}\\b(cho (toi|em|anh|chi|minh|ben|tao)|vao (so tai khoan|tai khoan|link|day)|qua (so tai khoan|link)|tai khoan (an toan|nay)|so tai khoan \\d|link nay)\\b`,
);

const HAS_URL = /https?\s*:|www\s*\.|\b[a-z0-9-]+\s*\.\s*(example|com|net|xyz|top|click|info|org)\b/;

/** Xúi bỏ qua cảnh báo của điện thoại là yêu cầu nguy hiểm, không phải tin cảnh báo. */
const BYPASS_WARNING = /\b(bo qua|tat|phot lo|dung so|ke) (cac |cai |loi )?canh bao\b|\bcanh bao (bao mat|cua (google|dien thoai|may))\b/;

const LINK_WARNING = /\b(dung|khong nen|tranh) (bam|click|mo|truy cap|nhan)( vao)?\b|\b(dung|khong nen|tranh) vao\b/;
const LINK_WARNING_TOPIC = /\b(lua dao|canh bao|gia mao|doc hai)\b/;
const ASKS_TO_OPEN = /\b(bam|vao|click|mo|truy cap|nhan|dang nhap|nhap)\b/;

/** Tin nhắc đừng bấm vào link lừa đảo. Vẫn còn lời bảo bấm ở phần khác của tin thì không tính. */
export function isLinkWarning(normalized: string): boolean {
  if (!LINK_WARNING.test(normalized) || !LINK_WARNING_TOPIC.test(normalized) || SELF_CLAIM.test(normalized)) return false;
  const rest = normalized.replace(new RegExp(LINK_WARNING.source, 'g'), ' ');
  return !ASKS_TO_OPEN.test(rest);
}

/** `normalized` là văn bản đã qua normalizeForMatch. */
export function isProtectiveWarning(normalized: string): boolean {
  if (!WARNING_MARKER.test(normalized)) return false;
  if (SELF_CLAIM.test(normalized) || HAS_URL.test(normalized) || BYPASS_WARNING.test(normalized)) return false;
  return !REQUEST_TO_RECEIVER.test(normalized);
}
