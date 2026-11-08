// Ngữ cảnh hội thoại:
//  1. Tín hiệu từ thực thể (link đáng ngờ, ví crypto, link kênh kín).
//  2. Luật ngữ cảnh GIẢM cảnh báo nhầm: giao dịch đời thường (chia tiền ăn, mua hàng có COD) với số tiền
//     nhỏ được hạ chuyển khoản/đặt cọc xuống mức Thấp. Ngữ cảnh xét trong ±4 tin quanh bằng chứng, vì hội thoại
//     dài thường có chuyện khác ở xa. Chốt chặn: tín hiệu nguy hiểm, cô lập, kỹ thuật hoặc lừa việc làm ở BẤT KỲ
//     ĐÂU trong hội thoại thì không hạ, để kẻ gian không né được bằng cách chèn "tiền cơm" cạnh yêu cầu đóng phí.
import { extractEntities } from './entities';
import { isUnrelatedLink, messageLinks } from './link';
import { normalizeForMatch, stripDiacritics } from './normalize';
import { classifyQr } from './qr';
import { MONEY_CONTEXT } from './rules/finance';
import { GROUP_WINDOW } from './rules/rule';
import { isLinkWarning } from './rules/warning';
import type { ChatMessage, LinkFinding, LinkLevel, Signal } from './types';

const quote = (m: ChatMessage) => (m.text.length > 220 ? m.text.slice(0, 217) + '…' : m.text.trim());

export function entitySignals(messages: ChatMessage[]): Signal[] {
  const links: { m: ChatMessage; reason: string; level: LinkLevel }[] = [];
  const wallets: ChatMessage[] = [];
  const channels: ChatMessage[] = [];
  for (const m of messages) {
    if (m.sender === 'self') continue;
    const e = extractEntities(m.text);
    if (!isLinkWarning(normalizeForMatch(m.text))) {
      for (const f of messageLinks(m)) if (f.level !== 'none') links.push({ m, reason: f.reasons[0] ?? '', level: f.level });
    }
    if (e.cryptoWallets.length) wallets.push(m);
    if (e.channelLinks.length) channels.push(m);
  }
  const out: Signal[] = [];
  const ids = (ms: ChatMessage[]) => [...new Set(ms.map((m) => m.id))];
  const quotes = (ms: ChatMessage[]) => ids(ms).map((id) => quote(ms.find((m) => m.id === id)!));
  if (links.length) {
    const ms = links.map((l) => l.m);
    out.push({
      type: 'suspicious_link',
      category: 'technical',
      severity: links.some((l) => l.level === 'high') ? 'high' : links.some((l) => l.level === 'medium') ? 'medium' : 'low',
      title: links.some((l) => l.level === 'high' || l.level === 'medium') ? 'Đường link đáng ngờ' : 'Đường link cần xem kỹ',
      explanation: `Tin nhắn chứa link có dấu hiệu bất thường: ${[...new Set(links.map((l) => l.reason))].join('; ')}.`,
      evidence_message_ids: ids(ms),
      evidence_quotes: quotes(ms),
      recommended_action: 'Không bấm link, không đăng nhập hay nhập OTP. Tự gõ địa chỉ trang chính thức hoặc dùng ứng dụng chính thức.',
      source: 'rule',
    });
  }
  if (wallets.length)
    out.push({
      type: 'crypto_wallet',
      category: 'investment',
      severity: 'medium',
      title: 'Yêu cầu giao dịch qua ví tiền ảo',
      explanation: 'Có địa chỉ ví tiền ảo (TRC20/USDT). Giao dịch tiền ảo gần như không thể truy hồi khi bị lừa.',
      evidence_message_ids: ids(wallets),
      evidence_quotes: quotes(wallets),
      recommended_action: 'Không chuyển tiền ảo cho người quen qua mạng hoặc "sàn" do người lạ giới thiệu.',
      source: 'rule',
    });
  if (channels.length)
    out.push({
      type: 'channel_migration',
      category: 'technical',
      severity: 'medium',
      title: 'Rủ chuyển sang kênh chat kín',
      explanation: 'Có link mời sang Telegram/Zalo/nhóm kín — nơi khó kiểm chứng và dễ thao túng hơn.',
      evidence_message_ids: ids(channels),
      evidence_quotes: quotes(channels),
      recommended_action: 'Giữ trao đổi ở kênh có thể kiểm chứng; không vào nhóm kín theo lời mời của người lạ.',
      source: 'rule',
    });
  return out;
}

/** Tất cả số tiền (đồng) nhắc tới trong văn bản đã chuẩn hóa. */
export function parseAmounts(n: string): number[] {
  const out: number[] = [];
  for (const m of n.matchAll(/\b(\d+(?:[.,]\d+)?) (trieu|nghin|ty)\b/g)) {
    const v = parseFloat((m[1] ?? '0').replace(',', '.'));
    out.push(v * (m[2] === 'ty' ? 1e9 : m[2] === 'trieu' ? 1e6 : 1e3));
  }
  for (const m of n.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b/g)) out.push(parseInt(m[0].replace(/[.,]/g, ''), 10));
  return out;
}

