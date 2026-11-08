import type { Rule } from './rule';

/**
 * Cách nói đòi thêm tiền, không phụ thuộc số tiền. Đứng một mình chỉ ở mức Cần chú ý vì đời thường cũng dùng,
 * ghép với ngữ cảnh mới lên mức cao hơn. "cọc" không dấu trùng "cốc" nên phải đi kèm từ khác.
 */
const MONEY_REQUEST: RegExp[] = [
  /\bnap (lai|du|von|vao (vi|tai khoan|san|he thong))\b/,
  /\b(vao|bom) (them )?von\b/,
  /\b(dong|nop|gop|bu) them\b(?! y kien)/,
  /\b(chuyen|gui|tra|chuyen khoan) them\b(?! (anh|hinh|file|thong tin|tai lieu|tin|video|link|hang|do|mau|cau|loi))/,
  /\bbu (tien|von|phi|khoan)\b/,
  /(?<!\b(kiem|lam|co|duoc|nhan) )\bthem (tien|phi|khoan (tien|phi|nua))\b/,
  // "tiền cọc" đứng một mình thường là kể lại ("chủ trọ trả lại tiền cọc"); đòi đóng cọc đã có ở upfront_fee.
  /\b(coc giu (cho|hang|suat|phong)|coc (giup|di|ngay|nhe|luon)|coc nha\s*[.!]?$)\b/,
  /\b(ky quy|the chan|tien bao lanh|tien giu cho)\b/,
  /\bung truoc\b(?! (tien )?luong)/,
  /\b(dong|nop|chuyen|thanh toan|tra)\b.{0,15}\bphi (rut|mo khoa|giai ngan|hai quan|chuyen doi|giai phong)\b/,
  /\b(dong|nop|chuyen)\b.{0,10}\b(thue|le phi)\b.{0,30}\b(nhan|rut|lanh)\b/,
];
/** Việc thường ngày có cùng cách nói: tin nhà mạng, phí ship, mua thêm hàng, thẻ xe, công ty đóng bảo hiểm cho nhân viên. */
const MONEY_REQUEST_EXCLUDE = [
  /\b(dien thoai|the cao|the nap|nap the|vien thong|thue bao|data|goi cuoc|dang ky goi|tra sau)\b/,
  /\bky hop dong\b.{0,20}\b(tai|truc tiep)\b/,
  /\b(phi ship|phi van chuyen|phi giao hang|mua them|the xe|xe buyt|the gui xe)\b/,
  /\bcong ty (se )?(dong|tra|chuyen) them\b/,
];
/** Lý do hợp thức cho việc đòi tiền thì lên mức Cao. */
export const MONEY_CONTEXT: RegExp[] = [
  // Việc làm, nhiệm vụ
  /\b(nhiem vu|hoa hong|cong tac vien|tuyen (dung|nhan vien)|nhan viec|viec lam|lam them|don ao|chot don|giat don)\b/,
  // Hứa trả lại
  /\b(hoan (lai|tien|von)|rut (duoc|tien|het)|nhan lai|lay lai|duoc tra lai|gap doi)\b/,
  // Giục gấp. "gấp" và "ngày" không dấu trùng từ khác nên phải đi cụm.
  /\b(han cuoi|mat suat|het suat|het cho|chi con|sap het|trong hom nay|ngay lap tuc|ngay bay gio|can gap|chuyen gap)\b/,
  // Giá trị hứa hẹn quá cao
  /\b(cam ket (loi nhuan|lai|khong lo)|lai \d+ ?%|khong lo|trung thuong|nhan thuong|loi nhuan)\b/,
];
const MONEY_THREAT = [/\b(dong bang|bi tich thu|mat (het|toan bo|sach)|bi khoa vinh vien|khong rut duoc)\b/];

