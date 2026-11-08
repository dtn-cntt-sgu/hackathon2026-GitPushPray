// Chuẩn hoá văn bản trước khi gửi model. Không viết lại nội dung: chỉ NFC, bỏ ký tự
// vô hình/bidi và gộp khoảng trắng. Trích dẫn vẫn khớp vì parse dùng bản đã gửi.

const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

const TEENCODE = new Set([
  'k', 'ko', 'kh', 'khum', 'hok', 'hem', 'hông', 'hong', 'chx', 'chả', 'cha', 'chưa',
  'mk', 'mik', 't', 'm', 'bn', 'b', 'ae', 'mn', 'ngta', 'ổng', 'ong', 'bả', 'ba',
  'ib', 'inbox', 'rep', 'rpl', 'seen', 'tele', 'zalo', 'vib', 'call',
  'ck', 'stk', 'cọc', 'coc', 'kèo', 'keo', 'xị', 'xi', 'lít', 'lit', 'cây', 'cay', 'chỉ', 'chi', 'tr', 'k',
  'nv', 'hs', 'cmnd', 'cccd', 'hc', 'passport', 'visa',
  'kn', 'kpi', 'đa cấp', 'da cap', 'tuyến dưới', 'tuyen duoi', 'hoa hồng', 'hoa hong', 'chốt đơn', 'chot don',
  'otp', 'pin', 'usdt', 'ví', 'vi', 'sàn', 'san', 'nạp', 'nap', 'rút', 'rut', 'phí', 'phi',
  'nay', 'mai', 'gấp', 'gap', 'luôn', 'luon',
]);

export function stripInvisible(input: string): string {
  return input.normalize('NFC').replace(INVISIBLE, '');
}

export function cleanForModel(input: string): string {
  return stripInvisible(input).replace(/\s+/g, ' ').trim();
}

/** Che PII lần hai ở gateway, dùng chung một hàm với client để hai phía không lệch nhau. */
export { maskPii } from '@safechat/core/ai';

export function truncateChars(input: string, max: number): string {
  return input.length <= max ? input : input.slice(0, max);
}

/** Ước lượng token theo quy ước của gateway: ceil(tổng ký tự / 2). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 2);
}

export function teencodeDensity(input: string): number {
  const words = input.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let hits = 0;
  for (const w of words) if (TEENCODE.has(w)) hits++;
  return hits / words.length;
}

const LEAK_MARKERS = [
  'bạn là bộ phân tích rủi ro',
  'ban la bo phan tich rui ro',
  '<transcript>',
  '<rule_signals>',
  'ai_system_prompt',
  'output contract',
  'ignore previous instructions',
  'bỏ qua hướng dẫn',
  'bo qua huong dan',
  'system prompt',
];

export function containsPromptLeak(input: string): boolean {
  const lower = input.toLowerCase();
  return LEAK_MARKERS.some((m) => lower.includes(m));
}