const JOB_CONTEXT = /\b(tuyen|viec lam|cong viec|ung tuyen|nhan viec|luong|cong tac vien|nhiem vu|hoa hong|phong van|trung tuyen)\b/;
// Không dùng "com", "nhau" đứng một mình: trùng đuôi .com và "gặp nhau", dễ hạ nhầm cảnh báo.
const EVERYDAY = /\b(tien com|an com|com (trua|toi|sang)|an (trua|toi|sang)|tra sua|cafe|ca phe|an nhau|di nhau|bill|tien hoc|hoc phi|quy lop|mua qua|tien (an|com|nuoc|xang|dien|nha|phong)|chia (tien|bill)|gop tien|sinh nhat|di cho)\b/;
/** Có khoản tiền cho mục đích khác đi kèm thì không phải chia tiền sinh hoạt ("tiền cơm 50k với 30 triệu tiền hàng"). */
const NOT_EVERYDAY_PURPOSE = /\b(tien hang|tien no|tra no|tien vay|khoan vay|dau tu|tien von|gop von|hop dong|rut (duoc|tien|het)|hoan (lai|tien|von)|loi nhuan|lai \d+ ?%)\b/;
const SHOP = /\b(shop|cua hang|don (hang|dat)|dat hang|size|ship|shipper|giao hang)\b/;
const SHOP_SAFE = /\b(cod|thanh toan khi nhan|nhan hang\b.{0,15}\b(kiem tra|roi|moi)|kiem tra hang)\b/;
const MITIGABLE = new Set(['money_transfer', 'upfront_fee', 'money_request_phrase', 'money_request_context']);
const RISKY_CATEGORIES = new Set(['isolation', 'impersonation', 'technical', 'investment', 'account', 'contradiction', 'pressure']);

/** Số tin xét trước và sau bằng chứng khi quyết định có phải giao dịch đời thường không. */
const MITIGATION_RADIUS = 4;
const GUARD_CATEGORIES = new Set(['isolation', 'technical', 'job_terms']);

function everydayReason(window: ChatMessage[], signals: Signal[]): string | null {
  const windowIds = new Set(window.map((m) => m.id));
  const nearby = signals.filter((s) => !MITIGABLE.has(s.type) && s.evidence_message_ids.some((id) => windowIds.has(id)));
  const otherRisk = nearby.some(
    (s) => s.severity === 'critical' || s.direct_danger || RISKY_CATEGORIES.has(s.category) || s.severity === 'high' || s.category === 'job_terms' || s.category === 'finance',
  );
  const others = window.filter((m) => m.sender !== 'self').map((m) => normalizeForMatch(m.text));
  const all = others.join(' \n ');
  if (otherRisk || JOB_CONTEXT.test(all) || NOT_EVERYDAY_PURPOSE.test(all)) return null;
  // Quyết định theo ngữ cảnh, không theo số tiền. Số tiền chỉ để hiển thị.
  if (EVERYDAY.test(all)) return 'Ngữ cảnh chia tiền sinh hoạt';
  if (SHOP.test(all) && SHOP_SAFE.test(all)) return 'Ngữ cảnh mua hàng có kiểm tra hàng/COD';
  return null;
}

export function applyContextMitigations(signals: Signal[], messages: ChatMessage[]): Signal[] {
  if (!signals.some((s) => MITIGABLE.has(s.type))) return signals;
  const guarded = signals.some(
    (s) => !MITIGABLE.has(s.type) && (s.direct_danger || s.severity === 'critical' || GUARD_CATEGORIES.has(s.category)),
  );
  if (guarded) return signals;
  const index = new Map(messages.map((m, i) => [m.id, i]));

  return signals.map((s) => {
    if (!MITIGABLE.has(s.type)) return s;
    const at = s.evidence_message_ids.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
    if (!at.length) return s;
    const window = messages.slice(Math.max(0, Math.min(...at) - MITIGATION_RADIUS), Math.max(...at) + MITIGATION_RADIUS + 1);
    const reason = everydayReason(window, signals);
    if (!reason) return s;
    return {
      ...s,
      severity: 'low' as const,
      mitigation: reason,
      // Tiêu đề/lời khuyên gốc nói về phí tuyển dụng — thay bằng nội dung trung lập hợp ngữ cảnh
      title: s.type === 'money_transfer' ? 'Chuyển khoản trong giao dịch thông thường' : 'Đặt cọc hoặc đóng tiền trong giao dịch thông thường',
      explanation: `Có đề nghị chuyển tiền/đặt cọc nhưng thuộc ${reason.toLowerCase()}, nên được hạ xuống mức Thấp.`,
      recommended_action: 'Kiểm tra đúng người nhận/uy tín cửa hàng; ưu tiên thanh toán khi nhận hàng và không chuyển thêm nếu bị hối thúc.',
    };
  });
}

