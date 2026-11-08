import type { Rule } from './rule';

// Nhóm 2 (tonghopkichban.md): đầu tư tài chính ảo, "mổ lợn", bẫy vay online.
export const investmentRules: Rule[] = [
  {
    ref: 'R05',
    type: 'investment_scam',
    category: 'investment',
    severity: 'high',
    title: 'Dụ đầu tư sàn ảo / cam kết lợi nhuận',
    explanation:
      'Có lời mời đầu tư kèm "kéo lệnh 1-1", cam kết lợi nhuận/bao lỗ, sàn quốc tế, tiền ảo, hoặc đòi nộp thuế/phí mới cho rút tiền.',
    recommended_action:
      'Không đầu tư theo lời mời qua mạng. Không có khoản đầu tư hợp pháp nào cam kết bao lỗ hoặc bắt nộp thêm tiền mới cho rút gốc.',
    requireOneOf: [1, 3],
    groups: [
      [/\b(keo (1-1|mot kem mot|lenh)|ban tin hieu|thay (doc lenh|dau tu)|chuyen gia (phan tich|tai chinh|dau tu)|nhom (dau tu|tin hieu)|room (dau tu|vip)|doc lenh)\b/],
      [
        /\b(cam ket (bao lo|loi nhuan|lai)|bao lo|lai kep|khong the lo|chac chan (lai|thang)|x\d+ tai khoan)\b/,
        /\bloi nhuan \d+(?:[.,]\d+)? ?%/,
        /\b(bao thang|song bao thang|khop lenh dep|cau hinh thuat toan)\b/,
      ],
      [/\b(nap usdt|usdt|san (quoc te|ngoai hoi|forex|crypto|coin)|forex|co phieu noi bo|quyen chon nhi phan|binary option|tien (ao|dien tu|ma hoa)|bitcoin|binance|tai khoan san|san nay|ma eth)\b/],
      [/\b(dong thue\b.{0,20}\brut|phi (xac minh|chong) rua tien|phi bao hiem von|ky quy|(nop|dong) (thue|phi)\b.{0,10}\b(de|moi duoc) rut|nang hang tai khoan)\b/],
    ],
  },
  {
    type: 'romance_investment',
    category: 'investment',
    severity: 'high',
    title: 'Dùng tình cảm để dụ nạp tiền đầu tư',
    explanation: 'Đối phương gắn chuyện tình cảm, tương lai chung với yêu cầu nạp tiền hoặc góp vốn vào sàn, dự án. Đây là kiểu "mổ lợn": tạo lòng tin rồi dụ nạp ngày càng nhiều.',
    recommended_action: 'Không nạp tiền vì tình cảm hay vì sợ mất lòng. Hỏi người thân, kiểm tra sàn qua nguồn chính thức, và thử yêu cầu rút toàn bộ tiền trước khi làm gì thêm.',
    groups: [
      [/\b(moi quan he cua|tuong lai hai dua|tuong lai cua (hai dua|tui minh)|mua nha chung|tinh cam cua|em thuong (lam|anh)|anh thuong em|gap mat gia dinh|tin tuong va ton trong)\b/],
      [/\b(nap (het|them)|gom het von|tien tiet kiem|lenh dang treo|cuu (cai )?lenh|san nay|du an nay|tai khoan san|khop lenh)\b/],
    ],
  },
  {
    ref: 'R07',
    type: 'loan_app_trap',
    category: 'finance',
    severity: 'high',
    title: 'Bẫy vay online: khoản vay "đóng băng", đòi phí giải ngân',
    explanation:
      'Khoản vay được "duyệt" rồi bị báo sai số tài khoản/đóng băng, yêu cầu nộp phí hoặc chuyển khoản đối ứng để giải ngân.',
    recommended_action:
      'Không chuyển tiền để "mở khóa" khoản vay. Ngân hàng/công ty tài chính hợp pháp không yêu cầu người vay chuyển tiền trước để giải ngân.',
    requireOneOf: [1, 2],
    groups: [
      [/\b(khoan vay\b.{0,10}\b(duyet|phe duyet)|ho tro (no xau|vay)|giai ngan (trong|nhanh|ngay)|vay (online|nhanh|tin chap)|duyet vay|vay khong (can )?(the chap|chung minh))\b/],
      [/\b(nhap sai (so tai khoan|thong tin)|sai thong tin (hop dong|tai khoan|nguoi nhan)|khoan vay\b.{0,6}\b(dong bang|treo|tam giu))\b/],
      [
        /\b(chuyen khoan doi ung|doi ung|kich hoat (lai )?(ma )?giai ngan|phi (giai ngan|mo khoa|xac minh) (khoan vay|ho so)?)\b/,
        /\bnop \d+(?:[.,]\d+)? ?% /,
      ],
      [/\b(khoi kien\b.{0,10}\bhuy|van phai tra (no|gop)|huy hop dong\b.{0,10}\b(boi thuong|den bu))\b/],
    ],
  },
  {
    // Bước đầu của bẫy vay (trước R07): chào mời vay dễ dãi rồi dẫn tải app / bấm link / điền thông tin / kết bạn riêng.
    // Phát hiện từ dev dữ liệu ngoài (cuộc gọi "vay vốn" — nhóm bị bỏ sót nhiều nhất).
    type: 'loan_offer_app',
    category: 'finance',
    severity: 'high',
    title: 'Chào mời vay dễ dãi, dẫn tải app / bấm link / kết bạn riêng',
    explanation:
      'Đối phương chủ động mời vay "lãi suất thấp, không cần thế chấp, duyệt nhanh" rồi hướng dẫn tải ứng dụng, bấm link, điền thông tin cá nhân hoặc kết bạn Zalo. Đây là bước đầu thường gặp của bẫy vay online: thu thập thông tin, cài app giả, sau đó đòi phí giải ngân.',
    recommended_action:
      'Không tải app hay bấm link do người lạ gửi. Nếu cần vay, tự đến chi nhánh hoặc dùng ứng dụng chính thức tìm theo tên ngân hàng trên kho ứng dụng.',
    minGroups: 3,
    // Dạng tin nhắn ngắn ("VAY GẤP, chỉ cần CCCD, không thẩm định. Gọi/Zalo…") bổ sung từ dev SMS
    groups: [
      [/\b(goi vay|cho vay|khoan vay|han muc vay|vay (von|tin chap|tieu dung|uu dai|online|nhanh|gap|nong|tien nong|ngay)|xoay vong von|ho tro (vay|tai chinh|no xau))\b/],
      [
        /\b(lai suat\b.{0,12}\b(thap|uu dai|chi|tu|\d)|khong can (tai san )?(the chap|chung minh)|duyet (nhanh|ngay|trong ngay|lien)|giai ngan (nhanh|ngay|luon|lien|trong|sau)|thu tuc (don gian|nhanh|gon))\b/,
        /\b(khong (can )?tham dinh|chi can (cmnd|cccd|can cuoc|chung minh|so dien thoai)|no xau (van|cung) (vay|duoc))\b/,
      ],
      [
        /\b(tai (app|ung dung)|cai (app|ung dung)|(bam|nhan|vao) (vao )?(link|duong link)|link (em|ben em|minh) gui|dien (thong tin|ho so)|ket ban zalo|zalo (em|minh)|quet (ma )?qr|cung cap (vai |mot so )?thong tin)\b/,
        /\b(goi|nhan tin|lien he|lh)\s*\/\s*zalo\b|\b(lien he|lh|nhan tin) (qua )?zalo\b|\bkich hoat\b/,
      ],
    ],
  },
];
