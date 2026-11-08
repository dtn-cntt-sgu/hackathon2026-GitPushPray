import type { Rule } from './rule';

// Nhóm 1, 4, 6 (tonghopkichban.md): mạo danh cơ quan, giả người quen mượn tiền, lừa đảo kép thu hồi tiền.
/** Cơ quan thật mời ra trụ sở làm thủ tục. "Không cần ra phường" lại là lời của kẻ gian nên không được loại trừ. */
const GO_TO_OFFICE = /(?<!\b(khong can|khoi|chua|khong)\s)\b(ra|den|len|qua) (phuong|xa|cong an (phuong|xa)|tru so|bo phan mot cua|cua hang (viettel|vnpt|mobifone))\b/;
const ID_RECORD = String.raw`(ho so|ma|tai khoan|muc) dinh danh|dinh danh (muc( do)? 2|dien tu)|can cuoc gan chip|vneid`;

export const impersonationRules: Rule[] = [
  {
    type: 'gov_id_claim',
    category: 'impersonation',
    severity: 'medium',
    title: 'Nhắn báo lỗi hồ sơ định danh, căn cước',
    explanation: 'Có tin nhắn báo hồ sơ định danh hoặc căn cước bị lỗi và cần bổ sung. Cơ quan thật thường mời ra trụ sở, không xử lý qua tin nhắn cá nhân.',
    recommended_action: 'Không làm theo qua tin nhắn. Tự kiểm tra trong ứng dụng VNeID chính thức hoặc ra công an phường, xã.',
    patterns: [
      new RegExp(`\\b(${ID_RECORD})\\b.{0,40}\\b(bi loi|loi dong bo|chua dong bo|khong hop le|sai thong tin|can bo sung)\\b`),
      new RegExp(`\\b(bi loi|loi dong bo|bo sung gap)\\b.{0,40}\\b(${ID_RECORD})\\b`),
    ],
    exclude: [GO_TO_OFFICE],
  },
  {
    type: 'gov_id_pressure',
    category: 'impersonation',
    severity: 'high',
    title: 'Dọa khóa định danh, dẫn sang làm thủ tục từ xa',
    explanation: 'Đối phương dọa khóa mã định danh hoặc mất quyền làm giấy tờ nếu không cập nhật gấp, hoặc dẫn sang Zalo gặp "cán bộ" để làm thủ tục từ xa. Cơ quan thật không xử lý hồ sơ theo cách này.',
    recommended_action: 'Không kết bạn, không quét khuôn mặt, không tải gì theo hướng dẫn. Gọi hoặc ra công an phường, xã để kiểm tra.',
    requireOneOf: [1, 2],
    exclude: [GO_TO_OFFICE],
    groups: [
      [new RegExp(`\\b(${ID_RECORD}|dich vu cong|ban ho tro de an|thu tuc hanh chinh|ho so cua (chi|anh|em|ban))\\b`)],
      [
        /\b(ma dinh danh|dinh danh|tai khoan dinh danh|can cuoc|ho so)\b.{0,20}\b(bi )?(tam )?khoa\b/,
        /\b(neu|khong)\b.{0,30}\b(cap nhat|bo sung)\b.{0,30}\b(bi )?(tam )?khoa\b/,
        /\b(lam|cap)\b.{0,8}\b(ho chieu|giay to)\b.{0,20}\bkhong (duoc|lam duoc)\b/,
      ],
      [
        /\bket ban zalo\b.{0,40}\b(can bo|chuyen trach|huong dan|ho tro)\b/,
        /\b(can bo|nhan vien)\b.{0,15}\b(chuyen trach|ky thuat)\b.{0,30}\b(huong dan|xu ly|ho so)\b/,
        /\bho tro tu xa\b.{0,50}\b(cong dan|dich vu cong|ho so|phan mem)\b/,
        /\bquet khuon mat\b.{0,20}\b(tai nha|2 phut|online|tu xa|la xong)\b/,
      ],
    ],
  },
  {
    ref: 'R01',
    type: 'authority_impersonation',
    category: 'impersonation',
    severity: 'critical',
    direct_danger: true,
    title: 'Mạo danh công an/viện kiểm sát, đe dọa liên quan vụ án',
    explanation:
      'Đối phương tự xưng cơ quan pháp luật, nói bạn liên quan vụ án/đường dây và yêu cầu chuyển tiền "xác minh" hoặc giữ bí mật. Cơ quan chức năng không làm việc qua tin nhắn mạng xã hội và không yêu cầu chuyển tiền để chứng minh trong sạch.',
    recommended_action:
      'Không chuyển tiền, không cung cấp thông tin. Ngừng trò chuyện và tự liên hệ công an phường/xã nơi cư trú qua kênh chính thức.',
    requireOneOf: [0],
    groups: [
      [/\b(cong an|vien kiem sat|toa an|bo cong an|co quan dieu tra|canh sat (hinh su|kinh te)?|dieu tra vien|can bo (cong an|dieu tra)|cuc canh sat)\b/],
      [/\b(lenh bat|bat (tam )?giam|khoi to|truy na|giay trieu tap|rua tien|ma tuy|duong day (rua tien|ma tuy|lua dao|toi pham)|lien quan (den|toi) (vu an|duong day|toi pham))\b/],
      [
        /\btai khoan (an toan|tam giu|dieu tra|phong toa|cua (co quan|bo cong an|toa an))\b/,
        /\b(chung minh|xac minh|kiem tra) (nguon tien|tai san|dong tien|trong sach)\b/,
        /\bchuyen (toan bo|het|tat ca) (tien|tai san|so du)\b/,
      ],
      [/\b(bao mat tuyet doi|bi mat (dieu tra|nha nuoc)|khong duoc (noi|ke|tiet lo|cho biet)|phong kin|o mot minh|thue phong (khach san|nha nghi))\b/],
    ],
  },
  {
    ref: 'R06',
    type: 'account_takeover_borrow',
    category: 'impersonation',
    severity: 'high',
    title: 'Nghi tài khoản người quen bị chiếm, nhờ chuyển tiền gấp',
    explanation:
      'Có yêu cầu chuyển tiền gấp/hộ, viện cớ ngân hàng lỗi, mạng yếu hoặc không nghe máy được — kiểu thường gặp khi tài khoản người quen bị chiếm hoặc dùng deepfake.',
    recommended_action:
      'Gọi điện trực tiếp tới số điện thoại bạn đã lưu của người đó (không gọi qua ứng dụng chat) để xác minh trước khi chuyển tiền.',
    requireOneOf: [0],
    groups: [
      [
        /\b(chuyen (gap|tam|giup|ho|nho)|cho (muon|vay) (tam|gap|it)|cuu (gap|voi|tao|minh|em|anh|chi)|ban (qua|sang) (giup|ho|tam)|muon (tam|gap)|ung (tam|truoc) (giup|ho))\b/,
        // Phát hiện từ tune bộ v2: giả người thân cần tiền cấp cứu
        /\bchuyen khoan (gap|giup|ho|le|nhanh)\b/,
        /\bcan gap \d+(?:[.,]\d+)? (nghin|trieu)\b/,
      ],
      [
        /\b(ngan hang|app( ngan hang)?)\b.{0,15}\b(bao tri|bi loi|dang loi|bi khoa)\b/,
        /\bhan muc\b.{0,10}\b(het|vuot)\b/,
        /\b(chuyen|ban) (nho|qua|vao) (tai khoan|so tai khoan) (cua )?(ban|nguoi khac|ho|ban minh|nguoi nha)\b/,
        /\b(tai khoan|ung dung)\b.{0,12}\bbi khoa\b/,
        /\b(vao|qua) (tai khoan|so tai khoan) (cua )?ban\b/,
        /\b(tien vien|vien phi|phong mo|cap cuu|bi tai nan)\b/,
      ],
      [/\b(mang (yeu|lag|cham)|lag (qua|lam)|hong (mic|loa|camera)|khong (nghe|goi) (may|duoc)|dang (ban )?hop|song yeu|goi video\b.{0,12}\b(lag|mo|giat))\b/],
      [/\b(chieu|toi|mai|ti nua|ti xiu|xong)\b.{0,12}\btra (lien|ngay|lai|ban|may|nhe)\b/],
    ],
  },
  {
    type: 'borrow_request',
    category: 'finance',
    severity: 'medium',
    title: 'Nhờ mượn/ứng tiền qua tin nhắn',
    explanation:
      'Có lời nhờ mượn hoặc ứng tiền qua tin nhắn. Tài khoản người quen có thể đã bị chiếm — chưa thấy bước xác minh người thật.',
    recommended_action: 'Gọi điện trực tiếp tới số bạn đã lưu của người đó (không qua ứng dụng chat) trước khi chuyển tiền.',
    patterns: [
      /\b(cho|giup) (tao|minh|em|anh|chi|to|tui|toi) (muon|vay) (tam |gap |it |chut )?\d/,
      /\b(cho|giup) (tao|minh|em|anh|chi|to|tui|toi) (muon|vay) (tam |gap |it |chut )?(tien|it tien)\b/,
      /\bmuon tam\b.{0,15}\b(\d|tien)/,
      /\bung (tam|truoc) (giup|ho|cho)\b/,
    ],
  },
  {
    ref: 'R09',
    type: 'recovery_scam',
    category: 'impersonation',
    severity: 'critical',
    title: 'Lừa đảo kép: hứa thu hồi tiền đã bị lừa',
    explanation:
      'Đối phương hứa lấy lại tiền đã mất (tự xưng luật sư, an ninh mạng, hacker) và đòi phí trước. Không ai can thiệp được hệ thống ngân hàng để "kéo" tiền về.',
    recommended_action:
      'Không đóng bất kỳ khoản phí "thu hồi" nào. Trình báo công an nơi cư trú và liên hệ trực tiếp ngân hàng của bạn.',
    requireOneOf: [0, 2],
    groups: [
      [/\b(ho tro (thu hoi|lay lai)|lay lai (tien|von|tai san) (bi lua|da mat|bi mat)|thu hoi (von|tien|tai san)|truy thu (dong tien|tien))\b/],
      [/\b(van phong luat|luat su|doi ngu (an ninh mang|ky thuat)|hacker|can thiep (he thong|cong thanh toan|ngan hang)|an ninh mang)\b/],
      [/\b(tien|khoan tien)\b.{0,15}\b(bi treo|dang treo|bi giu|phong toa)\b/, /\blien ngan hang\b/],
      [/\b(phi (kich hoat )?hoan tien|phi (ho so|mo luong|to tung|phap ly|dich vu|thu hoi)|nap tien doi ung|dong (truoc )?phi)\b/],
    ],
  },
];
