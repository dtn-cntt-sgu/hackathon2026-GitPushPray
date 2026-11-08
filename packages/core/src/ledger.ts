// Claim Ledger (mục 8.2 kế hoạch): ghi nhận phát biểu quan trọng của đối phương theo loại,
// đối chiếu phát biểu mới với phát biểu cũ để chỉ ra điểm chưa nhất quán.
// Không phải mọi thay đổi đều là nói dối — câu chữ luôn là "chưa nhất quán, cần xác minh".

import { normalizeForMatch } from './normalize';
import { financeRules } from './rules/finance';
import { jobTermsRules } from './rules/jobTerms';
import { matchRule } from './rules/rule';
import type { ChatMessage, Claim, ClaimType, Signal } from './types';

const NO_FEE = [
  /\b(khong|mien) (thu|mat|ton|dong|lay|can dong|phai dong|can nop|phai nop)( bat ky| mot)?( khoan)? ?(phi|chi phi|le phi|tien|dong nao|xu nao)\b/,
  /\bmien phi\b/,
  /\bkhong (co )?(phi|chi phi) (gi|nao)\b/,
  /\b0 dong\b/,
];
const HAS_CONTRACT = [/\b(co|ky|day du|lam) hop dong\b/];
const CORRECTION = /\b(go nham|ghi nham|noi nham|nhap nham|nham (chut|xiu)|dinh chinh|sua lai|xin loi (minh|em|anh|chi) (nham|ghi))\b/;

const STOP = new Set(
  'o tai chuyen la ben co tuyen dang nhe nha nhe minh cua se thi va voi lam hien can muon dang chung toi toi em anh chi nay do kia ay nao khac lon nho cua ban ta ho rat cung moi vua chi duoc khong'.split(
    ' ',
  ),
);

const fee = financeRules.find((r) => r.type === 'upfront_fee')!;
const taskDeposit = financeRules.find((r) => r.type === 'task_deposit')!;
const noContract = jobTermsRules.find((r) => r.type === 'no_written_contract')!;

function quote(m: ChatMessage): string {
  const t = m.text.trim();
  return t.length > 220 ? t.slice(0, 217) + '…' : t;
}