export const financeRules: Rule[] = [
  {
    // Giai đoạn cuối của lừa đầu tư, nhiệm vụ, vay: tiền đã nằm "trong hệ thống", muốn rút phải nộp thêm.
    type: 'withdrawal_fee',
    category: 'finance',
    severity: 'critical',
    title: 'Đòi nộp phí hoặc thuế mới cho rút tiền',
    explanation: 'Đối phương nói muốn rút tiền, nhận lại tiền hay giải ngân thì phải nộp thêm phí hoặc thuế. Nơi làm ăn thật trừ phí vào số tiền rút, không bắt nộp thêm. Đây là bước cuối để lấy thêm tiền của bạn.',
    recommended_action: 'Dừng ngay, không nộp thêm bất kỳ khoản nào. Số tiền đã nộp gần như không lấy lại được bằng cách nộp thêm. Lưu bằng chứng, báo ngân hàng và công an.',
    negatable: true,
    patterns: [
      /\b(muon|de|moi|thi moi) (rut|nhan lai|lay lai|giai ngan|mo khoa)\b.{0,40}\b(dong|nop|chuyen|nap)\b.{0,20}\b(thue|phi|le phi|tien)\b/,
      /\b(dong|nop|chuyen|nap)\b.{0,20}\b(thue|phi|le phi)\b.{0,30}\b(de|moi|thi moi|truoc khi) (rut|nhan lai|giai ngan|mo khoa|lay lai)\b/,
    ],
  },
  {
    type: 'money_request_phrase',
    category: 'finance',
    severity: 'medium',
    title: 'Đề nghị đóng, nạp hoặc chuyển thêm tiền',
    explanation: 'Đối phương đề nghị đóng thêm, nạp thêm, đặt cọc hoặc một khoản tiền trước. Chưa thấy lý do rõ ràng cho khoản này.',
    recommended_action: 'Hỏi rõ khoản tiền này để làm gì và kiểm tra người nhận trước khi chuyển.',
    negatable: true,
    exclude: MONEY_REQUEST_EXCLUDE,
    patterns: MONEY_REQUEST,
  },
  {
    type: 'money_request_context',
    category: 'finance',
    severity: 'high',
    title: 'Đòi thêm tiền kèm lời hứa, việc làm hoặc giục gấp',
    explanation: 'Đối phương đòi thêm tiền và gắn với công việc, lời hứa hoàn tiền, lợi nhuận cao hoặc hạn gấp. Đây là cách thường gặp để khiến người nhận chuyển tiền trước khi kịp kiểm tra.',
    recommended_action: 'Không chuyển tiền chỉ vì lời hứa hay hạn gấp. Dừng lại, kiểm tra đơn vị qua kênh độc lập.',
    negatable: true,
    negatableGroups: [0],
    exclude: MONEY_REQUEST_EXCLUDE,
    requireOneOf: [0],
    groups: [MONEY_REQUEST, MONEY_CONTEXT],
  },
  {
    type: 'money_request_threat',
    category: 'finance',
    severity: 'critical',
    title: 'Đòi thêm tiền kèm dọa mất tiền đã nạp',
    explanation: 'Đối phương đòi thêm tiền và dọa đóng băng hoặc mất số tiền đã có. Nạp thêm thường không lấy lại được tiền cũ.',
    recommended_action: 'Dừng ngay, không chuyển thêm. Lưu bằng chứng, báo ngân hàng và trình báo công an.',
    negatable: true,
    negatableGroups: [0],
    exclude: MONEY_REQUEST_EXCLUDE,
    requireOneOf: [0],
    groups: [MONEY_REQUEST, MONEY_THREAT],
  },
  {
    type: 'upfront_fee',
    category: 'finance',
    severity: 'high',
    title: 'Yêu cầu đóng phí/đặt cọc trước khi nhận việc',
    explanation:
      'Có yêu cầu đóng phí, đặt cọc hoặc nộp tiền để được nhận việc. Đơn vị tuyển dụng hợp pháp thường không thu phí của ứng viên.',
    recommended_action: 'Không chuyển tiền trước khi xác minh độc lập đơn vị tuyển dụng và có văn bản nêu rõ khoản phí.',
    negatable: true,
    // Đặt qua kênh chính thức là giao dịch thường. Tin có kèm link thì không loại, vì link có thể là trang giả.
    exclude: [/^(?!.*(https?|www|\.\s*[a-z]{2,}\s*\/)).*\b(qua|tren) (website|trang web|ung dung|app) chinh thuc\b/],
    patterns: [
      // "có tiện tham gia" sau khi bỏ dấu thành "co tien tham gia", không phải tiền tham gia
      /(?<!\bco )\b(phi|le phi|tien) (ho so|kich hoat|dang ky|dao tao|dong phuc|giu cho|bao hiem|the chan|xu ly|mo tai khoan|nhan viec|tham gia|giu suat|lam the|xac minh|bao dam|dam bao|thu tuc|giu viec)\b/,
      /\b(dong|nop|chuyen|gui) (truoc )?(tien |them )?(coc|phi|le phi|tien coc)\b/,
      /\bdat coc\b/,
      /\bcoc truoc\b/,
      // "chuyển 100k tiền công" là trả cho người nhận, không phải đòi người nhận nộp tiền
      /\b(dong|nop|chuyen) (truoc )?\d+(?:[.,]\d+)? (nghin|trieu)\b(?! (tien )?(cong|luong)\b)/,
    ],
  },
  {
    type: 'money_transfer',
    category: 'finance',
    severity: 'medium',
    title: 'Đề nghị chuyển khoản',
    explanation: 'Đối phương đề nghị chuyển khoản hoặc gửi tiền vào một tài khoản.',
    recommended_action: 'Chỉ chuyển tiền khi đã xác minh người nhận qua kênh độc lập và có lý do rõ ràng bằng văn bản.',
    negatable: true,
    patterns: [
      // "chuyển khoản lương cho em" là trả cho người nhận
      /\bchuyen khoan\b(?! (tien )?(luong|cong)\b).{0,30}\b(vao|qua|cho|truoc|so tai khoan)\b/,
      /\b(chuyen|gui) (tien )?(truoc )?(vao|qua|cho) (so tai khoan|tai khoan|ben (minh|em|anh|chi|cong ty))\b/,
      /\bchuyen (tien )?truoc\b/,
      // "bạn chuyển STK 123456789": có số ngay sau để không bắt "chuyển số tài khoản cho công ty làm lương"
      /\bchuyen (tien )?so tai khoan \d/,
    ],
  },
  {
    type: 'task_deposit',
    category: 'finance',
    severity: 'high',
    title: 'Nạp tiền làm nhiệm vụ / hoàn tiền kèm hoa hồng',
    explanation:
      'Có dấu hiệu mô hình "làm nhiệm vụ", nạp tiền để nhận hoa hồng hoặc chốt đơn ảo — kiểu lừa đảo việc làm online phổ biến.',
    recommended_action: 'Không nạp tiền để "làm nhiệm vụ". Các khoản hoa hồng ban đầu thường chỉ để tạo lòng tin.',
    // "không cần nạp thêm" là lời trấn an, không phải yêu cầu.
    negatable: true,
    // Nạp tiền trong game hoặc góp tiền tài khoản xem phim dùng chung không phải mô hình làm nhiệm vụ.
    exclude: [/\b(acc game|choi game|leo rank|trang phuc|netflix|spotify|youtube premium)\b/],
    patterns: [
      // Không tính tin báo "đã được nạp" và nạp tiền điện thoại/thẻ cào/data (phát hiện từ dev SMS)
      /(?<!\b(da|vua|duoc) (duoc )?)\bnap (tien|them|\d+)(?!.{0,25}\b(vao (tkc|tai khoan chinh|thue bao|sim|so dien thoai|dien thoai)|card|the cao|data|goi cuoc|dien thoai)\b)/,
      /\b(lam|nhan) nhiem vu\b.{0,40}\b(hoa hong|hoan tien|nap|thuong)\b/,
      /\bhoan (lai )?(tien|von)\b.{0,30}\bhoa hong\b/,
      // Ứng tiền trước rồi hứa hoàn kèm hoa hồng. Bắt buộc có "hoàn/hoa hồng" để không bắt "tạm ứng lương"
      /\bung (truoc )?\d+(?:[.,]\d+)? (nghin|trieu)\b.{0,60}\b(hoan|hoa hong)\b/,
      /\bhoa hong \d+(?:[.,]\d+)? ?%/,
      /\b(chot|tao) don (ao|hang)\b/,
      /\b(dau tu|gop von)\b.{0,40}\b(loi nhuan|lai|hoa hong)\b/,
      // Phát hiện từ tune bộ v2: nạp để kích hoạt ví nhận lương, đơn cao cấp, combo, nhóm hoàn %
      /\bnap\b.{0,12}\b(toi thieu|it nhat)\b/,
      /\bkich hoat\b.{0,10}\bvi\b.{0,25}\b(luong|hoa hong|nhan tien|rut)\b/,
      /\b(don|san pham) (cao cap|combo)\b.{0,50}\b(hoan|thanh toan|lam du)\b/,
      /\b(nhom|nhiem vu|combo)\b.{0,50}\bhoan\b.{0,12}\d+\s*%/,
      /\blam du\b.{0,20}\b(combo|don|nhiem vu)\b/,
    ],
  },
  {
    // Phát hiện từ tune bộ v2: số tiền nạp tăng dần, bảo gom tiền hoặc mượn thêm để nạp. Đây là bước giam tiền.
    type: 'task_escalating_deposit',
    category: 'finance',
    severity: 'critical',
    title: 'Nạp tiền leo thang theo nhiệm vụ, ép gom hoặc mượn thêm tiền',
    explanation:
      'Khoản phải nạp tăng dần kèm lời hứa thưởng, hoàn cao hơn, hoặc được bảo gom tiền, mượn bạn bè để nạp đủ. Đây là bước giam tiền: nạp càng nhiều càng khó lấy lại.',
    recommended_action:
      'Dừng ngay, không nạp thêm và không vay mượn để nạp. Lưu bằng chứng, báo ngân hàng và trình báo công an.',
    requireOneOf: [0],
    groups: [
      [
        /\bnap cang nhieu\b|\bdon cang to\b/,
        /\b(gom tien|muon ban be|muon them|vay them)\b.{0,50}\bnap\b/,
      ],
      [/\b(nhiem vu|hoa hong|don si|don vip|don hang|he thong phan phoi|hoan \d)\b/],
    ],
  },
  {
    // Phát hiện từ tune bộ v2: giữ ghế, giữ chỗ bằng chuyển khoản kèm hạn giờ để không kịp xác minh
    type: 'hold_deposit_deadline',
    category: 'finance',
    severity: 'high',
    title: 'Đòi chuyển khoản giữ chỗ kèm hạn giờ',
    explanation:
      'Có yêu cầu chuyển khoản để giữ ghế, giữ chỗ, kèm dọa bán cho người khác nếu quá hạn. Kẻ gian dùng hạn giờ để bạn không kịp kiểm tra người bán.',
    recommended_action: 'Không chuyển tiền chỉ vì sợ hết chỗ. Đặt qua kênh chính thức của nhà xe, khách sạn và kiểm tra thông tin liên hệ.',
    minGroups: 2,
    groups: [
      [
        /\b(chuyen khoan|chuyen tien|coc|dat coc)\b.{0,40}\bgiu\b.{0,8}\b(ghe|cho|phong|ve|suat|hang)\b/,
        /\bgiu\b.{0,8}\b(ghe|cho|suat)\b.{0,30}\b(chuyen khoan|coc)\b/,
      ],
      [/\bqua \d+\s*(phut|gio)\b/, /\b(ban|nhuong) cho (khach|nguoi) khac\b/],
    ],
  },
  {
    ref: 'R04',
    type: 'task_freeze_extortion',
    category: 'finance',
    severity: 'critical',
    title: 'Bẫy "kẹt lệnh/sai cú pháp", ép nạp thêm để rút tiền',
    explanation:
      'Đối phương báo lỗi hệ thống, sai cú pháp, đóng băng tài khoản hoặc "đơn liên hoàn/đơn cuối" và yêu cầu nạp thêm để rút tiền cũ. Đây là kịch bản giam tiền: nạp thêm bao nhiêu cũng không rút được.',
    recommended_action:
      'Dừng ngay, không nạp thêm bất kỳ khoản nào. Lưu bằng chứng, báo ngân hàng và trình báo công an.',
    requireOneOf: [0, 2],
    groups: [
      [
        /\bsai (noi dung( chuyen khoan)?|cu phap|thao tac|lenh|so tai khoan|ma don)\b/,
        /\bloi (he thong|giao dich|lenh)\b/,
        /\b(he thong|bi|da) dong bang\b/,
        /\bdong bang (tai khoan|so du|tien|lenh|diem)\b/,
        /\b(treo|ket) (tien|lenh|so du|don)\b/,
      ],
      [/\b(don (hang )?(kep|lien hoan|combo|phuc loi|cuoi|tiep theo)|nhiem vu (cuoi|tiep theo|phuc loi|dac biet|kep)|chuoi nhiem vu|goi (vip|nhiem vu))\b/],
      [/\b(nap them|bu (von|tien|so du)|kich hoat (lenh rut|rut tien)|mo khoa (dong bang|tai khoan|lenh|rut)|phi (rut|mo khoa|giai phong))\b/],
      [/\b(bi tich thu|mat (toan bo|het|sach)\b.{0,6}\btien|tin nhiem (bi tru|giam)|han chot|trong (vong )?\d+ (phut|gio)|hoan (ca )?goc (lan|va|kem) lai|qua han)\b/],
    ],
  },
  {
    ref: 'R08',
    type: 'romance_customs_gift',
    category: 'finance',
    severity: 'high',
    title: 'Bẫy nhận quà nước ngoài / "hải quan" giữ hàng đòi phí',
    explanation:
      'Có câu chuyện gửi quà, thùng đô la/trang sức từ nước ngoài rồi "hải quan/công ty vận chuyển" đòi phí thông quan, phí phạt. Hải quan không thu tiền qua tài khoản cá nhân.',
    recommended_action: 'Không chuyển bất kỳ khoản phí nào để "nhận quà". Tự tra cứu và liên hệ cơ quan hải quan qua kênh chính thức.',
    requireOneOf: [2, 3],
    groups: [
      [/\b(gui (kien hang|qua|thung qua|goi qua|do la|usd|vang|trang suc)|thung qua|qua\b.{0,10}\bve viet nam|kien hang\b.{0,6}\bnuoc ngoai)\b/],
      [/\b(hai quan|san bay|cong ty van chuyen|kho van|tam giu (kien hang|hang|qua)|giu hang)\b/],
      [/\b(ngoai te|phi thong quan|phi (chong )?rua tien|thue nhap khau|phi van chuyen quoc te|phi giai phong hang)\b/],
      [/\b(nop phat|dong phat|chuyen (vao|cho) (tai khoan )?(nhan vien|can bo)|tich thu)\b/],
    ],
  },
  // ---- Phát hiện từ dev SMS (dữ liệu ngoài): thẻ tín dụng, đơn hàng/bưu phẩm. Viết theo ý nghĩa kịch bản.
  {
    type: 'bank_alert_callback',
    category: 'impersonation',
    severity: 'high',
    title: 'Cảnh báo giao dịch/khóa thẻ giả, dụ gọi số lạ hoặc bấm link',
    explanation:
      'Tin nhắn báo thẻ/tài khoản vừa bị trừ tiền, có giao dịch bất thường hoặc bị khóa, rồi giục gọi ngay một số điện thoại hoặc bấm link để "khóa thẻ". Kẻ gian dùng nỗi sợ mất tiền để dẫn bạn tới tổng đài/trang giả và lấy thông tin thẻ, OTP.',
    recommended_action:
      'Không gọi số và không bấm link trong tin. Tự mở ứng dụng ngân hàng hoặc gọi số tổng đài in trên mặt sau thẻ để kiểm tra.',
    groups: [
      [
        /\b(the (tin dung|ngan hang|atm|visa|ghi no)|tai khoan( ngan hang)?)\b.{0,40}\b(bi (quet|tru|khoa|tam khoa|dong bang)|vua (bi )?(quet|tru)|giao dich (bat thuong|la|nghi van))\b/,
        /\b(phat hien|canh bao)\b.{0,20}\bgiao dich\b.{0,40}\b(the|tai khoan|nuoc ngoai)\b/,
      ],
      [
        /\bgoi (gap|ngay)\b/,
        /\b(goi|lien he)\b.{0,12}\b(so|hotline|tong dai)\b.{0,6}\d{6,}/,
        /\b(bam|nhan|truy cap) (vao )?(link|duong link|https?)\b/,
        /\b(dong bang|khoa) the\b.{0,10}\b(ngay|gap|khan cap)\b/,
      ],
    ],
  },
  {
    type: 'card_cash_service',
    category: 'finance',
    severity: 'high',
    title: 'Dịch vụ nâng hạn mức / rút tiền thẻ tín dụng qua tin nhắn',
    explanation:
      'Có lời mời nâng hạn mức, mở thẻ nhanh hoặc rút tiền mặt từ thẻ tín dụng, kèm yêu cầu bấm link, gửi ảnh thẻ, cung cấp mã hoặc trả phí. Ngân hàng chỉ thay đổi hạn mức qua ứng dụng/chi nhánh chính thức.',
    recommended_action: 'Không gửi ảnh thẻ, số thẻ hay mã xác thực. Muốn đổi hạn mức, tự liên hệ ngân hàng qua ứng dụng hoặc chi nhánh.',
    groups: [
      [
        /\b((nang|tang|mo|kich hoat|ho tro) han muc (the|tin dung)|han muc (the )?tin dung\b.{0,20}\b(duoc duyet|tang|nang)|rut tien (mat )?(tu )?the( tin dung)?|dao han the|ho tro (rut|dao) (tien )?the|mo the tin dung (online|nhanh|khong can))\b/,
      ],
      [
        /\b(bam|nhan|truy cap|kich hoat)\b.{0,10}\b(link|tai day|duong link|https?)\b/,
        /\b(nhap|cung cap|gui)\b.{0,25}\b(thong tin|so the|anh|hinh|mat truoc|mat sau|ma)\b/,
        /\bphi\b.{0,10}\b(\d|dich vu|kich hoat|mo the|rut)\b/,
        /\b(chuyen khoan|nhan vien (se )?goi|giu may|ket ban zalo)\b/,
      ],
    ],
  },
  {
    type: 'parcel_fee_scam',
    category: 'impersonation',
    severity: 'high',
    title: 'Giả bưu cục/vận chuyển: đơn hàng bị giữ, đòi phí hoặc dọa xử lý',
    explanation:
      'Tin nhắn báo đơn hàng/bưu phẩm đang bị giữ, thiếu cước, thất lạc hoặc chứa giấy tờ pháp lý, rồi đòi chuyển khoản phí, bấm link, liên hệ tổng đài lạ hoặc dọa chuyển công an. Đơn vị vận chuyển thật thu tiền khi giao (COD), không yêu cầu chuyển khoản trước qua tin nhắn.',
    recommended_action:
      'Không chuyển khoản, không bấm link. Tra mã vận đơn trên ứng dụng/website chính thức của đơn vị vận chuyển hoặc sàn đã đặt hàng.',
    groups: [
      [
        /\b(don hang|buu pham|buu kien|kien hang|van don|goi hang|buu dien|buu cuc)\b.{0,40}\b(dang (bi )?giu|bi giu|tam giu|luu kho|thieu (cuoc|phi)|chua (thanh toan|nhan|duoc nhan)|that lac|khong the (giao|lien he)|giao (that bai|khong thanh cong)|tai lieu phap ly|hang cam)\b/,
        /\b(phi (luu kho|luu bai|thong quan)|thieu cuoc)\b/,
      ],
      [
        /\b(thanh toan|chuyen khoan|nop|dong)\b.{0,40}\b(phi|cuoc|so tai khoan|truoc \d)\b/,
        /\b(vao|bam|nhan|truy cap) (vao )?(link|duong link)\b/,
        /\blien he\b.{0,6}\b(tong dai|telegram|zalo|hotline)\b/,
        /\b(cap nhat|xac nhan) (lai )?(thong tin|dia chi|so dien thoai)\b/,
        /\b(qua han|neu khong)\b.{0,30}\b(chuyen|bao|bi)\b.{0,6}\b(cong an|toa an|csgt|xu ly)\b/,
      ],
    ],
  },
];
