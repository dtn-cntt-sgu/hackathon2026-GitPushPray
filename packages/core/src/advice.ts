import { normalizeForMatch } from './normalize';
import type { Advice, AiNextStep, ChatMessage, RiskLevel, Signal } from './types';

const LEVEL_ACTIONS: Record<RiskLevel, string[]> = {
  low: [
    'Chưa thấy dấu hiệu rõ trong phần đã đọc — điều này không chứng minh cuộc trò chuyện an toàn.',
    'Tiếp tục kiểm tra thông tin người/đơn vị đang liên hệ từ nguồn độc lập.',
  ],
  attention: [
    'Xem kỹ các căn cứ bên dưới trước khi quyết định.',
    'Đề nghị thông tin và điều kiện bằng văn bản (hợp đồng, tên pháp nhân) trước khi giao dịch.',
    'Kiểm tra qua kênh độc lập: website chính thức, số tổng đài, cổng đăng ký doanh nghiệp, hoặc gọi trực tiếp số đã lưu của người quen.',
  ],
  high: [
    'Dừng lại trước khi chuyển tiền hoặc cung cấp thông tin cá nhân.',
    'Không chia sẻ OTP, mật khẩu, ảnh giấy tờ cho tới khi đã xác minh độc lập.',
    'Hỏi ý kiến người thân, bạn bè hoặc nhà trường về lời mời này.',
  ],
  critical: [
    'Ưu tiên an toàn của bạn: không gặp riêng, không di chuyển chỉ vì áp lực từ đối phương.',
    'Liên hệ ngay người bạn tin tưởng và cho họ biết tình hình.',
    'Lưu lại bằng chứng (ảnh chụp màn hình, báo cáo xuất) và cân nhắc ngừng tương tác.',
  ],
};

/** Câu hỏi xác minh trung lập theo loại tín hiệu — người dùng tự sao chép và quyết định gửi. */
const QUESTIONS: Record<string, string> = {
  upfront_fee: 'Anh/chị có thể gửi văn bản nêu rõ khoản phí này là gì, ai thu và có hóa đơn không ạ?',
  money_transfer: 'Tài khoản nhận tiền đứng tên cá nhân hay công ty ạ? Em muốn đối chiếu với thông tin pháp nhân.',
  task_deposit: 'Công việc này có hợp đồng lao động không, hay chỉ là nạp tiền làm nhiệm vụ ạ?',
  money_request_phrase: 'Khoản tiền này để làm gì và ai là người nhận ạ? Anh/chị gửi em văn bản nêu rõ được không?',
  money_request_context: 'Khoản tiền này để làm gì và ai là người nhận ạ? Anh/chị gửi em văn bản nêu rõ được không?',
  repeated_money_request: 'Tổng cộng em phải trả bao nhiêu và còn khoản nào nữa không ạ? Anh/chị gửi em văn bản nêu rõ được không?',
  hidden_company_identity: 'Cho em xin tên pháp nhân đầy đủ, mã số thuế và địa chỉ văn phòng để em tra cứu ạ.',
  unrealistic_pay: 'Anh/chị mô tả giúp em công việc cụ thể hằng ngày và cách tính lương được không ạ?',
  no_written_contract: 'Em có thể nhận hợp đồng hoặc thư mời nhận việc trước khi bắt đầu không ạ?',
  possible_contradiction: 'Trước đó anh/chị có nói khác, anh/chị xác nhận lại giúp em bằng văn bản được không ạ?',
  urgency_pressure: 'Em cần vài ngày để tìm hiểu và hỏi ý kiến gia đình, như vậy có được không ạ?',
  id_document_request: 'Giấy tờ này dùng cho mục đích gì và được lưu trữ ra sao ạ? Em có thể nộp trực tiếp tại văn phòng không?',
  task_recruitment: 'Công việc này do công ty nào trả lương, có hợp đồng không, và em có phải nạp/ứng tiền trước lần nào không ạ?',
  investment_scam: 'Sàn này được cấp phép bởi cơ quan nào ở Việt Nam ạ? Em muốn tự tra cứu trước khi tham gia.',
  romance_customs_gift: 'Cho em xin số vận đơn và tên đơn vị vận chuyển để em tự liên hệ hải quan qua kênh chính thức ạ.',
  loan_app_trap: 'Cho em xin tên công ty tài chính và số giấy phép để em tự gọi tổng đài chính thức xác minh ạ.',
  loan_offer_app: 'Cho em xin tên công ty tài chính và số giấy phép; em sẽ tự tải ứng dụng chính thức trên kho ứng dụng ạ.',
  refund_link_info: 'Em sẽ tự mở ứng dụng chính thức của sàn để kiểm tra đơn và hoàn tiền, không qua link ạ.',
  bank_alert_callback: 'Em sẽ tự gọi số tổng đài in trên thẻ hoặc mở ứng dụng ngân hàng để kiểm tra ạ.',
  card_cash_service: 'Cho em xin tên ngân hàng; em sẽ tự đổi hạn mức trên ứng dụng chính thức ạ.',
  parcel_fee_scam: 'Cho em xin mã vận đơn, em tự tra trên ứng dụng của đơn vị vận chuyển ạ.',
  debt_collection_threat: 'Cho em xin số hợp đồng và tên công ty cho vay để em tự kiểm tra qua kênh chính thức ạ.',
  qr_payment_request: 'Tài khoản này đứng tên ai và khoản này để làm gì ạ?',
  qr_payment_context: 'Tài khoản này đứng tên ai và khoản này để làm gì ạ? Anh/chị gửi em văn bản nêu rõ được không?',
  claim_link_mismatch: 'Trang chính thức của đơn vị là gì ạ? Em sẽ tự vào từ ứng dụng chính thức, không qua link này.',
  link_with_pressure: 'Em sẽ tự kiểm tra trong ứng dụng chính thức trước, không qua link này được không ạ?',
  suspicious_link: 'Đây là trang chính thức của đơn vị nào ạ? Em sẽ tự truy cập từ website/ứng dụng chính thức.',
  channel_migration: 'Mình trao đổi tiếp ở đây được không ạ? Em muốn giữ lại nội dung để đối chiếu.',
};