// ---------------------------------------------------------------- link kèm lời nói
const BRANDS = 'vietcombank|vcb|techcombank|mb ?bank|agribank|bidv|vietinbank|tp ?bank|acb|sacombank|vp ?bank|shopee|lazada|tiktok|momo|zalopay|viettel|vinaphone|mobifone|dien luc|evn|bhxh|bao hiem xa hoi|ngan hang|cong an|thue|cuc thue';
const CLAIMS_TO_BE = [
  new RegExp(`\\b(em|minh|toi|chung toi|ben (em|minh|toi)) (la |ben |tu |thuoc |o )(nhan vien |cskh |tong dai |ho tro |bo phan |dai dien |can bo )*(cua )?(${BRANDS})\\b`),
  new RegExp(`\\b(nhan vien|cskh|cham soc khach hang|tong dai vien|bo phan ho tro) (cua )?(${BRANDS})\\b`),
];
const ACCOUNT_THREAT = /\b(tai khoan|the (cua \S+|ngan hang|atm|tin dung))\b.{0,25}\b(bi|se bi|sap bi)\s+(tam )?(khoa|dinh chi|vo hieu)\b|\b(xac minh|xac thuc|cap nhat) (ngay|gap|trong hom nay)\b|\bgiu tai khoan\b/;
const URGENT_SIGNAL = 'urgency_pressure';
/** Tin dặn không đưa mã: nhắc tới "nhân viên" đơn vị nhưng không phải đang tự xưng. */
const NOTICE_NOT_CLAIM = /\b(khong chia se|khong cung cap|khong tiet lo|bao gom ca)\b/;

/** Ghép link với lời nói trong cùng cửa sổ tin: tự xưng đơn vị mà link lạ, dọa khóa kèm link. Không có link thì không tạo cảnh báo. */
export function linkContextSignals(signals: Signal[], messages: ChatMessage[]): Signal[] {
  const others = messages.filter((m) => m.sender !== 'self');
  const linksOf = new Map<string, LinkFinding[]>(others.map((m) => [m.id, isLinkWarning(normalizeForMatch(m.text)) ? [] : messageLinks(m)]));
  const texts = others.map((m) => normalizeForMatch(m.text));
  const urgentIds = new Set(signals.filter((s) => s.type === URGENT_SIGNAL).flatMap((s) => s.evidence_message_ids));
  const mismatch = new Set<ChatMessage>();
  const pressured = new Set<ChatMessage>();
  others.forEach((m, i) => {
    const found = linksOf.get(m.id)!;
    if (!found.length) return;
    const from = Math.max(0, i - GROUP_WINDOW + 1);
    const to = Math.min(others.length - 1, i + GROUP_WINDOW - 1);
    for (let j = from; j <= to; j++) {
      if (found.some(isUnrelatedLink) && !NOTICE_NOT_CLAIM.test(texts[j]!) && CLAIMS_TO_BE.some((re) => re.test(texts[j]!))) {
        mismatch.add(m);
        mismatch.add(others[j]!);
      }
      const threat = found.some(isUnrelatedLink) && ACCOUNT_THREAT.test(texts[j]!);
      const urgent = found.some((f) => f.level === 'medium' || f.level === 'high') && urgentIds.has(others[j]!.id);
      if (threat || urgent) {
        pressured.add(m);
        pressured.add(others[j]!);
      }
    }
  });
  const toSignal = (type: string, title: string, explanation: string, recommended_action: string, set: Set<ChatMessage>): Signal => {
    const ms = others.filter((m) => set.has(m));
    return { type, category: 'technical', severity: 'high', title, explanation, recommended_action, evidence_message_ids: ms.map((m) => m.id), evidence_quotes: ms.map(quote), source: 'rule' };
  };
  const out: Signal[] = [];
  if (mismatch.size)
    out.push(toSignal(
      'claim_link_mismatch',
      'Tự xưng đơn vị nhưng link không phải trang của đơn vị',
      'Đối phương nói mình thuộc một đơn vị, nhưng link gửi kèm không nằm trên tên miền chính thức. Trang giả thường dùng cách này để lấy thông tin đăng nhập.',
      'Không bấm link. Tự mở ứng dụng hoặc gõ địa chỉ trang chính thức, hoặc gọi số tổng đài in trên thẻ để hỏi lại.',
      mismatch,
    ));
  if (pressured.size)
    out.push(toSignal(
      'link_with_pressure',
      'Gửi link kèm dọa khóa hoặc giục gấp',
      'Link đi cùng lời dọa khóa tài khoản hoặc giục làm ngay, để bạn bấm trước khi kịp kiểm tra.',
      'Không bấm link khi đang bị giục. Tự kiểm tra trong ứng dụng chính thức của đơn vị.',
      pressured,
    ));
  return out;
}

// ---------------------------------------------------------------- mã QR
/**
 * QR chuyển tiền rất phổ biến nên đứng một mình chỉ là thông tin. Lên Cao khi đi cùng việc làm, lời hứa, giục gấp
 * trong cùng cửa sổ tin. QR chứa link đã đi qua phân tích link như một link bình thường.
 */
