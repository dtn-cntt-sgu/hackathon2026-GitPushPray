import type { Rule } from './rule';

/** Câu xã giao, dịch vụ có cùng cách nói với lời đe dọa. "Sửa", "giao hàng" hay "ăn trưa" thì không phải đe dọa. */
const SOCIAL_OR_SERVICE = /\b(choi|nhau|an (com|uong|trua|toi|sang)|danh bai|da bong|sinh nhat|an mung|giao hang|shipper|sua (may|xe|dien|nuoc|nha)|lap dat|lap mang|bao tri|bao hanh|tho (dien|nuoc|sua)|ky thuat vien|bac si|y ta|don dep|ve sinh|khao sat|do dac|phim|bao noi)\b/;

export const pressureRules: Rule[] = [
  {
    type: 'urgency_pressure',
    category: 'pressure',
    severity: 'medium',
    title: 'Thúc ép quyết định gấp',
    explanation: 'Có lời thúc ép phải quyết định/chuyển tiền ngay, giới hạn suất hoặc dọa mất cơ hội.',
    recommended_action: 'Chậm lại. Một cơ hội hợp pháp không biến mất chỉ vì bạn dành thời gian kiểm tra.',
    // "nhanh lên", "khẩn cấp", "hết hạn" đứng một mình là câu đời thường → phải đi kèm hành động chuyển tiền/
    // cung cấp/quyết định, hoặc hậu quả ("không thì mất suất") (phát hiện từ dev dữ liệu ngoài).
    patterns: [
      /\b(ngay bay gio|ngay lap tuc|khan cap)\b.{0,30}\b(chuyen|nop|dong|thanh toan|cung cap|xac minh|cai|tai|dang ky|quyet dinh|dat coc)\b/,
      /\b(chuyen|nop|dong|thanh toan|cung cap|xac minh|quyet dinh|dang ky|dat coc|cai|tai)\b.{0,30}\b(ngay bay gio|ngay lap tuc|khan cap|trong hom nay|nhanh len|gap len)\b/,
      /\b(het han|trong hom nay)\b.{0,30}\b(khong thi|neu khong|mat (suat|co hoi|cho|tien|quyen loi)|bi (khoa|huy|phat))\b/,
      /\btruoc \d+ ?(gio|h)\b.{0,20}\b(hom nay|toi nay|khong thi|neu khong)\b/,
      /\bchi con \d+ (suat|cho|slot|nguoi)\b/,
      /\b(neu khong|khong thi)\b.{0,20}\b(mat (co hoi|suat|cho|viec)|huy (ho so|suat)|nguoi khac lay)\b/,
      /\bquyet dinh (ngay|luon|nhanh)\b/,
      /\bkeo (mat|het|lo) (suat|cho|co hoi|viec)\b/,
      /\b(dung|khong duoc) (suy nghi|do du|chan chu) (lau|nua|nhieu)\b/,
    ],
  },
  {
    type: 'threat_coercion',
    category: 'pressure',
    severity: 'critical',
    direct_danger: true,
    title: 'Đe dọa / cưỡng ép',
    explanation: 'Có lời đe dọa (phát tán hình ảnh, kiện cáo, làm hại) hoặc ép buộc người dùng phải làm theo.',
    recommended_action: 'Ngừng tương tác, lưu bằng chứng và tìm hỗ trợ từ người tin cậy hoặc cơ quan chức năng.',
    patterns: [
      /\b(phat tan|tung|dang|gui)\b.{0,15}\b(anh|hinh|clip|video)\b.{0,25}\b(len mang|cho (gia dinh|bo me|ban be|nguoi than|truong))\b/,
      /\b(se|bi) (kien|bao cong an|truy cuu|bo tu|xu ly)\b.{0,25}\b(neu|khong (dong|chuyen|lam|tra))\b/,
      /\b(liu hon|coi chung|biet nha (em|ban|may) o dau)\b/,
      /\b(boi thuong|den bu|phat)\b.{0,15}\b(hop dong|vi pham|bo viec)\b.{0,20}\b\d+(?:[.,]\d+)? (trieu|ty)\b/,
      /\bkhong (duoc|cho) (ve|nghi viec|bo viec)\b/,
      // Phát hiện từ tune bộ v2: tống tiền bằng ảnh, đe dọa gọi người thân. "anh" có thể là xưng hô nên cần rõ là ảnh
      /\b(anh cua (anh|em|chi|ban|may)|hinh anh|clip|video)\b.{0,50}\bse duoc gui di\b/,
      /\b(thi|khong thi|la) (anh|hinh)( anh)?\s+gui thang\b.{0,20}\b(lanh dao|co quan|gia dinh|nguoi than|dong nghiep)\b/,
      /\btien doi lay im lang\b/,
      /\bkhong (tra|thanh toan)\b.{0,30}\b(goi|bao|nhan tin)\b.{0,12}\bcho\b.{0,12}\b(nguoi than|dong nghiep|gia dinh|lanh dao)\b/,
    ],
  },
  {
    type: 'threat_physical',
    category: 'pressure',
    severity: 'critical',
    direct_danger: true,
    title: 'Dọa kéo người đến, nhắm vào gia đình hoặc làm hại',
    explanation: 'Có lời dọa kéo người đến nhà, chỗ làm, trường học, nhắm vào con cái, người thân hoặc làm hại về thể xác. Đây là cưỡng ép, kể cả khi lời lẽ lịch sự hoặc chỉ nói ngầm.',
    recommended_action: 'Không chuyển tiền để được yên. Lưu bằng chứng, báo cho người thân, nhà trường nếu liên quan đến con cái, và báo công an.',
    patterns: [
      /\b(cho|keo|dan|goi|thue|cu) (nguoi|nguoi cua|anh em|dan em|dan|bon|giang ho)\b.{0,20}\b(den|toi|qua|sang|xuong|ra|len|ghe)\b.{0,10}\b(tan )?(nha|cong ty|cho lam|truong|co quan)\b.{0,30}\b(xu ly|xu|tinh so|noi chuyen|lam viec|doi|day|cho biet)\b/,
      /\b(tao|tau|t|bon tao) (se )?(cho|keo|dan|goi|thue) (nguoi|anh em|dan em|giang ho)\b.{0,20}\b(den|toi|qua|sang|xuong|ra|len|ghe)\b.{0,10}\b(tan )?(nha|cong ty|cho lam|truong|co quan)\b/,
      /\b(cho|keo|dan|goi|thue) (nguoi|anh em|dan em|giang ho)\b.{0,20}\b(den|toi|qua|sang|xuong|ra|len|ghe)\b.{0,10}\b(tan )?(nha|cong ty|truong|cho lam) (may|mi)\b/,
      /\b(den|toi|qua|sang|xuong|ra|len|ghe)\b.{0,10}\b(tan )?(nha|cong ty|cho lam|truong|co quan)\b.{0,20}\bxu( ly)? (em|may|mi|ban|chung may)\b/,
      /\b(cho|keo|dan) (may chuc |vai chuc |\d+ )?(thang|dan em|anh em)\b.{0,25}\b(den|toi|qua|xuong)\b.{0,15}\b(quay|pha|tim|dap|xu)\b/,
      /\b(tao|tau|t|bon tao|se|cho nguoi|cho anh em|cho dan em) (danh|dap|cho) (gay|que) (chan|tay)\b/,
      /\b(chem|giet) (may|em|ban)\b|\b(tat (axit|son|mam tom)|dot nha|pha nha) (may|mi|em|ban)\b|\b(tao|tau|bon tao|se|cho nguoi) (tat axit|tat son|dot nha|pha nha)\b/,
      /\b(quay nat|pha nat|dap nat|don (luon )?ca nha)\b/,
      /\b(biet|tim ra|co dia chi) nha (may|mi|em|ban)\b.{0,25}\b(cho do|coi chung|lieu|dung trach|xu ly)\b/,
      // Nhắm vào gia đình, không cần nói thẳng sẽ làm gì
      /\b(ve nha|tan hoc|di hoc)\b.{0,20}\ban toan\b.{0,15}\bkhong\b/,
      /\b(nguoi nha|ca nha|con (may|cua (may|anh|chi|em))|may dua nho)\b.{0,50}\b(nam het|biet het|theo doi)\b.{0,15}\b(lich trinh|duong di)\b/,
      /\bnam het lich trinh\b/,
      /\bkhong dam bao\b.{0,15}\ban toan\b.{0,25}\b(cho (anh|chi|em|ban|may)|the xac|tinh mang|than the)\b/,
      /\bqua tan (truong|nha)\b.{0,10}\btim\b/,
    ],
    exclude: [SOCIAL_OR_SERVICE],
  },
  {
    type: 'threat_home_visit',
    category: 'pressure',
    severity: 'high',
    title: 'Gắn yêu cầu trả tiền với việc tìm đến hoặc bêu xấu',
    explanation: 'Có lời nói nếu không trả tiền, đóng phí hoặc làm theo thì sẽ tìm đến nhà, chỗ làm, hoặc đưa giấy tờ, hình ảnh lên mạng.',
    recommended_action: 'Không chuyển tiền chỉ vì bị dọa. Kiểm tra khoản tiền qua kênh chính thức, lưu bằng chứng và báo công an nếu bị đe dọa tiếp.',
    patterns: [
      /\b(khong|ko) ((tra|dong) (tien|no|phi|du)|chuyen(?! (khoan )?duoc)|nop (tien|phi|du)|thanh toan)\b.{0,30}\b(den|toi|qua|sang|xuong|ra|len|ghe)\b.{0,10}\b(tan )?(nha|cong ty|cho lam|truong|co quan)\b/,
      /\b(tron no|bung no|bung tien)\b.{0,25}\b(den|toi|qua|sang|xuong|ra|len|ghe)\b.{0,10}\b(tan )?(nha|cong ty|cho lam|truong|co quan)\b/,
      /\b(khong|ko) (nghe loi|lam theo)\b.{0,20}\b(den|toi|qua|xuong) tan\b/,
      /\b(khong|ko) (dong|tra|chuyen|nop|thanh toan)\b.{0,25}\b(cho|keo|dan) (nguoi|anh em)\b.{0,15}\b(den|toi|qua|sang|xuong|ra|len|ghe)\b/,
      /\b(cmnd|can cuoc|cccd|chan dung)\b.{0,40}\b(sang nhat|hoi nhom|khu pho|len mang)\b/,
      /\bcuong che\b.{0,25}\b(tan nha|niem phong)\b/,
      /\bdinh ngay mai\b|\bbiet (may|mi) lam o dau\b/,
    ],
    exclude: [SOCIAL_OR_SERVICE],
  },
  {
    // Phát hiện từ dev SMS: đòi nợ (thật hoặc giả) bằng đe dọa bêu xấu với danh bạ/người thân hoặc dọa kiện
    type: 'debt_collection_threat',
    category: 'pressure',
    severity: 'high',
    title: 'Đòi nợ kèm đe dọa báo danh bạ / người thân / khởi kiện',
    explanation:
      'Tin nhắn nói bạn (hoặc người bạn "bảo lãnh") có khoản vay quá hạn và dọa thông báo tới danh bạ, người thân, nơi làm việc hoặc khởi kiện để ép trả tiền gấp. Đây là cách của app vay trái phép hoặc kẻ gian mạo danh đòi nợ.',
    recommended_action:
      'Không chuyển tiền theo tin nhắn. Kiểm tra khoản vay qua ứng dụng/hợp đồng chính thức; nếu bị đe dọa, lưu bằng chứng và báo công an nơi cư trú.',
    groups: [
      [/\b(khoan vay|khoan no|no (qua han|xau)|be no|bao lanh (khoan vay|cho)|cham (tra )?no|nhay nhom no)\b/],
      [
        /\b(neu khong|khong thi)\b.{0,40}\b(thong bao|gui|bao|nhan tin|goi)\b.{0,15}\b(toan bo )?(danh ba|nguoi than|gia dinh|bo me|cong ty|co quan|ban be)\b/,
        /\b(khoi kien|bi kien|kien ra toa|tranh bi (khoi )?kien)\b/,
        /\b(thanh toan|xu ly|tra)\b.{0,10}\b(gap|ngay)\b/,
      ],
    ],
  },
  {
    type: 'guilt_debt',
    category: 'pressure',
    severity: 'medium',
    title: 'Gây cảm giác mắc nợ / tội lỗi',
    explanation: 'Đối phương nhấn mạnh đã bỏ tiền, công sức cho người dùng để tạo áp lực phải làm theo.',
    recommended_action: 'Bạn không có nghĩa vụ làm theo chỉ vì đối phương nói đã "bỏ công" cho bạn.',
    patterns: [
      /\b(da )?(bo|ung) (tien|chi phi) (ra )?(cho|lo cho) (em|ban|chau)\b/,
      /\b(mang|mac|dang) no\b.{0,15}\b(cong ty|anh|chi|ben minh)\b/,
      /\b(phu long|vo on)\b/,
    ],
  },
];