/** Người dùng tự hỏi bằng lời khác nhưng cùng ý thì cũng coi như đã hỏi. */
const ASKED_TOPIC: Record<string, RegExp> = {
  task_recruitment: /\b(cong ty nao|ten cong ty|hop dong|phai (nap|ung|dong) tien|mat phi)\b/,
  channel_migration: /\b(sao|tai sao|vi sao)\b.{0,20}\b(telegram|zalo|phai qua|nhan qua)\b|\btrao doi (tiep )?o day\b|\bqua day luon\b/,
  hidden_company_identity: /\b(ten phap nhan|ma so thue|ten cong ty|dia chi van phong)\b/,
  no_written_contract: /\bhop dong\b/,
  money_transfer: /\btai khoan\b.{0,20}\b(ten ai|dung ten|cua ai|ca nhan|cong ty)\b/,
  upfront_fee: /\b(phi|khoan phi)\b.{0,20}\b(gi|hoa don|ai thu|de lam gi)\b/,
  investment_scam: /\b(cap phep|giay phep)\b/,
  urgency_pressure: /\b(tim hieu|hoi y kien|suy nghi them|hoi gia dinh)\b/,
};

const wordsOf = (text: string) => new Set(normalizeForMatch(text).split(/\s+/).filter((w) => w.length > 1));

/** Tin của người dùng đã chứa phần lớn câu gợi ý. Chỉ để bỏ gợi ý, không liên quan tới mức cảnh báo. */
function alreadyAsked(question: string, selfTexts: string[], type?: string): boolean {
  const q = wordsOf(question);
  if (q.size === 0) return false;
  return selfTexts.some((text) => {
    const said = wordsOf(text);
    let hit = 0;
    for (const w of q) if (said.has(w)) hit++;
    return hit / q.size >= 0.6 || (type !== undefined && !!ASKED_TOPIC[type]?.test(normalizeForMatch(text)));
  });
}

export interface AdviceContext {
  messages: ChatMessage[];
  nextStep?: AiNextStep;
}

export const SUPPORT_RESOURCES = [
  'Gọi 113 (Cảnh sát) nếu bạn đang gặp nguy hiểm khẩn cấp.',
  'Gọi 111 (Tổng đài quốc gia bảo vệ trẻ em) nếu bạn hoặc người liên quan dưới 18 tuổi.',
  'Phản ánh lừa đảo trực tuyến tại canhbao.khonggianmang.vn.',
  'Liên hệ phòng công tác sinh viên của trường hoặc người thân tin cậy.',
];

export const SAFETY_MESSAGE =
  'Một số yêu cầu có thể ảnh hưởng đến an toàn của bạn, chẳng hạn bị thúc ép di chuyển gấp, giao giấy tờ gốc hoặc giữ bí mật với người thân. Đừng gặp riêng hoặc di chuyển chỉ vì áp lực từ đối phương. Hãy liên hệ người bạn tin tưởng và tìm hỗ trợ tại địa phương nếu cảm thấy không an toàn.';

