import type { Rule } from './rule';

export const jobTermsRules: Rule[] = [
  {
    type: 'unrealistic_pay',
    category: 'job_terms',
    severity: 'medium',
    title: 'Thu nhập hứa hẹn thiếu thực tế',
    explanation: 'Mức thu nhập được hứa rất cao so với công việc đơn giản hoặc không yêu cầu kinh nghiệm.',
    recommended_action: 'Yêu cầu mô tả công việc, cách tính lương và hợp đồng bằng văn bản trước khi tiếp tục.',
    patterns: [
      /\bviec nhe\b.{0,15}\bluong cao\b/,
      /\b\d+(?:[.,]\d+)? trieu ?(\/ ?|mot |moi |1 )(ngay|buoi|gio|tieng)\b/,
      /\b[5-9]\d{2} nghin ?(\/ ?|mot |moi |1 )(gio|tieng)\b/,
      /\b(kiem|thu nhap|luong)\b.{0,20}\b(\d{2,}|[3-9]) trieu ?(\/ ?|mot |moi |1 )?tuan\b/,
      /\b(khong can|khong yeu cau) (kinh nghiem|bang cap)\b.{0,40}\b\d{2,} trieu\b/,
      /\b(lam it|ranh tay|chi can (dien thoai|like|share))\b.{0,30}\b(trieu|thu nhap)\b/,
    ],
  },
  {
    ref: 'R03',
    type: 'task_recruitment',
    category: 'job_terms',
    severity: 'medium',
    title: 'Tuyển CTV làm "nhiệm vụ" giật đơn / tương tác mạng xã hội',
    explanation:
      'Lời mời làm cộng tác viên online kiếm tiền bằng like video, đánh giá 5 sao, giật đơn… kèm hoa hồng/hoàn tiền hoặc rủ vào nhóm kín. Đây thường là bước mồi của bẫy nạp tiền làm nhiệm vụ.',
    recommended_action:
      'Các sàn thương mại điện tử/mạng xã hội không thuê người "giật đơn", like video để trả hoa hồng. Không nạp tiền và không vào nhóm kín.',
    // Bổ sung từ dev SMS: "tuyển … CTV/nhân viên … tại nhà/bán thời gian", "lương trả trong ngày", liên hệ qua Zalo,
    // "xử lý đơn hàng", "nhập liệu". Không tính khi hẹn phỏng vấn trực tiếp / đến địa điểm làm việc (tuyển dụng thật).
    requireOneOf: [1, 2, 3],
    exclude: [/(?<!khong (can )?)\bphong van truc tiep\b|\b(qua|den|toi) (quan|cua hang|van phong|cong ty|xuong)\b.{0,20}\b(phong van|nhan viec|lam viec)\b/],
    groups: [
      [
        /\b(tuyen (cong tac vien|nhan vien online|nguoi lam online)|viec nhe luong cao|lam (tai nha|online)|viec lam them online|kiem tien online|thu nhap them)\b/,
        /\btuyen\b.{0,40}\b(cong tac vien|ctv|nhan vien|ban)\b.{0,40}\b(tai nha|online|ban thoi gian|part ?time)\b/,
        /\b(viec lam them|lam them|lam viec) (tai nha|online)\b/,
        /\bcong tac vien may man\b/,
      ],
      [/\b(giat don|chot don|xu ly don( hang)?|nhap lieu|tang tuong tac|like (video|bai|trang)|tha tim|danh gia (5|nam) sao|nghe nhac|xem video|follow|tuong tac (tiktok|shopee|lazada|facebook|youtube)|nhan thich|bam like|theo doi (cac )?(trang|fanpage|kenh|video))\b/],
      [
        /\b(hoa hong \d+(?:[.,]\d+)? ?%|hoan (goc|von|tien)|nhan (goc|lai))\b/,
        /\b\d+ nghin ?(\/ ?|moi |1 )(nhiem vu|don|luot|video|like)\b/,
        // Trả tiền theo từng lượt: "mỗi lượt nhận 20.000đ", "20.000đ một lượt"
        /\b(moi|1|mot) (luot|video|nhiem vu|like)\b.{0,30}\b\d[\d.,]*\s*(d|dong|nghin)\b/,
        /\b\d[\d.,]*\s*(d|dong|nghin)\s*(\/ ?|moi |1 |mot )(luot|video|nhiem vu|like)\b/,
        /\b(luong|tien luong|tien cong|thu nhap)\b.{0,15}\b(tra|thanh toan|nhan)?\s*(trong ngay|hang ngay|theo ngay|cuoi ngay)\b/,
        /\b(thanh toan|nhan tien|nhan luong) (trong ngay|lien|ngay)\b|\bnhan luong thu viec\b/,
      ],
      [
        /\b(lien he (chuyen vien|nguoi huong dan|tro ly|cskh)|(vao|tham gia|add) (nhom|group)|telegram|ma (gioi thieu|moi)|nhan thuong (tan thu|lan dau))\b/,
        /\b(ket ban|lien he|lh|nhan tin|inbox|ib|add) (qua )?zalo\b/,
      ],
    ],
  },
  {
    type: 'no_written_contract',
    category: 'job_terms',
    severity: 'medium',
    title: 'Né tránh hợp đồng bằng văn bản',
    explanation: 'Đối phương nói không cần hợp đồng, hoặc hẹn ký sau khi người dùng đã đóng tiền/đi làm.',
    recommended_action: 'Đề nghị hợp đồng hoặc thư mời nhận việc ghi rõ điều kiện trước khi quyết định.',
    patterns: [
      /\b(khong can|khong co|khong ky|chua can) hop dong\b/,
      /\bhop dong\b.{0,15}\b(ky sau|de sau|lam sau|khi (sang|qua|den) noi)\b/,
      /\b(lam|tuyen) mieng\b/,
    ],
  },
];