export function qrSignals(messages: ChatMessage[]): Signal[] {
  const others = messages.filter((m) => m.sender !== 'self');
  const texts = others.map((m) => normalizeForMatch(m.text));
  const ofKind = (kinds: string[], extra?: (i: number) => boolean) =>
    others.filter((m, i) => (m.qr ?? []).some((p) => kinds.includes(classifyQr(p).kind)) && (!extra || extra(i)));
  const inContext = (i: number) => {
    const from = Math.max(0, i - GROUP_WINDOW + 1);
    const to = Math.min(others.length - 1, i + GROUP_WINDOW - 1);
    for (let j = from; j <= to; j++) if (MONEY_CONTEXT.some((re) => re.test(texts[j]!))) return true;
    return false;
  };
  const invalidCrc = (i: number) => (others[i]!.qr ?? []).some((p) => classifyQr(p).crcValid === false);
  const make = (type: string, severity: Signal['severity'], title: string, explanation: string, recommended_action: string, ms: ChatMessage[]): Signal => ({
    type, category: 'finance', severity, title, explanation, recommended_action, source: 'rule',
    evidence_message_ids: ms.map((m) => m.id), evidence_quotes: ms.map(quote),
  });
  const out: Signal[] = [];
  const payments = ofKind(['payment']);
  const paymentContext = ofKind(['payment'], inContext);
  const badCrc = ofKind(['payment'], invalidCrc);
  if (paymentContext.length) {
    out.push(make('qr_payment_context', 'high', 'Gửi QR chuyển tiền kèm lời hứa, việc làm hoặc giục gấp', 'Đối phương gửi mã QR chuyển tiền và gắn với công việc, lời hứa hoàn tiền, lợi nhuận hoặc hạn gấp.', 'Không quét để chuyển tiền chỉ vì lời hứa hay hạn gấp. Kiểm tra đơn vị qua kênh độc lập trước.', paymentContext));
  } else if (payments.length) {
    out.push(make('qr_payment_request', 'low', 'Gửi mã QR chuyển tiền', 'Đối phương gửi mã QR để chuyển tiền. Đây là việc thường gặp, hãy kiểm tra đúng người nhận trước khi quét.', 'Kiểm tra tên người nhận hiện trong ứng dụng ngân hàng trước khi xác nhận chuyển.', payments));
  }
  if (badCrc.length) out.push(make('qr_invalid_crc', 'medium', 'Mã QR chuyển tiền có thể đã bị sửa', 'Mã kiểm tra của QR chuyển tiền không khớp, nội dung có thể đã bị sửa hoặc hỏng.', 'Không chuyển theo mã này. Đề nghị người nhận gửi lại, và đối chiếu tên trong ứng dụng ngân hàng.', badCrc));
  const install = ofKind(['install']);
  if (install.length) out.push({ ...make('qr_install', 'high', 'Mã QR dẫn tới cài ứng dụng', 'Mã QR mở thẳng việc cài ứng dụng, có thể là ứng dụng độc hại.', 'Không quét mã này. Ứng dụng chính thức chỉ tải từ CH Play hoặc App Store.', install), category: 'technical' });
  const crypto = ofKind(['crypto']);
  if (crypto.length) out.push({ ...make('qr_crypto', 'medium', 'Mã QR chuyển tiền ảo', 'Mã QR chứa địa chỉ ví tiền ảo. Giao dịch tiền ảo gần như không thể lấy lại khi bị lừa.', 'Không chuyển tiền ảo theo mã do người lạ gửi.', crypto), category: 'investment' });
  return out;
}

// ---------------------------------------------------------------- người dùng đã làm theo
/** Phủ định phải đứng ngay trước hành động ("không gửi", "chưa chuyển"). "Em không đủ, để em mượn thêm rồi nạp" vẫn là sắp làm. */
const NOT_DONE = /\b(chua|khong|dau co|khoi|dung|co nen)\s+(\S+\s+){0,2}(chuyen|nap|dong|coc|gui|doc|dua|cung cap|cai|tai|bat|nhap|dien|dang nhap|dang ky|vao|bam|lam)\b|\bneu\b|\?/;
/** Chữ trạng thái dính vào tin của mình ("đã gửi") từng làm khớp nhầm mẫu "đã gửi mã". */
const STATUS_TAIL = /(\s*\b(da gui|da xem|dang gui|da nhan|sent|seen|delivered))+\s*$/;
type ComplianceKind = 'money' | 'otp' | 'app' | 'login';
const COMPLIANCE: Record<ComplianceKind, { requests: string[]; done: RegExp[]; intend: RegExp[]; title: string; intendTitle: string; category: Signal['category'] }> = {
  money: {
    requests: ['withdrawal_fee', 'bait_then_demand', 'qr_payment_context', 'qr_invalid_crc', 'upfront_fee', 'task_deposit', 'money_request_phrase', 'money_request_context', 'money_request_threat', 'repeated_money_request', 'money_transfer', 'hold_deposit_deadline', 'task_freeze_extortion', 'task_escalating_deposit', 'investment_scam', 'authority_impersonation'],
    done: [/\b(chuyen khoan|chuyen|dong|nap|coc|gui tien)\b.{0,14}\b(roi|xong)\b/, /\b(da|vua|moi) (chuyen|dong|nap|coc|gui tien)\b/],
    intend: [
      /\bde (em|minh|toi|tao|to) (chuyen|nap|dong|coc|gui tien|thanh toan)\b/,
      /\b(em|minh|toi) (se|di|dang|chuan bi) (chuyen|nap|dong|gui tien|thanh toan)\b/,
      /\b(chuyen|nap|dong) (lien|ngay|luon)\b/,
      /\bcho (em|minh|toi) (xin )?(so tai khoan|tai khoan|stk|ma qr)\b/,
      /\b(muon|vay) (them|ban|tien|nguoi nha|ban be)\b.{0,25}\b(nap|chuyen|dong)\b/,
    ],
    title: 'Bạn có thể đã chuyển tiền',
    intendTitle: 'Bạn sắp chuyển tiền theo yêu cầu',
    category: 'finance',
  },
  otp: {
    requests: ['account_takeover_code', 'otp_password_request', 'otp_institution_pressure', 'bank_credentials'],
    done: [/\b(doc|gui|nhap|dua|cung cap)\b.{0,14}\b(roi|xong)\b/, /\b(da|vua|moi) (doc|gui|nhap|dua|cung cap)\b/, /\b(ma|otp|mat khau)\b(?!.{0,14}\b(co dinh|mau|vi du|test|thu nghiem|gia lap)\b).{0,10}\b(la|day)\b/, /^\s*\d(?:[ .-]?\d){3,7}\s*$/],
    intend: [
      /\bde (em|minh|toi)\b.{0,30}\b(gui|doc|nhap|lay|chup) (cai )?(ma|otp|mat khau)\b/,
      /\b(gui|doc) (ma|otp)\b.{0,12}\b(lien|ngay|luon)\b/,
      /\blay (cai )?ma\b.{0,25}\bgui\b/,
    ],
    title: 'Bạn có thể đã đưa mã hoặc mật khẩu',
    intendTitle: 'Bạn sắp gửi mã hoặc mật khẩu',
    category: 'account',
  },
  app: {
    requests: ['malware_apk', 'apk_install_request', 'qr_install'],
    done: [/\b(cai|tai|bat)\b.{0,14}\b(roi|xong)\b/, /\b(da|vua|moi) (cai|tai|bat)\b/],
    intend: [/\b(dang|de (em|minh|toi)|(em|minh|toi) (se|dang)) (cai|tai)\b/],
    title: 'Bạn có thể đã cài ứng dụng lạ',
    intendTitle: 'Bạn đang cài ứng dụng theo hướng dẫn',
    category: 'technical',
  },
  login: {
    requests: ['account_takeover_code', 'suspicious_link', 'claim_link_mismatch', 'link_with_pressure', 'phishing_vote_qr', 'refund_link_info'],
    done: [/\b(dang nhap|nhap|dien|bam|vao)\b.{0,14}\b(roi|xong)\b/, /\b(da|vua|moi) (dang nhap|nhap|dien|bam)\b/],
    intend: [/\bde (em|minh|toi) (vao|nhap|dang nhap|dang ky|bam|dien)\b/, /\b(em|minh|toi) (se|dang) (vao|nhap|dang nhap|dien)\b/],
    title: 'Bạn có thể đã đăng nhập hoặc nhập thông tin qua link',
    intendTitle: 'Bạn sắp nhập thông tin qua link',
    category: 'account',
  },
};

