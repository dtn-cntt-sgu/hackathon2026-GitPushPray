// Chuyển các bộ dữ liệu NGOÀI (do nhóm khác công bố) sang BenchCase để chấm bộ luật/AI.
// Nhãn của các bộ này chỉ có 2 lớp: kind 'scam' (nên cảnh báo) / 'benign' (không nên cảnh báo).
// gold được đặt 'high' / 'low' chỉ để giữ kiểu dữ liệu — báo cáo ngoài (report-ext) chấm 2 lớp, KHÔNG chấm 4 mức.
import { parseCsv } from './csv';
import type { BenchCase } from './dataset';
import type { ChatMessage } from '@safechat/core/types';

export interface ExternalSource {
  name: string;
  title: string;
  url: string;
  license: string;
  /** Có được lưu bản chụp dữ liệu lên nhánh bằng chứng hay không (theo giấy phép). */
  redistributable: boolean;
  kind: 'sms' | 'call' | 'sentence';
  /** Sản phẩm chỉ cảnh báo dựa trên tin nhắn/đoạn chat; lời thoại cuộc gọi chỉ để tham khảo, không dùng để chỉnh luật. */
  inScope: boolean;
  notes: string[];
}

export const EXTERNAL_SOURCES: Record<string, ExternalSource> = {
  sms: {
    name: 'sms',
    title: 'Vietnamese Quality-Assured SMS Scam Dataset',
    url: 'https://github.com/trannguyenthaituan251209/vietnamese_sms_dataset',
    license: 'CC BY 4.0',
    redistributable: true,
    kind: 'sms',
    inScope: true,
    notes: [
      'SMS thật đã ẩn danh (token [PHONE], [BANK_ACC]…). Nhãn 1 gộp cả tin rác/quảng cáo lẫn lừa đảo — tỷ lệ "bắt được" trên nhãn 1 thấp không hẳn là lỗi vì sản phẩm không nhắm tới quảng cáo.',
      'Mỗi tin là một ca 1 tin, người gửi = đối phương.',
      'Token [MONEY] được thay bằng giá trị mẫu theo ngữ cảnh (hạn mức/vay/thưởng/quà → 10.000.000đ; lương/thu nhập/hoa hồng → 500.000đ; còn lại → 50.000đ) để luật dựa vào số tiền chạy được. Các token khác ([NUMBER], [TIME]…) giữ nguyên.',
    ],
  },
  tele28k: {
    name: 'tele28k',
    title: 'TeleAntiFraud-28k (bản dịch + Việt hóa trong hoangvt2501/data_scam)',
    url: 'https://github.com/hoangvt2501/data_scam',
    license: 'Không ghi giấy phép (repo) — dữ liệu gốc TeleAntiFraud-28k, điều khoản chưa rõ',
    redistributable: false,
    kind: 'call',
    inScope: false,
    notes: [
      'Lời thoại CUỘC GỌI dịch máy từ tiếng Trung rồi Việt hóa — ngoài phạm vi sản phẩm (chỉ tin nhắn/chat), chỉ để tham khảo, không dùng để chỉnh luật.',
      '"người gọi" = đối phương, "người nghe"/"người nhận" = người dùng. Lừa đảo lệch về "vay vốn" (~65%).',
    ],
  },
  scamtext: {
    name: 'scamtext',
    title: 'scamtext_dataset.txt (vietkemmai/Data_voice_AI_human_scam)',
    url: 'https://huggingface.co/datasets/vietkemmai/Data_voice_AI_human_scam',
    license: 'Chỉ nghiên cứu, phi thương mại (theo README; không có file giấy phép)',
    redistributable: false,
    kind: 'sentence',
    inScope: false,
    notes: [
      'Câu lẻ chép từ LỜI THOẠI CUỘC GỌI (README nguồn: "transcribed speech content") — ngoài phạm vi sản phẩm (chỉ tin nhắn/chat), chỉ để tham khảo.',
      'Nhãn theo CÂU lẻ trích từ hội thoại: câu nhãn "scam" có thể chỉ là câu làm quen, không chứa dấu hiệu → recall thấp là kỳ vọng; báo nhầm trên câu "normal" mới là chỉ số chính.',
      'Mỗi câu là một ca 1 tin, người gửi = đối phương. Câu trùng nội dung chỉ giữ 1.',
    ],
  },
};

