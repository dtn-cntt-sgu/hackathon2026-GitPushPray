import type { Rule } from './rule';

export const identityRules: Rule[] = [
  {
    type: 'hidden_company_identity',
    category: 'identity',
    severity: 'medium',
    title: 'Né tránh danh tính đơn vị tuyển dụng',
    explanation: 'Đối phương né tránh nêu tên pháp nhân, địa chỉ hoặc mã số thuế của đơn vị tuyển dụng.',
    recommended_action:
      'Đề nghị tên pháp nhân, mã số thuế và địa chỉ; tự tra cứu trên Cổng thông tin quốc gia về đăng ký doanh nghiệp.',
    patterns: [
      /\b(khong (the|tien|duoc phep)|chua the) (tiet lo|noi|cung cap|cho biet)\b.{0,20}\b(ten|cong ty|dia chi|ma so thue|van phong)\b/,
      /\b(ten|cong ty|dia chi)\b.{0,15}\b(bi mat|khong quan trong|khong can biet|noi sau|de sau)\b/,
      /\b(khong co|chua co) (van phong|dia chi|giay phep)\b/,
      /\blam (online|tai nha) (khong can|khong) (gap|phong van)\b/,
    ],
  },
];
