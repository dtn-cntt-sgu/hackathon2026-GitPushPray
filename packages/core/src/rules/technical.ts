import type { Rule } from './rule';

// Nhóm 1.2, 4.2 (tonghopkichban.md): mã độc .apk giả dịch vụ công, link bình chọn/QR chiếm tài khoản,
// và điều hướng sang kênh kín.
export const technicalRules: Rule[] = [
  {
    ref: 'R02',
    type: 'malware_apk',
    category: 'technical',
    severity: 'critical',
    direct_danger: true,
    title: 'Dẫn dụ cài ứng dụng ngoài/bật quyền trợ năng',
    explanation:
      'Có hướng dẫn tải file cài đặt (.apk) qua link hoặc bật Quyền trợ năng/chia sẻ màn hình, thường giả danh VNeID, thuế, điện lực. Kẻ gian dùng cách này để điều khiển điện thoại và đọc trộm OTP.',
    recommended_action:
      'Không tải file .apk, không bật Quyền trợ năng. Ứng dụng chính thức chỉ tải từ CH Play/App Store. Nếu đã cài, ngắt mạng và liên hệ ngân hàng ngay.',
    requireOneOf: [0, 2],
    // "không cần quyền trợ năng" là lời trấn an đúng, không phải yêu cầu bật
    negatable: true,
    // Chỉ khi hướng dẫn tải từ kho chính thức. "Chưa lên CH Play nên Google hiểu nhầm" là lời trấn an, không được làm tắt luật.
    // "Không có trên CH Play" nói điều ngược lại nên không được loại trừ.
    exclude: [/(?<!\b(khong co|chua co|khong phai|chua len|chua|khong)\s)\b(tu|tren|vao|o|len) (cua hang |kho ung dung )?(ch play|google play|app store|appstore|cua hang ung dung|kho ung dung)\b(?!.{0,20}\b(chua|khong (co|thay)|nham)\b)/],
    groups: [
      [
        /\bapk\b/,
        /\bfile cai dat\b/,
        /\bcai (dat )?(ung dung|app|phan mem)\b.{0,15}\b(qua|tu|theo|bang) (link|duong dan)\b/,
        /\btai (file|app|ung dung|phan mem)\b.{0,15}\b(link|duong dan)\b/,
        // Phát hiện từ tune bộ v2: không có chữ .apk, cần đi kèm tên dịch vụ công hoặc yêu cầu cấp quyền
        /\b(tai|cai|cai dat)\s+(lai\s+)?(phan mem|ung dung|app)\b/,
        /\b(link|duong dan)\b.{0,20}\btai\s+(phan mem|ung dung|app)\b/,
        /\btai ve\b.{0,12}\bcai( dat)?\b/,
        /\b(van )?tiep tuc cai dat\b|\bcai dat nang cao\b/,
      ],
      [/\b(vneid|dich vu cong|thue dien tu|etax|hoan thue|dien luc|evn|bao hiem xa hoi|bhxh|cuc thue|tong cuc thue|cong an (phuong|xa|khu vuc))\b/],
      [/\b(khong co|chua co|ngoai|chua len)\s+(tren\s+)?(kho ung dung|ch play|google play|app store|appstore)\b/,
        /\b(quyen tro nang|tro nang|accessibility|nguon khong xac dinh|nguon la|cap quyen (man hinh|dieu khien|truy cap)|chia se man hinh|dieu khien tu xa|ultraviewer|teamviewer|anydesk|bat (het|tat ca|toan bo) (cac )?quyen|bo qua canh bao|(van )?tiep tuc cai dat|install anyway|cai dat nang cao|ung dung khong ro nguon goc)\b/,
        // Giả danh cơ quan và yêu cầu cài đặt phải nằm cùng một tin. Nếu tách nhóm, hai tin không liên quan trong cửa sổ sẽ ghép nhầm.
        /\b(dai uy|thuong ta|dong chi|can bo|bo cong an|chinh phu)\b.{0,100}\b(apk|file cai dat|cai dat)\b/,
        /\b(apk|file cai dat)\b.{0,100}\b(dai uy|thuong ta|dong chi|can bo|bo cong an|chinh phu)\b/],
      [/\b(dong bo (du lieu|thong tin)|dinh danh (dien tu )?muc 2|cap nhat (sinh trac|thong tin|dinh danh|can cuoc)|xac thuc sinh trac|nang cap (tai khoan|dinh danh))\b/],
    ],
  },
  {
    ref: 'R10',
    type: 'phishing_vote_qr',
    category: 'account',
    severity: 'high',
    title: 'Link bình chọn/nhận quà, quét QR hoặc đọc mã — nguy cơ chiếm tài khoản',
    explanation:
      'Có lời nhờ bình chọn/nhận quà kèm yêu cầu đăng nhập, quét mã QR hoặc đọc mã xác thực. Đây là cách chiếm phiên đăng nhập Zalo/Facebook.',
    recommended_action: 'Không đăng nhập qua link lạ, không quét QR theo hướng dẫn của người khác, không đọc mã xác thực cho ai.',
    requireOneOf: [1, 2],
    groups: [
      [/\b(binh chon|vote|cuoc thi (anh|anh dep|tai nang|be)|nhan qua (tri an|mien phi)|trung thuong|qua tang (tri an|khach hang))\b/],
      [/\b(quet (ma )?qr|ma qr|dang nhap (lai )?(zalo|facebook|tai khoan)|nhap ma (xac thuc|xac nhan))\b/],
      [/\b(xac nhan (thiet bi|dang nhap)|thiet bi moi|doc (giup|cho|lai)\b.{0,12}\b(ma|otp)|ma \d+ so|gui (lai )?ma (vua|da) (nhan|gui))\b/],
    ],
  },
  {
    // Lời bảo tải hoặc cài file apk. Có thêm dấu hiệu khác thì đã thành malware_apk (Nghiêm trọng).
    type: 'apk_install_request',
    category: 'technical',
    severity: 'high',
    title: 'Bảo tải hoặc cài file ứng dụng ngoài kho',
    explanation: 'Đối phương bảo tải hoặc cài một file .apk. File cài đặt ngoài CH Play có thể là ứng dụng điều khiển điện thoại và đọc trộm mã.',
    recommended_action: 'Không tải, không cài. Ứng dụng chính thức chỉ tải từ CH Play hoặc App Store.',
    negatable: true,
    exclude: [/\b(tu|tren|vao|o|len) (cua hang |kho ung dung )?(ch play|google play|app store|appstore)\b/],
    patterns: [/\b(tai|cai|cai dat)\b.{0,25}\b(file )?apk\b/, /\bapk\b.{0,30}\b(mo len|cai|cai dat)\b/],
  },
  {
    type: 'channel_migration',
    category: 'technical',
    severity: 'medium',
    title: 'Rủ chuyển sang kênh chat kín',
    explanation:
      'Đối phương muốn chuyển cuộc trò chuyện sang Telegram/Zalo cá nhân/nhóm kín — nơi khó tra cứu và dễ thao túng hơn (giai đoạn "điều hướng kênh kín").',
    recommended_action: 'Giữ trao đổi ở kênh có thể kiểm chứng; không vào nhóm kín theo lời mời của người lạ.',
    patterns: [
      /\b(chuyen|qua|sang|vao|add|ket ban|nhan tin|lien he|inbox)\b.{0,12}\b(telegram|whatsapp|signal|line|zalo (rieng|ca nhan)|nhom kin|group kin)\b/,
      /\b(vao|tham gia|add)\b.{0,6}\b(nhom|group)\b.{0,10}\b(telegram|zalo|kin|vip|nhiem vu)\b/,
      /\b(ket ban|add|nhan tin|lien he|lien lac|inbox|trao doi)\b.{0,30}\b(tren|qua|o)\s+(telegram|whatsapp|signal)\b/,
      // Zalo rất phổ biến nên chỉ tính khi có ý kéo sang nói riêng, chê chỗ hiện tại bất tiện.
      /\b(chuyen|qua|sang)\b.{0,8}\bzalo\b.{0,35}\b(rieng|bat tien)\b/,
    ],
  },
  {
    // Giả CSKH sàn/vận chuyển "hoàn tiền": dẫn bấm link / tải app / kết bạn riêng rồi điền tài khoản, số thẻ, mã.
    // Phát hiện từ dev dữ liệu ngoài (nhóm giả sàn TMĐT, thanh toán tiền giao hàng). Không bắt khi hướng dẫn
    // dùng mục Trả hàng/Hoàn tiền trong ứng dụng chính thức (không có link/app lạ).
    type: 'refund_link_info',
    category: 'technical',
    severity: 'high',
    title: 'Lấy cớ hoàn tiền / đơn hàng lỗi, dẫn bấm link và điền thông tin tài khoản',
    explanation:
      'Đối phương báo đơn hàng lỗi, được hoàn tiền hoặc bồi thường rồi hướng dẫn bấm link, tải app hay kết bạn riêng để điền số tài khoản, số thẻ hoặc mã xác nhận. Sàn thương mại điện tử hoàn tiền qua chính ứng dụng/ví của bạn, không qua link do nhân viên gửi.',
    recommended_action:
      'Không bấm link, không điền thông tin tài khoản. Tự mở ứng dụng chính thức của sàn/đơn vị vận chuyển để kiểm tra đơn hàng.',
    minGroups: 3,
    groups: [
      [/\b(hoan (tien|lai tien|phi)|boi thuong|den bu|don hang\b.{0,15}\b(loi|bi huy|that lac|that bai|co van de)|giao (hang )?(that bai|khong thanh cong)|xu ly (don|hoan))\b/],
      [/\b((bam|nhan|click|vao) (vao )?(cai )?(link|duong link)|link (em|ben em|minh|nay)|tai (app|ung dung)|cai (app|ung dung)|ket ban (zalo|xong)|zalo ben em)\b/],
      [/\b(dien|nhap|cung cap)\b.{0,30}\b(thong tin|so tai khoan|tai khoan ngan hang|so the|ma (xac nhan|xac thuc|otp|do|vao)|otp)\b/],
    ],
  },
];