/** Mức Nghiêm trọng do bẫy tài chính/mã độc (không có nguy hiểm thân thể). */
export const FINANCIAL_SAFETY_MESSAGE =
  'Các yêu cầu trong cuộc trò chuyện khớp với kịch bản chiếm đoạt tiền/tài khoản đã biết. Dừng mọi giao dịch, không nạp thêm, không cài ứng dụng hay đọc mã cho bất kỳ ai. Nếu đã chuyển tiền hoặc cài ứng dụng lạ: ngắt mạng thiết bị, gọi ngay tổng đài ngân hàng để khóa tài khoản, lưu bằng chứng và trình báo công an.';

const PHYSICAL = new Set(['isolation', 'pressure']);
const CRITICAL_FINANCIAL_ACTIONS = [
  'Dừng ngay mọi giao dịch; không nạp thêm hay đóng thêm bất kỳ khoản phí nào để "rút tiền", "mở khóa", "xác minh".',
  'Gọi tổng đài ngân hàng của bạn (số in trên thẻ/ứng dụng chính thức) nếu đã chuyển tiền hoặc lộ thông tin.',
  'Lưu lại bằng chứng (ảnh chụp màn hình, báo cáo xuất) và trình báo công an nơi cư trú.',
];

/** Người dùng đang hoặc vừa làm theo yêu cầu: lời nhắc dừng lại thay cho lời cảnh báo chung. */
export const COMPLIANCE_SAFETY_MESSAGE =
  'Bạn đang làm hoặc vừa làm theo yêu cầu của đối phương. Đây thường là bước cuối mà kẻ gian chờ đợi, sau nhiều lời trấn an và hứa hẹn. Dừng lại ngay, không gửi mã, không chuyển hay nộp thêm tiền, kể cả khi được bảo là an toàn.';

/** Việc cần làm ngay khi người dùng sắp hoặc đã làm theo yêu cầu. */
const INCIDENT_STEPS: Record<string, string[]> = {
  user_intends_money: [
    'Dừng lại, chưa chuyển khoản này. Lời hứa hoàn tiền, thưởng hay giữ suất là cách để bạn chuyển nhanh.',
    'Tự gọi số tổng đài chính thức của đơn vị được nhắc tới để hỏi lại trước khi làm gì.',
  ],
  user_intends_otp: [
    'Đừng gửi mã và đừng chụp màn hình mã cho ai. Không đơn vị nào cần bạn gửi mã này qua tin nhắn, dù gọi là mã hợp đồng hay mã thành viên.',
    'Nếu đã nhập tài khoản vào trang lạ, đổi mật khẩu ngay trên ứng dụng chính thức và bật xác thực hai lớp.',
  ],
  user_intends_app: [
    'Dừng cài đặt và xóa file vừa tải. Ứng dụng chính thức chỉ tải từ CH Play hoặc App Store.',
    'Nếu đã cài và cấp quyền, ngắt mạng thiết bị và gọi tổng đài ngân hàng theo số in trên thẻ.',
  ],
  user_intends_login: [
    'Đừng nhập tài khoản, mật khẩu vào trang được gửi qua tin nhắn. Tự mở ứng dụng hoặc trang chính thức nếu cần kiểm tra.',
  ],
  user_complied_money: [
    'Gọi ngay tổng đài ngân hàng theo số in trên thẻ để đề nghị tra soát khoản vừa chuyển.',
    'Lưu biên lai, số tài khoản nhận và ảnh chụp đoạn chat, rồi trình báo công an nơi cư trú.',
    'Không chuyển thêm dù được hứa lấy lại tiền.',
  ],
  user_complied_otp: [
    'Gọi ngay tổng đài ngân hàng theo số in trên thẻ để khóa thẻ hoặc tài khoản.',
    'Đổi mật khẩu trên ứng dụng chính thức, và kiểm tra các giao dịch gần đây.',
  ],
  user_complied_app: [
    'Ngắt mạng thiết bị ngay, gỡ ứng dụng vừa cài và tắt các quyền đã cấp.',
    'Dùng thiết bị khác để đổi mật khẩu ngân hàng, và gọi tổng đài ngân hàng theo số in trên thẻ.',
  ],
  user_complied_login: [
    'Đổi ngay mật khẩu trên trang hoặc ứng dụng chính thức, và đổi cả ở nơi dùng chung mật khẩu đó.',
    'Bật xác thực hai lớp và đăng xuất các phiên đăng nhập lạ.',
  ],
};