const msg = (i: number, sender: ChatMessage['sender'], text: string): ChatMessage => ({
  id: `msg-${String(i + 1).padStart(3, '0')}`,
  seq: i + 1,
  sender,
  text,
});

const one = (id: string, text: string, scam: boolean, source: string, category: string, group: number): BenchCase => ({
  id,
  group,
  kind: scam ? 'scam' : 'benign',
  gold: scam ? 'high' : 'low',
  messages: [msg(0, 'other', text)],
  tags: [category],
  source,
});

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const BIG_MONEY_CONTEXT = /\b(han muc|vay|giai ngan|khoan|len (den|toi)|trung|thuong|tri an|qua|tang|so du|nhan ngay)\b\W*(\S+\W+){0,3}$/;
// "chất lượng", "lưu lượng", "dung lượng", "trọng lượng" bỏ dấu cũng thành "luong" → loại ra
const PAY_CONTEXT = /\b((?<!(chat|luu|dung|trong) )luong|thu nhap|hoa hong|tien cong)\b\W*(\S+\W+){0,3}$/;
/**
 * Bộ SMS ẩn danh số tiền thành [MONEY], làm các luật dựa vào số tiền không chạy được.
 * Thay bằng giá trị mẫu theo ngữ cảnh ngay trước token (cố định, tái lập được):
 * hạn mức/vay/thưởng/quà… → 10.000.000đ; lương/thu nhập/hoa hồng → 500.000đ; còn lại (cước, phí, giá) → 50.000đ.
 */
export function fillMoneyTokens(text: string): string {
  return text.replace(/\[MONEY\]/g, (_m, offset: number) => {
    const before = plain(text.slice(Math.max(0, offset - 40), offset));
    if (PAY_CONTEXT.test(before)) return '500.000đ';
    if (BIG_MONEY_CONTEXT.test(before)) return '10.000.000đ';
    return '50.000đ';
  });
}

export function convertSms(csvText: string): BenchCase[] {
  const { header, rows } = parseCsv(csvText);
  if (!header.includes('message') || !header.includes('label')) throw new Error('SMS: thiếu cột message/label');
  return rows
    .map((r) => r.values)
    .filter((v) => (v.message ?? '').trim())
    .map((v, k) => {
      const scam = (v.label ?? '').trim() === '1';
      return one(`SMS_${(v.message_id || String(k + 1)).trim()}`, fillMoneyTokens(v.message!.trim()), scam, 'ext:sms', scam ? 'rac_hoac_lua_dao' : 'binh_thuong', scam ? 1 : 0);
    });
}

interface Dialogue {
  _id: number;
  label_name?: string;
  dialogue: { role: string; content: string }[];
}

export function convertTele(scam: Dialogue[], harmless: Dialogue[]): BenchCase[] {
  const cats = [...new Set(scam.map((d) => d.label_name ?? 'khac'))].sort();
  const toCase = (d: Dialogue, isScam: boolean): BenchCase => ({
    id: `${isScam ? 'TELE_S' : 'TELE_H'}_${String(d._id).padStart(5, '0')}`,
    group: isScam ? 1 + cats.indexOf(d.label_name ?? 'khac') : 0,
    kind: isScam ? 'scam' : 'benign',
    gold: isScam ? 'high' : 'low',
    messages: d.dialogue
      .filter((t) => (t.content ?? '').trim())
      .map((t, i) => msg(i, /^người gọi/i.test(t.role.trim()) ? 'other' : 'self', t.content.trim())),
    tags: [isScam ? (d.label_name ?? 'khac') : 'binh_thuong'],
    source: 'ext:tele28k',
  });
  return [...scam.map((d) => toCase(d, true)), ...harmless.map((d) => toCase(d, false))].filter((c) => c.messages.length);
}

export function convertScamtext(text: string): BenchCase[] {
  const seen = new Set<string>();
  const out: BenchCase[] = [];
  let k = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^__label__(scam|normal)\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const t = m[2]!.trim();
    if (seen.has(t)) continue;
    seen.add(t);
    const scam = m[1] === 'scam';
    out.push(one(`STX_${String(++k).padStart(5, '0')}`, t, scam, 'ext:scamtext', scam ? 'cau_lua_dao' : 'cau_binh_thuong', scam ? 1 : 0));
  }
  return out;
}