/**
 * Trục nạn nhân: tin của người dùng cho thấy sắp làm theo hoặc đã làm theo một yêu cầu trước đó.
 * Chỉ tính khi đã có yêu cầu tương ứng. Yêu cầu từ mức Cao trở lên thì bắt buộc Nghiêm trọng: đây là lúc kẻ gian
 * sắp đạt mục đích, cảnh báo phải đủ mạnh để người dùng dừng lại. Yêu cầu nhẹ hơn (vd. link rút gọn) thì mức Cao.
 * Bằng chứng là lời yêu cầu của đối phương, vì dấu hiệu là hành vi của đối phương; tin người dùng chỉ là ngữ cảnh.
 */
export function userCompliedSignals(signals: Signal[], messages: ChatMessage[]): Signal[] {
  const seqOf = new Map(messages.map((m) => [m.id, m.seq]));
  const out: Signal[] = [];
  for (const [kind, c] of Object.entries(COMPLIANCE) as [ComplianceKind, (typeof COMPLIANCE)[ComplianceKind]][]) {
    const asks = signals.filter((s) => c.requests.includes(s.type) && !s.mitigation && s.severity !== 'low');
    if (!asks.length) continue;
    const firstAsk = Math.min(...asks.flatMap((s) => s.evidence_message_ids.map((id) => seqOf.get(id) ?? Infinity)));
    const after = messages.filter((m) => m.sender === 'self' && m.seq > firstAsk).map((m) => normalizeForMatch(m.text).replace(STATUS_TAIL, ''));
    const done = after.some((n) => !NOT_DONE.test(n) && c.done.some((re) => re.test(n)));
    const intended = after.some((n) => !NOT_DONE.test(n) && c.intend.some((re) => re.test(n)));
    if (!done && !intended) continue;
    const serious = asks.some((s) => s.severity === 'high' || s.severity === 'critical');
    const askIds = new Set(asks.flatMap((s) => s.evidence_message_ids));
    const askMessages = messages.filter((m) => askIds.has(m.id) && m.sender !== 'self');
    out.push({
      type: done ? `user_complied_${kind}` : `user_intends_${kind}`,
      category: c.category,
      severity: serious ? 'critical' : 'high',
      title: done ? c.title : c.intendTitle,
      explanation: done
        ? 'Tin nhắn của bạn cho thấy có thể đã làm theo yêu cầu trước đó. Xử lý càng sớm càng dễ giảm thiệt hại.'
        : 'Tin nhắn của bạn cho thấy bạn sắp làm theo yêu cầu này. Đây thường là bước cuối kẻ gian chờ đợi, kể cả khi trước đó bạn đã nghi ngờ.',
      recommended_action: done ? 'Làm ngay các bước trong phần gợi ý, không cần trả lời đối phương.' : 'Dừng lại trước khi làm. Đọc lại các câu bạn đã hỏi mà chưa được trả lời rõ.',
      evidence_message_ids: askMessages.map((m) => m.id),
      evidence_quotes: askMessages.map(quote),
      source: 'rule',
    });
  }
  return out;
}

