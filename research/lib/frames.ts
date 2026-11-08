// Thử nghiệm nghiên cứu, CHƯA dùng trong sản phẩm: suy luận theo KHUNG Ý ĐỊNH thay vì theo mẫu câu.
// Ý tưởng: lừa đảo khác nhau ở câu chữ nhưng giống nhau ở cấu trúc: có YÊU CẦU gây hại, có CỚ để tin, có SỨC ÉP.
// Luật mẫu câu nhắm vào cách nói cụ thể; khung này dùng từ vựng rộng theo từng vai trò rồi xét tổ hợp cả hội thoại.
import { normalizeForMatch } from '@safechat/core/normalize';
import { isProtectiveWarning } from '@safechat/core/rules/warning';
import type { ChatMessage, RiskLevel } from '@safechat/core/types';

export const FRAME_VERSION = 'frames-v1';

export type Frame =
  | 'ask_money'
  | 'ask_secret'
  | 'ask_identity'
  | 'ask_install'
  | 'ask_travel'
  | 'pretext_reward'
  | 'pretext_authority'
  | 'pressure'
  | 'threat'
  | 'isolation';

const FRAME_PATTERNS: Record<Frame, RegExp[]> = {
  ask_money: [
    /\b(chuyen khoan|chuyen tien|chuyen|nap|dong|thanh toan|gop von|dat coc|coc|ung)\b.{0,45}\b(\d+(?:[.,]\d+)? (nghin|trieu|ty)|so tai khoan|tai khoan|ma qr|usdt|phi|tien coc)\b/,
    /\b(so tai khoan|ma qr)\b.{0,30}\b(chuyen|nap|thanh toan|dong)\b/,
    /\b(nap|dong|chuyen)\b.{0,12}\b(them|du|truoc|ngay)\b/,
  ],
  ask_secret: [
    /\b(doc|gui|cung cap|nhap|bao|cho)\b.{0,30}\b(otp|ma (xac nhan|xac thuc|kich hoat|dang nhap|\d so|do|vua nhan)|mat khau|ma pin|cvv)\b/,
    /\b(dang nhap|xac thuc)\b.{0,25}\b(tai khoan|facebook|zalo|ngan hang|link|trang)\b/,
  ],
  ask_identity: [
    /\b(gui|chup|nop|giao|mang|cung cap|xin|giu)\b.{0,30}\b(can cuoc|chung minh|ho chieu|giay to|anh chan dung|khuon mat|bang lai|the ngan hang)\b/,
  ],
  ask_install: [
    /\b(tai|cai|cai dat|bam|nhan|vao|truy cap|mo|quet)\b.{0,25}\b(link|duong dan|app|ung dung|phan mem|apk|ma qr|https?)\b/,
    /\b(bat|cap)\b.{0,12}\bquyen\b/,
  ],
  ask_travel: [
    /\b(sang|qua|di|xuong|len|ra|xuat canh)\b.{0,15}\b(bien gioi|cua khau|nuoc ngoai|campuchia|myanmar|lao|dubai|tinh khac)\b/,
    /\b(don|dua)\b.{0,10}\b(em|ban|chau|chi|tan noi)\b/,
    /\b(ho chieu|ve may bay|tien xe|theo doan|co nguoi don)\b/,
  ],
  pretext_reward: [
    /\b(hoa hong|loi nhuan|lai suat|thu nhap|luong|thuong|trung thuong|hoan (tien|von|lai|\d)|rut (duoc|tien)|giai ngan|nhiem vu|viec nhe|cam ket)\b/,
  ],
  pretext_authority: [
    /\b(cong an|vien kiem sat|toa an|can bo|dieu tra|ngan hang|thue|nha mang|cskh|cham soc khach hang|bao hiem|luat su|shipper|buu cuc|he thong|hai quan|xa |phuong )\b/,
  ],
  pressure: [
    /\b(gap|ngay bay gio|ngay lap tuc|trong hom nay|toi nay|hom nay|qua \d+|het han|han cuoi|con \d+ (ngay|gio|phut)|keo mat|suat co han|nhanh)\b/,
    /\b(neu khong|khong thi|mat het|mat (suat|tien|quyen loi)|bi (khoa|loai|huy|phat))\b/,
  ],
  threat: [
    /\b(bao cong an|khoi to|bat giam|kien|truy cuu|ra tay|lieu hon|gui (thang|anh|cho (nguoi than|lanh dao|gia dinh))|goi cho (nguoi than|dong nghiep|gia dinh)|phat tan|len mang|tien doi lay)\b/,
  ],
  isolation: [
    /\b(dung|khong (duoc|nen)|cam) (noi|ke|bao|cho)\b.{0,15}\b(ai|gia dinh|bo me|nguoi than|thay|co|ban be)\b/,
    /\b(giu bi mat|bi mat|o mot minh|phong kin|xoa tin nhan)\b/,
  ],
};

const NEGATED = /\b(khong|chang|chua|mien|khoi|dung|da|vua)\s+(\S+\s+){0,2}$/;

function matches(re: RegExp, text: string): boolean {
  const g = new RegExp(re.source, 'g');
  for (const m of text.matchAll(g)) {
    if (!NEGATED.test(text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0))) return true;
  }
  return false;
}

export function framesOf(messages: ChatMessage[]): Set<Frame> {
  const found = new Set<Frame>();
  for (const m of messages) {
    if (m.sender === 'self') continue;
    const text = normalizeForMatch(m.text);
    if (isProtectiveWarning(text)) continue;
    for (const [frame, patterns] of Object.entries(FRAME_PATTERNS) as [Frame, RegExp[]][]) {
      if (patterns.some((re) => matches(re, text))) found.add(frame);
    }
  }
  return found;
}

/** Chấm mức từ tổ hợp khung: yêu cầu gây hại + cớ + sức ép. Quy tắc viết theo định nghĩa nhãn, không theo từng ca. */
export function frameLevel(messages: ChatMessage[]): RiskLevel {
  const f = framesOf(messages);
  const asks = (['ask_money', 'ask_secret', 'ask_identity', 'ask_install', 'ask_travel'] as Frame[]).filter((x) => f.has(x));
  const pretext = f.has('pretext_reward') || f.has('pretext_authority');
  const force = f.has('pressure') || f.has('threat') || f.has('isolation');

  if (asks.length && (f.has('threat') || f.has('isolation'))) return 'critical';
  if (asks.length >= 2 && pretext && force) return 'critical';
  if (asks.length && pretext && force) return 'high';
  if (asks.length >= 2 && pretext) return 'high';
  if (asks.length || (pretext && force)) return 'attention';
  return 'low';
}
