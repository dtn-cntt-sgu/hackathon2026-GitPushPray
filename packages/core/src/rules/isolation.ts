import type { Rule } from './rule';

// Không thêm "co" (cô) vì sau khi bỏ dấu trùng với "có": "đừng nói có" sẽ báo nhầm ở mức Nghiêm trọng.
const FAMILY = '(ai|gia dinh|bo me|ba me|me|ba|chu|vo|chong|nguoi nha|nguoi than|ban be|ong ba|anh chi)';

export const isolationRules: Rule[] = [
  {
    type: 'secrecy_from_family',
    category: 'isolation',
    severity: 'critical',
    direct_danger: true,
    title: 'Yêu cầu giữ bí mật với gia đình/người thân',
    explanation:
      'Có yêu cầu không cho gia đình, bạn bè biết. Đây là dấu hiệu cô lập thường gặp trong lừa đảo và mua bán người.',
    recommended_action: 'Hãy kể cho người bạn tin tưởng. Một công việc hợp pháp không cần bạn giấu gia đình.',
    patterns: [
      new RegExp(`\\b(dung|khong (duoc|nen)|cam) (noi|ke|bao|cho|hoi)( voi| cho)? ${FAMILY}\\b`),
      new RegExp(`\\bgiau ${FAMILY}\\b`),
      new RegExp(`\\bgiu bi mat (voi|ca voi) ${FAMILY}\\b`),
      /\b(gia dinh|bo me|nguoi nha)\b.{0,15}\b(khong (can|duoc|nen) biet|dung de biet)\b/,
    ],
  },
  {
    type: 'secrecy_general',
    category: 'isolation',
    severity: 'high',
    title: 'Yêu cầu giữ bí mật',
    explanation: 'Đối phương yêu cầu giữ kín nội dung trao đổi hoặc công việc.',
    recommended_action: 'Cân nhắc lý do phải giữ bí mật; hỏi ý kiến người tin cậy trước khi tiếp tục.',
    patterns: [
      /\bgiu bi mat\b/,
      /\b(bi mat|kin) (nhe|nha|giua (hai|2) (ta|minh))\b/,
      /\bxoa (het )?(tin nhan|doan chat)\b/,
      // Phát hiện từ tune bộ v2: bảo giấu thầy cô, nhà trường để bỏ qua kênh chính thức
      /\b(dung|khong (duoc|nen)) (noi|ke|bao)( voi| cho)? (thay|co giao|thay co|nha truong|truong)\b/,
    ],
  },
  {
    type: 'urgent_relocation',
    category: 'isolation',
    severity: 'high',
    title: 'Rủ đi xa / ra nước ngoài, có người đưa đón',
    explanation:
      'Có đề nghị di chuyển đến nơi khác (biên giới, nước ngoài) hoặc có người đến đón, đặc biệt khi kèm thúc ép thời gian.',
    recommended_action:
      'Không di chuyển chỉ vì áp lực. Báo người thân lịch trình, kiểm tra hợp đồng lao động và giấy phép đưa người đi làm việc.',
    patterns: [
      /\b(sang|qua|di|xuat canh) (campuchia|myanmar|lao|thai lan|dubai|trung quoc|malaysia|philippines|nuoc ngoai)\b/,
      /\b(bien gioi|cua khau|duong tieu ngach)\b/,
      /\b(khong can|khong phai lam|lo het) (ho chieu|visa|giay to|thu tuc)\b/,
      /\b(xe|nguoi|anh|chi|ben minh) (se )?(den |qua |ra |xuong |len )?don (em|ban|chau|tan noi)\b/,
      /\b(bao|mua|tra|lo) (ve may bay|ve xe)\b/,
      // Phát hiện từ tune bộ v2: không nói tên nước, chỉ giục chuẩn bị hộ chiếu và đi theo đoàn
      /(?<!\b(cong tac|hoi nghi|du lich|hoc bong)\b.{0,60})\bchuan bi ho chieu\b(?!.{0,60}\b(cong tac|hoi nghi|du lich|hoc bong)\b)/,
      /\bdi theo doan\b(?!.{0,30}\b(du lich|cong tac)\b)/,
    ],
  },
  {
    type: 'original_documents',
    category: 'isolation',
    severity: 'critical',
    direct_danger: true,
    title: 'Đòi giữ giấy tờ gốc',
    explanation:
      'Có yêu cầu giao/nộp giấy tờ bản gốc (hộ chiếu, căn cước) cho đối phương giữ — dấu hiệu kiểm soát nguy hiểm.',
    recommended_action: 'Không giao giấy tờ gốc cho người khác giữ. Ưu tiên an toàn và tìm hỗ trợ.',
    negatable: true,
    patterns: [
      /\b(giu|nop|giao|gui|mang theo)\b.{0,15}\b(ban goc|giay to goc|ho chieu goc|can cuoc goc|bang goc)\b/,
      /\b(cong ty|ben minh|quan ly|anh|chi) (se )?(giu|thu|cat giu|giu ho) (ho chieu|can cuoc|giay to)\b/,
    ],
  },
  {
    type: 'communication_control',
    category: 'isolation',
    severity: 'critical',
    direct_danger: true,
    title: 'Kiểm soát liên lạc',
    explanation: 'Có yêu cầu nộp điện thoại, hạn chế liên lạc hoặc cắt đứt với người thân.',
    recommended_action: 'Đây là dấu hiệu kiểm soát nghiêm trọng. Ưu tiên an toàn, giữ liên lạc với người tin cậy.',
    patterns: [
      /\b(nop|thu|tich thu) (lai )?(dien thoai|sim)\b/,
      /\b(khong duoc|cam|han che) (lien lac|goi (ve|dien)|dung dien thoai|nhan tin)\b/,
      new RegExp(`\\b(xoa|chan|block) (facebook|zalo|so|lien lac)\\b.{0,15}\\b${FAMILY}\\b`),
    ],
  },
];