// ---------------------------------------------------------------- mồi trả thưởng rồi đòi tiếp
const PAYOUT = /\b(da|vua) (hoan|cong|chuyen|tra|ve)\b.{0,30}\b(tien|hoa hong|loi nhuan|vao tai khoan)\b|\b(hoa hong|tien|loi nhuan|tien thuong) (da|vua) (ve|duoc cong|hoan)\b|\brut (duoc|thanh cong)\b/;
const DEMAND_AFTER_BAIT = new Set(['task_deposit', 'money_request_phrase', 'money_request_context', 'upfront_fee', 'repeated_money_request']);

/**
 * Trả một khoản nhỏ để tạo lòng tin rồi đòi khoản tiếp theo là bước "vào tròng" của lừa nhiệm vụ, đầu tư.
 * Chỉ tính trong bối cảnh nhiệm vụ, hoa hồng, để hoàn tiền mua hàng thông thường không bị tính.
 */
export function baitThenDemandSignals(signals: Signal[], messages: ChatMessage[]): Signal[] {
  const others = messages.filter((m) => m.sender !== 'self');
  if (!others.some((m) => TASK_CONTEXT.test(normalizeForMatch(m.text)))) return [];
  const payout = others.find((m) => PAYOUT.test(normalizeForMatch(m.text)));
  if (!payout) return [];
  const seqOf = new Map(messages.map((m) => [m.id, m.seq]));
  const laterIds = new Set(signals.filter((s) => DEMAND_AFTER_BAIT.has(s.type) && !s.mitigation).flatMap((s) => s.evidence_message_ids).filter((id) => (seqOf.get(id) ?? 0) > payout.seq));
  const later = others.filter((m) => laterIds.has(m.id));
  if (!later.length) return [];
  const ms = [payout, ...later];
  return [{
    type: 'bait_then_demand',
    category: 'finance',
    severity: 'critical',
    title: 'Trả thưởng nhỏ rồi đòi nạp tiếp',
    explanation: 'Đối phương báo đã trả hoặc hoàn một khoản nhỏ, sau đó đòi nạp khoản tiếp theo. Khoản nhỏ chỉ để tạo lòng tin, các khoản sau thường không rút được.',
    recommended_action: 'Dừng ở đây, không nạp thêm. Khoản đã nhận không chứng minh đây là việc thật.',
    evidence_message_ids: ms.map((m) => m.id),
    evidence_quotes: ms.map(quote),
    source: 'rule',
  }];
}

// ---------------------------------------------------------------- vòng vo, né câu hỏi
const VERIFY_TOPIC = /\b(trang chinh thuc|chinh thuc|cong ty|ten (cong ty|phap nhan|ben)|ma so thue|hop dong|dia chi|giay phep|sao phai|tai sao|vi sao|co dung khong|an toan khong|lua dao|link goc|duoi mien|nguy hiem|bi hack|ma doc|kiem tra)\b/;
const DOUBT = /\b(khong on|nguy hiem|bi hack|ma doc|lua dao|gia mao|khong bam|khong dang nhap|khong gui ma|khong chuyen)\b/;
const CONCRETE = /\b(cong ty (tnhh|co phan|cp)|ma so thue:? ?\d|mst:? ?\d|giay phep (so|\d)|dia chi:? ?(so )?\d|so \d+ duong|hop dong (file|ban|gui kem))\b/;
const REASSURE = /\b(yen tam|dung lo|khong sao (dau|het)|khong co ma doc|an toan (lam|ma|het)|uy tin|cong ty lon|nhieu (ban|nguoi) (lam|nhan|tham gia) roi|lam thu la biet|cu (lam|bam|vao|dang nhap)|tin (chi|anh|em|minh)|hieu lam roi|chu dao|khen that|canh giac (vay|nhu vay) la tot|can than khong thua)\b/;
const EXCUSE = /\b(noi bo|tim tren mang|khong co tren|rieng cho|quy trinh|bat buoc|kiem toan|he thong yeu cau|cho de bam)\b/;
const DANGER_TYPES_EXCLUDED = new Set(['suspicious_link', 'channel_migration', 'qr_payment_request']);

export interface EvasionResult {
  signals: Signal[];
  /** Câu nạn nhân đã hỏi hoặc nghi ngờ mà đối phương chỉ trấn an, không trả lời rõ. */
  openQuestions: string[];
}

/**
 * Kẻ gian không trả lời câu hỏi xác minh mà trấn an, khen, viện quy trình, để người hỏi quên câu hỏi hoặc bớt nghi.
 * Một câu bị né khi các tin ngay sau không có thông tin kiểm chứng được mà chỉ trấn an hoặc viện cớ.
 * Từ 2 câu bị né: Cần chú ý; nếu đã có yêu cầu nguy hiểm thì Cao.
 */
