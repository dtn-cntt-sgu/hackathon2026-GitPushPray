// Chuẩn hóa tiếng Việt đời thường để so khớp quy tắc:
// chữ thường, bỏ dấu, đ→d, gộp khoảng trắng và mở rộng teencode/viết tắt phổ biến.

const TEENCODE: Record<string, string> = {
  ko: 'khong',
  k: 'khong',
  kh: 'khong',
  hok: 'khong',
  khg: 'khong',
  kg: 'khong',
  dc: 'duoc',
  trc: 'truoc',
  ck: 'chuyen khoan',
  stk: 'so tai khoan',
  tk: 'tai khoan',
  sdt: 'so dien thoai',
  dt: 'dien thoai',
  cmnd: 'can cuoc',
  cccd: 'can cuoc',
  cmt: 'can cuoc',
  cty: 'cong ty',
  ib: 'nhan tin',
  inbox: 'nhan tin',
  ns: 'noi',
  mk: 'mat khau',
  pass: 'mat khau',
  password: 'mat khau',
  bm: 'bo me',
  ae: 'anh em',
  nv: 'nhan vien',
  hd: 'hop dong',
  cpc: 'campuchia',
  ok: 'ok',
  tele: 'telegram',
  tg: 'telegram',
  zl: 'zalo',
  fb: 'facebook',
  hh: 'hoa hong',
  ctv: 'cong tac vien',
  acc: 'tai khoan',
  vks: 'vien kiem sat',
};

/** Viết tắt chỉ có nghĩa khi được viết cách quãng bằng dấu chấm/gạch (c.a = công an), tránh nhầm "ca" = ca làm. */
const DOTTED: Record<string, string> = {
  ca: 'cong an',
  nv: 'nhiem vu',
  vks: 'vien kiem sat',
};

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

/**
 * Gỡ ký tự ngắt quãng mà kẻ gian dùng để né lọc từ khóa: "c.h.u.y.e.n" → "chuyen", "s-t-k" → "stk".
 * Chỉ áp dụng cho chuỗi các chữ cái ĐƠN cách nhau bởi . - _ * (không đụng tới số 1.000.000, tên miền).
 */
function joinSpacedLetters(s: string): string {
  return s.replace(/(?<![a-z0-9])[a-z](?:[.\-_*][a-z])+(?![a-z0-9])/g, (m) => {
    const joined = m.replace(/[.\-_*]/g, '');
    return DOTTED[joined] ?? joined;
  });
}

/** Leetspeak trong từ: "ti3n" → "tien", "v0n" → "von" (chỉ khi số nằm GIỮA hai chữ cái). */
function unLeet(s: string): string {
  return s.replace(/(?<=[a-z])[013457](?=[a-z])/g, (d) => LEET[d] ?? d);
}

/** Bỏ dấu tiếng Việt, giữ nguyên độ dài theo ký tự gốc khi có thể. */
export function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Văn bản dùng để so khớp quy tắc. Số đi liền đơn vị như "500k", "8tr" được tách
 * thành "500 nghin", "8 trieu" để không bị nhầm "k" = "không".
 */
export function normalizeForMatch(input: string): string {
  let s = stripDiacritics(input.toLowerCase());
  s = s.replace(/[\u200b-\u200d\ufeff]/g, '');
  // Gạch dưới chen trong từ để né lọc: "tj_e_n", "n_h_a". Không đụng từ đứng một mình.
  s = s.replace(/(?<=[a-z0-9])_(?=[a-z0-9])/g, '');
  s = joinSpacedLetters(s);
  s = unLeet(s);
  // Tiếng Việt không có "j": "thj", "ch0j", "tjm" là cách viết của "i". Giữ "j" đầu từ vì có "job", "jup".
  s = s.replace(/(?<=[a-z])j/g, 'i');
  // Đơn vị tiền dính số: 500k, 1.5tr, 8 tr, 10 củ
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(k|ng|ngan|nghin)\b/g, '$1 nghin');
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(tr|trieu|cu|m)\b/g, '$1 trieu');
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(ty|ti)\b/g, '$1 ty');
  // Tách dấu câu khỏi từ, giữ lại . , ! ? / % để regex dùng làm ranh giới
  s = s.replace(/([!?;:()"“”'/%])/g, ' $1 ');
  // Dấu . , giữa hai chữ số (1.5, 8,5) là phần của số; còn lại là dấu câu
  s = s.replace(/(?<!\d)[.,]|[.,](?!\d)/g, (m) => ` ${m} `);
  const words = s.split(/\s+/).filter(Boolean);
  const expanded = words.map((w) => TEENCODE[w] ?? w).join(' ');
  // "nv" mặc định là "nhân viên"; trong ngữ cảnh làm/nhận/hoàn thành thì là "nhiệm vụ"
  return expanded
    .replace(/\b(lam|nhan|hoan thanh|xong|giao) nhan vien\b/g, '$1 nhiem vu')
    .replace(/\bnhan vien (\d+|dau tien|cuoi|tiep theo|phuc loi|kep)\b/g, 'nhiem vu $1');
}