/** Lấy cụm danh từ tối đa `max` từ sau vị trí bắt đầu, dừng ở từ dừng hoặc dấu câu. */
function takeName(rest: string, max: number): string {
  const words: string[] = [];
  for (const w of rest.split(' ')) {
    if (!w || /^[.,!?;:()"/%]$/.test(w) || STOP.has(w)) break;
    words.push(w);
    if (words.length >= max) break;
  }
  return words.join(' ');
}

/** Từ thường đứng sau "công ty" trong câu nói, không phải tên riêng ("công ty tuyệt đối không…", "tổng đài công ty in trên…"). */
const NOT_COMPANY_NAME = /^(tuyet|khong|chua|chi|da|dang|se|van|con|cung|luon|in|tren|cua|nay|do|kia|minh|ben|toi|thi|la|moi|co|cho|ve|o|tai|va|hay|neu|khi)\b/;

function extractCompany(n: string): string | null {
  const m = /\bcong ty (?:tnhh mtv |tnhh |co phan |cp )?(.*)$/.exec(n);
  if (!m) return null;
  const name = takeName(m[1] ?? '', 4);
  if (NOT_COMPANY_NAME.test(name)) return null;
  return name.length >= 2 ? name : null;
}

const GENERIC_LOCATION = new Set(['van phong', 'cong ty', 'nha', 'tru so', 'online', 'day', 'do', 'kia', 'xuong']);

/** Lấy địa điểm cụ thể cuối cùng trong tin, bỏ qua từ chung chung như "văn phòng", "nhà". */
function extractLocation(n: string): string | null {
  let found: string | null = null;
  for (const m of n.matchAll(/\b(?:lam viec|lam|dia diem|van phong|tru so|cho lam|di lam) (?:o|tai) /g)) {
    const name = takeName(n.slice((m.index ?? 0) + m[0].length), 4);
    if (name.length >= 2 && !GENERIC_LOCATION.has(name)) found = name;
  }
  return found;
}

const UNIT_PER_MONTH: Record<string, number> = { thang: 1, tuan: 4, ngay: 26, buoi: 26, gio: 208, tieng: 208 };

/** Trả về lương quy đổi theo tháng (đồng) nếu tin nhắn nói về lương/thu nhập. */
function extractMonthlySalary(n: string): number | null {
  // "kiem tra", "tra sua" không phải nói về lương
  if (!/\b(luong|thu nhap|hoa hong|tien thuong|tra (luong|cong|\d)|kiem (duoc|tien|\d))\b/.test(n)) return null;
  const m =
    /\b(\d+(?:[.,]\d+)?) (trieu|nghin)(?: ?(?:\/ ?|mot |moi |1 )(thang|tuan|ngay|buoi|gio|tieng))?/.exec(n) ??
    /\b(\d{1,3}(?:[.,]\d{3}){2,})(?: ?(?:d|dong|vnd))?(?: ?(?:\/ ?|mot |moi |1 )(thang|tuan|ngay|buoi|gio|tieng))?/.exec(n);
  if (!m) return null;
  let amount: number;
  let unit: string | undefined;
  if (m[2] === 'trieu' || m[2] === 'nghin') {
    amount = parseFloat((m[1] ?? '0').replace(',', '.')) * (m[2] === 'trieu' ? 1_000_000 : 1_000);
    unit = m[3];
  } else {
    amount = parseInt((m[1] ?? '0').replace(/[.,]/g, ''), 10);
    unit = m[2];
  }
  if (!amount) return null;
  return amount * (UNIT_PER_MONTH[unit ?? 'thang'] ?? 1);
}

function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + 'đ';
}

export interface LedgerResult {
  claims: Claim[];
  signals: Signal[];
}

export function buildLedger(messages: ChatMessage[]): LedgerResult {
  const claims: Claim[] = [];
  const signals: Signal[] = [];
  let counter = 0;

  const add = (m: ChatMessage, type: ClaimType, text: string, value: string): Claim => {
    const c: Claim = {
      claim_id: `claim-${String(++counter).padStart(3, '0')}`,
      claim_type: type,
      claim_text: text,
      value,
      source_message_id: m.id,
      timestamp: m.timestamp,
      status: 'unverified',
      related_claim_ids: [],
      evidence_quotes: [quote(m)],
    };
    claims.push(c);
    return c;
  };

  const last = (type: ClaimType, pred?: (c: Claim) => boolean) =>
    [...claims].reverse().find((c) => c.claim_type === type && (!pred || pred(c)));

  const msgById = new Map(messages.map((m) => [m.id, m]));

  const contradiction = (
    prev: Claim,
    cur: Claim,
    severity: Signal['severity'],
    title: string,
    explanation: string,
    action: string,
  ) => {
    prev.status = 'possible_contradiction';
    cur.status = 'possible_contradiction';
    prev.related_claim_ids.push(cur.claim_id);
    cur.related_claim_ids.push(prev.claim_id);
    const a = msgById.get(prev.source_message_id);
    const b = msgById.get(cur.source_message_id);
    signals.push({
      type: 'possible_contradiction',
      category: 'contradiction',
      severity,
      title,
      explanation,
      evidence_message_ids: [prev.source_message_id, cur.source_message_id],
      evidence_quotes: [a ? quote(a) : '', b ? quote(b) : ''],
      recommended_action: action,
      source: 'ledger',
    });
  };

  const explained = (prev: Claim, cur: Claim) => {
    cur.status = 'explained';
    prev.status = 'explained';
    prev.related_claim_ids.push(cur.claim_id);
    cur.related_claim_ids.push(prev.claim_id);
  };

  for (const m of messages) {
    if (m.sender === 'self') continue;
    const n = normalizeForMatch(m.text);
    const isCorrection = CORRECTION.test(n);

    // --- Phí ---
    if (NO_FEE.some((re) => re.test(n))) {
      add(m, 'fee', 'Nói không thu phí', 'no_fee');
    } else if (matchRule(fee, n) || matchRule(taskDeposit, n)) {
      const cur = add(m, 'fee', 'Có yêu cầu phí/tiền', 'fee_required');
      const prev = last('fee', (c) => c.value === 'no_fee');
      if (prev) {
        contradiction(
          prev,
          cur,
          'high',
          'Lời nói về phí chưa nhất quán',
          'Trước đó đối phương nói không thu phí, nhưng tin nhắn sau lại đề cập khoản phí/tiền phải đóng. Đây là điểm không nhất quán, chưa đủ để kết luận có hành vi lừa đảo.',
          'Không chuyển tiền trước khi xác minh độc lập; yêu cầu giải thích khoản phí bằng văn bản.',
        );
      }
    }

    // --- Hợp đồng ---
    if (matchRule(noContract, n)) {
      const cur = add(m, 'contract', 'Không cần/ký hợp đồng sau', 'no_contract');
      const prev = last('contract', (c) => c.value === 'has_contract');
      if (prev) {
        contradiction(
          prev,
          cur,
          'medium',
          'Lời nói về hợp đồng chưa nhất quán',
          'Trước đó có nhắc đến hợp đồng, sau đó lại nói không cần hoặc để ký sau.',
          'Đề nghị hợp đồng/thư mời nhận việc trước khi quyết định.',
        );
      }
    } else if (HAS_CONTRACT.some((re) => re.test(n)) && !/\bkhong (co |can |ky )?hop dong\b/.test(n)) {
      add(m, 'contract', 'Có nhắc đến hợp đồng', 'has_contract');
    }

    // --- Lương ---
    const salary = extractMonthlySalary(n);
    if (salary) {
      const prev = last('salary');
      const cur = add(m, 'salary', `Thu nhập ~${vnd(salary)}/tháng (quy đổi)`, String(salary));
      if (prev) {
        const ratio = salary / Number(prev.value);
        if (ratio > 1.3 || ratio < 1 / 1.3) {
          if (isCorrection) explained(prev, cur);
          else
            contradiction(
              prev,
              cur,
              'medium',
              'Mức thu nhập thay đổi đáng kể',
              `Mức thu nhập được nêu thay đổi từ khoảng ${vnd(Number(prev.value))} sang ${vnd(salary)} mỗi tháng (quy đổi).`,
              'Yêu cầu cách tính lương cụ thể bằng văn bản.',
            );
        } else {
          cur.status = 'consistent';
        }
      }
    }

    // --- Công ty ---
    const company = extractCompany(n);
    if (company) {
      const prev = last('company');
      const cur = add(m, 'company', `Tên đơn vị: "${company}"`, company);
      if (prev) {
        if (prev.value === company || prev.value.startsWith(company) || company.startsWith(prev.value)) {
          cur.status = 'consistent';
        } else if (isCorrection) explained(prev, cur);
        else
          contradiction(
            prev,
            cur,
            'medium',
            'Tên đơn vị tuyển dụng thay đổi',
            `Tên đơn vị được nêu khác nhau: "${prev.value}" và "${company}".`,
            'Đề nghị tên pháp nhân, mã số thuế và tự tra cứu từ nguồn chính thức.',
          );
      }
    }

    // --- Địa điểm ---
    const location = extractLocation(n);
    if (location) {
      const prev = last('location');
      const cur = add(m, 'location', `Địa điểm: "${location}"`, location);
      if (prev) {
        if (prev.value === location || prev.value.startsWith(location) || location.startsWith(prev.value)) {
          cur.status = 'consistent';
        } else if (isCorrection) explained(prev, cur);
        else
          contradiction(
            prev,
            cur,
            'medium',
            'Địa điểm làm việc thay đổi',
            `Địa điểm làm việc được nêu khác nhau: "${prev.value}" và "${location}".`,
            'Yêu cầu địa chỉ cụ thể bằng văn bản và tự kiểm tra trước khi di chuyển.',
          );
      }
    }
  }

  return { claims, signals };
}