export function evasionSignals(signals: Signal[], messages: ChatMessage[]): EvasionResult {
  const evaded: { question: ChatMessage; reply: ChatMessage[] }[] = [];
  let lastQuestion = '';
  messages.forEach((m, i) => {
    if (m.sender !== 'self') return;
    const n = normalizeForMatch(m.text).replace(STATUS_TAIL, '');
    if (!(m.text.includes('?') && VERIFY_TOPIC.test(n)) && !DOUBT.test(n)) return;
    if (n === lastQuestion) return;
    lastQuestion = n;
    const reply: ChatMessage[] = [];
    for (let j = i + 1; j < messages.length && messages[j]!.sender !== 'self' && reply.length < 2; j++) reply.push(messages[j]!);
    if (!reply.length) return;
    const r = reply.map((x) => normalizeForMatch(x.text)).join(' ');
    if (!CONCRETE.test(r) && (REASSURE.test(r) || EXCUSE.test(r))) evaded.push({ question: m, reply });
  });
  const openQuestions = evaded.map((e) => (e.question.text.length > 140 ? e.question.text.slice(0, 137) + '…' : e.question.text).replace(/\s*(Đã gửi|Đã xem)\s*$/u, ''));
  if (evaded.length < 2) return { signals: [], openQuestions };
  const danger = signals.some((s) => !s.mitigation && !DANGER_TYPES_EXCLUDED.has(s.type) && (s.severity === 'high' || s.severity === 'critical'));
  const replies = [...new Map(evaded.flatMap((e) => e.reply).map((m) => [m.id, m])).values()];
  return {
    openQuestions,
    signals: [{
      type: 'evasive_reassurance',
      category: 'pressure',
      severity: danger ? 'high' : 'medium',
      title: `Né ${evaded.length} câu hỏi, chỉ trấn an thay vì trả lời`,
      explanation: 'Bạn đã hỏi hoặc nêu nghi ngờ, nhưng đối phương chỉ trấn an, khen hoặc viện quy trình mà không đưa thông tin kiểm chứng được. Đây là cách làm người hỏi quên câu hỏi hoặc bớt nghi.',
      recommended_action: 'Chỉ làm tiếp khi các câu hỏi được trả lời bằng thông tin tự kiểm chứng được, như tên pháp nhân, mã số thuế, trang chính thức.',
      evidence_message_ids: replies.map((m) => m.id),
      evidence_quotes: replies.map(quote),
      source: 'rule',
    }],
  };
}

// ---------------------------------------------------------------- đòi tiền lặp lại
const MONEY_DEMANDS = new Set(['upfront_fee', 'task_deposit', 'money_request_phrase', 'money_request_context']);
const TASK_CONTEXT = /\b(nhiem vu|hoa hong|don si|don vip|don hang|he thong phan phoi|chot don|giat don|hoan \d)\b/;
const HIGH_OR_MORE = new Set(['high', 'critical']);

/**
 * So tương đối trong chính đoạn chat, không dùng ngưỡng số tiền cố định:
 *  - số tiền yêu cầu sau cao hơn trước, trong bối cảnh nhiệm vụ: nạp leo thang;
 *  - đòi tiền từ 2 tin trở lên mà chưa có tín hiệu nặng: lên mức Cao.
 */
export function repeatedMoneySignals(signals: Signal[], messages: ChatMessage[]): Signal[] {
  const ids = new Set(signals.filter((s) => MONEY_DEMANDS.has(s.type) && !s.mitigation).flatMap((s) => s.evidence_message_ids));
  const demands = messages.filter((m) => ids.has(m.id) && m.sender !== 'self');
  if (demands.length < 2) return [];
  const base = {
    category: 'finance' as const,
    evidence_message_ids: demands.map((m) => m.id),
    evidence_quotes: demands.map(quote),
    source: 'rule' as const,
  };
  const firstAmounts = demands.map((m) => parseAmounts(normalizeForMatch(m.text))[0]).filter((a): a is number => a !== undefined);
  const rising = firstAmounts.length >= 2 && firstAmounts.at(-1)! > firstAmounts[0]!;
  const task = messages.some((m) => m.sender !== 'self' && TASK_CONTEXT.test(normalizeForMatch(m.text)));
  if (rising && task && !signals.some((s) => s.type === 'task_escalating_deposit')) {
    return [{
      ...base,
      type: 'task_escalating_deposit',
      severity: 'critical',
      title: 'Số tiền phải nạp tăng dần theo nhiệm vụ',
      explanation: 'Khoản phải nạp sau cao hơn khoản trước và gắn với nhiệm vụ, hoa hồng. Đây là bước giam tiền: nạp càng nhiều càng khó lấy lại.',
      recommended_action: 'Dừng ngay, không nạp thêm và không vay mượn để nạp. Lưu bằng chứng, báo ngân hàng và trình báo công an.',
    }];
  }
  if (signals.some((s) => !s.mitigation && HIGH_OR_MORE.has(s.severity))) return [];
  return [{
    ...base,
    type: 'repeated_money_request',
    severity: 'high',
    title: rising ? 'Số tiền đòi tăng dần' : 'Đòi tiền nhiều lần',
    explanation: 'Đối phương đề nghị đóng hoặc chuyển tiền từ hai lần trở lên trong cùng đoạn chat.',
    recommended_action: 'Không chuyển thêm. Hỏi rõ tổng số tiền phải trả, và kiểm tra người nhận qua kênh độc lập.',
  }];
}