export function buildAdvice(level: RiskLevel, signals: Signal[], safetyPriority: boolean, ctx?: AdviceContext): Advice {
  const steps = signals.flatMap((s) => INCIDENT_STEPS[s.type] ?? []);
  const actions = [...new Set([...steps, ...LEVEL_ACTIONS[level]])];
  for (const s of signals) {
    if (!actions.includes(s.recommended_action)) actions.push(s.recommended_action);
  }
  if (safetyPriority) {
    // Mức Nghiêm trọng: TẮT câu hỏi thăm dò, không khuyến khích tiếp tục tương tác.
    // Nguy hiểm thân thể (cô lập, đe dọa, ảnh nhạy cảm) và bẫy tài chính/mã độc có hướng dẫn khác nhau.
    const physical = signals.some(
      (s) => s.direct_danger && (PHYSICAL.has(s.category) || s.type === 'intimate_image_request'),
    );
    if (!physical) {
      const fin = [...new Set([...steps, ...CRITICAL_FINANCIAL_ACTIONS, ...actions.slice(steps.length + LEVEL_ACTIONS.critical.length)])];
      return { actions: fin, questions: [], safety_message: steps.length ? COMPLIANCE_SAFETY_MESSAGE : FINANCIAL_SAFETY_MESSAGE, support_resources: SUPPORT_RESOURCES };
    }
    return { actions, questions: [], safety_message: SAFETY_MESSAGE, support_resources: SUPPORT_RESOURCES };
  }
  // Đã làm theo yêu cầu thì việc gấp là xử lý hậu quả, không phải hỏi thêm đối phương.
  if (steps.length) return { actions, questions: [] };
  if (!ctx) {
    const questions: string[] = [];
    for (const s of signals) {
      const q = QUESTIONS[s.type];
      if (q && !questions.includes(q)) questions.push(q);
    }
    return { actions, questions: questions.slice(0, 4) };
  }

  // Theo diễn biến: tín hiệu có bằng chứng mới nhất đứng trước. Cùng tin thì tín hiệu vừa xuất hiện đứng trước tín hiệu đã có từ trước.
  const seqOf = new Map(ctx.messages.map((m) => [m.id, m.seq]));
  const seqs = (s: Signal) => s.evidence_message_ids.map((id) => seqOf.get(id) ?? 0);
  const byRecency = signals
    .map((s, i) => ({ s, i, seq: Math.max(0, ...seqs(s)), first: Math.min(...seqs(s), Number.MAX_SAFE_INTEGER) }))
    .sort((a, b) => b.seq - a.seq || b.first - a.first || a.i - b.i);
  const selfTexts = ctx.messages.filter((m) => m.sender === 'self').map((m) => m.text);
  const focus_title = byRecency[0]?.s.title;
  const next = ctx.nextStep;

  const lastOtherSeq = Math.max(0, ...ctx.messages.filter((m) => m.sender !== 'self').map((m) => m.seq));
  const fresh: string[] = [];
  const older: string[] = [];
  for (const { s, seq, first } of byRecency) {
    const q = QUESTIONS[s.type];
    if (!q || fresh.includes(q) || older.includes(q) || alreadyAsked(q, selfTexts, s.type)) continue;
    // AI nói chưa cần hỏi: chỉ gợi ý lại khi có dấu hiệu mới sau lần AI đọc.
    if (next && next.question === null && seq <= (next.atSeq ?? 0)) continue;
    (first === lastOtherSeq ? fresh : older).push(q);
  }
  // Dấu hiệu vừa xuất hiện đã có câu luật viết sát: dùng trước. Câu AI lấp chỗ luật đã hết câu để hỏi (EXP-018).
  const aiQuestion = next?.question && !alreadyAsked(next.question, selfTexts) ? next.question : undefined;
  const questions = [...new Set([...fresh, ...(aiQuestion ? [aiQuestion] : []), ...older])];

  // Tin cuối là câu hỏi của người dùng: chờ đối phương trả lời rồi mới gợi ý tiếp.
  const last = ctx.messages.at(-1);
  const waiting = last?.sender === 'self' && (last.text.includes('?') || alreadyAsked(last.text, questions));
  // Chỉ hiện khi AI thấy điều đáng ngờ. "Đã trả lời" sai cả 3 lần thử và dễ khiến người dùng yên tâm sai (EXP-018).
  const assessment = !waiting && (next?.assessment === 'evasive' || next?.assessment === 'contradictory') ? next.assessment : undefined;
  return {
    actions,
    questions: waiting ? [] : questions.slice(0, 4),
    ...(waiting ? { waiting_answer: true } : {}),
    ...(focus_title ? { focus_title } : {}),
    ...(!waiting && questions[0] === aiQuestion && next?.reason ? { question_reason: next.reason } : {}),
    ...(assessment ? { answer_assessment: assessment } : {}),
  };
}