// ---------------------------------------------------------------- người dùng đã tự xác minh
// Ca "người quen mượn tiền": nếu SAU lời nhờ mượn, người dùng đã xác minh người thật (tự nói đã gọi điện/xác nhận,
// hoặc yêu cầu gọi → có cuộc gọi → chính người dùng xác nhận lại), thì hạ các tín hiệu mượn/chuyển tiền:
//   số tiền ≤ 2 triệu → Thấp; lớn hơn → tối đa Cần chú ý (vẫn nhắc kiểm tra tên tài khoản, gọi lại số đã lưu).
// KHÔNG hạ nếu cuộc gọi có dấu hiệu bất thường (mạng lag, hỏng mic, không nghe rõ — kiểu deepfake/giả giọng),
// hoặc có bất kỳ dấu hiệu rủi ro nào khác (nguy hiểm trực tiếp, cô lập, link/app, đầu tư, OTP/giấy tờ, thúc ép…).

const BORROW = new Set(['account_takeover_borrow', 'borrow_request', 'money_transfer']);
const VERIFIED_SAMPLE_LIMIT = 2_000_000;
const SELF_DONE = [
  /\b(da|vua|moi) (goi|goi dien|goi lai|xac minh|xac nhan|hoi lai|gap)\b/,
  /\b(da|vua|moi) (nghe may|bat may|nghe dien thoai|noi chuyen (dien thoai|qua dien thoai|truc tiep)?)\b/,
  /\bnghe (may|giong|dien thoai)\b.{0,20}\b(roi|xong)\b/,
  /\bdung (la )?(may|ban|anh|chi|em|ong|ba|co|chu) (roi|that)\b/,
];
const SELF_ASK = /\b(goi|goi dien|goi dien thoai|goi video|video call)\b.{0,20}\b(cho|lai|xem|di)\b/;
const CALL_EVIDENCE = /\[(cuoc )?(goi|cuoc goi) ?(thoai|video|dien)/;
/** Người dùng tự xác nhận sau cuộc gọi — kẻ gian không giả được tin của người dùng (dòng "[cuộc gọi…]" thì có thể gõ giả). */
const SELF_AFFIRM = /\b(roi|ok|oke|yen tam|dung roi|duoc roi|dung la|gui (so tai khoan|stk))\b/;
const SUSPICIOUS_CALL =
  /\b(mang (yeu|lag|cham)|lag (qua|lam)|hong (mic|loa|camera)|khong (nghe|goi) (may|duoc)|khong nghe ro|song yeu|mat tieng|khong thay mat)\b/;

export function applyVerificationMitigation(signals: Signal[], messages: ChatMessage[]): Signal[] {
  const targets = signals.filter((s) => BORROW.has(s.type) && !s.mitigation);
  if (!targets.some((s) => s.type !== 'money_transfer')) return signals;
  const otherRisk = signals.some(
    (s) =>
      !BORROW.has(s.type) &&
      !s.mitigation &&
      (s.severity === 'critical' || s.direct_danger || RISKY_CATEGORIES.has(s.category) || s.severity === 'high'),
  );
  if (otherRisk) return signals;

  const seqOf = (id: string) => Number(id.replace(/\D/g, '')) || 0;
  const firstBorrowSeq = Math.min(...targets.flatMap((s) => s.evidence_message_ids.map(seqOf)));
  const after = messages.filter((m) => m.seq > firstBorrowSeq);
  if (messages.some((m) => m.sender !== 'self' && SUSPICIOUS_CALL.test(normalizeForMatch(m.text)))) return signals;

  let verified = false;
  let askedAt = Infinity;
  let callAt = Infinity;
  for (const m of after) {
    const n = normalizeForMatch(m.text);
    const rawLower = stripDiacritics(m.text.toLowerCase());
    if (m.sender === 'self') {
      if (SELF_DONE.some((re) => re.test(n))) verified = true;
      if (SELF_ASK.test(n)) askedAt = Math.min(askedAt, m.seq);
      if (m.seq > callAt && SELF_AFFIRM.test(n)) verified = true;
    }
    if (m.seq > askedAt && CALL_EVIDENCE.test(rawLower)) callAt = Math.min(callAt, m.seq);
  }
  if (!verified) return signals;

  const amounts = messages.filter((m) => m.sender !== 'self').flatMap((m) => parseAmounts(normalizeForMatch(m.text)));
  const large = amounts.some((a) => a > VERIFIED_SAMPLE_LIMIT);
  return signals.map((s) =>
    BORROW.has(s.type) && !s.mitigation
      ? {
          ...s,
          severity: large ? ('medium' as const) : ('low' as const),
          mitigation: large ? 'Đã xác minh người thật nhưng số tiền lớn' : 'Người dùng đã xác minh người thật, số tiền nhỏ',
          title: large ? 'Mượn số tiền lớn — đã có bước xác minh' : 'Mượn tiền sau khi đã xác minh người thật',
          explanation: large
            ? 'Bạn đã xác minh người quen qua cuộc gọi, nhưng số tiền lớn: kiểm tra tên chủ tài khoản đúng là người quen và gọi lại số đã lưu (không qua ứng dụng chat) trước khi chuyển.'
            : 'Có lời nhờ mượn/chuyển tiền nhưng bạn đã xác minh người thật qua cuộc gọi và số tiền nhỏ, nên được hạ xuống mức Thấp.',
          recommended_action: 'Chỉ chuyển đúng số tiền đã thỏa thuận vào tài khoản đúng tên người quen; nếu bị hối thúc chuyển thêm, gọi lại số đã lưu.',
        }
      : s,
  );
}
