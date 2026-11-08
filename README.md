# SafeChat AI

**Nhìn rõ trước khi tin.** Công cụ giúp người dùng nhận biết dấu hiệu lừa đảo tuyển dụng, dụ dỗ và nguy cơ mua bán người trong hội thoại, kèm bằng chứng trích từ chính tin nhắn và hướng dẫn an toàn.

Nhóm **Git Push & Pray**. Đây là prototype. SafeChat AI đưa ra *dấu hiệu cần xác minh*, không kết luận ai là tội phạm và không bảo đảm một cuộc trò chuyện là an toàn.

## Dùng thử nhanh (không cần cài gì)

Repo có sẵn bản build extension trong `apps/extension/dist`:

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục `apps/extension/dist`.
3. Mở một cuộc trò chuyện trên Facebook/Messenger, bấm biểu tượng SafeChat AI.

Bộ quy tắc chạy ngay trên máy. AI là tùy chọn và cần gateway (xem bên dưới). Chi tiết và checklist kiểm thử ở [apps/extension/HUONG_DAN_CAI_DAT.md](apps/extension/HUONG_DAN_CAI_DAT.md).

## Phát triển

Cần Node.js 20 trở lên.

```bash
npm install
```

```bash
npm run check
```

Lệnh `check` chạy typecheck, test, eval so với mốc và build extension. Phải xanh trước khi push.

Giai đoạn hiện tại chạy **local-first + Groq `openai/gpt-oss-120b`**, chưa dùng AWS thật. Gateway local giữ khóa Groq và không lưu nội dung chat. Cách dễ nhất trên mọi hệ điều hành: chép `services/gateway/.env.example` thành `services/gateway/.env`, điền `AI_PROVIDER=groq`, `GROQ_API_KEY`, `TOKEN_SECRET` (chuỗi ngẫu nhiên từ 32 ký tự), `PORT=8787`, rồi chạy:

```bash
npm run dev:gateway
```

Hoặc đặt biến môi trường ngay trên dòng lệnh. Bash (macOS, Linux, Git Bash):

```bash
AI_PROVIDER=groq TOKEN_SECRET="$(node -e "console.log('x'.repeat(40))")" GROQ_API_KEY=<key> PORT=8787 npm run dev:gateway
```

Windows PowerShell:

```powershell
$env:AI_PROVIDER="groq"; $env:TOKEN_SECRET=(node -e "console.log('x'.repeat(40))"); $env:GROQ_API_KEY="<key>"; $env:PORT="8787"; npm run dev:gateway
```

Sau đó trong side panel → **Cài đặt**, nhập `http://localhost:8787` và bấm **Bật máy chủ SafeChat**.

**Đọc tiếp:** [Kế hoạch 12 giờ và phân công](docs/04_KE_HOACH_12H.md) · [Kiến trúc](docs/03_KIEN_TRUC_MUC_TIEU.md) · [Quy tắc phát triển](docs/quy-tac-phat-trien.md)

## Nhánh và phân công

| Nhánh | Người | Phạm vi |
|---|---|---|
| `main` | Cả nhóm | Bản tích hợp, luôn xanh. Từ 2026-11-07 nhóm làm và đánh giá trực tiếp trên `main` |
| `duy/ai-eval` | Duy | `packages/core`, `research`, `fixtures`, `scripts` |
| `danh/gateway-aws` | Danh | `services/gateway`, `infra`, workflow CI và deploy |
| `dat/clients` | Đạt | `apps/extension` |

`packages/contracts` là hợp đồng API dùng chung, đổi phải báo cả nhóm.

## Cấu trúc

```
packages/core/       logic phân tích thuần: chuẩn hóa, luật, Claim Ledger, chấm điểm, giai đoạn, chống dao động, AI
packages/contracts/  hợp đồng API và phản hồi mẫu
apps/extension/      Chrome Extension MV3
services/gateway/    AI Gateway local (Hono + Groq), đóng gói được lên AWS Lambda
infra/               hạ tầng AWS cho giai đoạn sau
research/            khung đánh giá (dữ liệu không nằm trong repo)
fixtures/            bộ tình huống và mốc chất lượng
docs/                kế hoạch, kiến trúc, quy tắc
```

## Lệnh thường dùng

| Lệnh | Việc |
|---|---|
| `npm test` | Chạy test |
| `npm run eval` | Chấm bộ tình huống |
| `npm run build:extension` | Build vào `apps/extension/dist` |
| `npm run build:gateway` | Bundle gateway Lambda vào `services/gateway/dist` |
| `npm run dev:gateway` | Chạy gateway local (cần `TOKEN_SECRET`, `GROQ_API_KEY` nếu bật AI) |
| `npm run dev:extension` | Chat giả lập tại `http://localhost:5178/mock-chat/` |

## Nguyên tắc không được vi phạm

- Không bật AI thì không có dữ liệu nào rời thiết bị. Không log nội dung chat, ở cả client lẫn server.
- Gateway không lưu nội dung chat; chỉ giữ bộ đếm lượt/token. Khóa Groq không nằm trong extension hay repo.
- Dùng "có dấu hiệu", không kết luận tội phạm. Điểm là điểm dấu hiệu, không phải xác suất.
- Trích dẫn của AI phải khớp tin gốc. AI một mình không đẩy lên Nghiêm trọng, chỉ hạ tối đa 1 bậc và không hạ từ Nghiêm trọng.
- Không tự gửi tin nhắn. Ở mức Nghiêm trọng, ưu tiên hướng dẫn an toàn.

Chi tiết ở [docs/quy-tac-phat-trien.md](docs/quy-tac-phat-trien.md).

---

Nếu bạn đang gặp tình huống nguy hiểm: không chuyển tiền, không giao giấy tờ gốc, không đi theo yêu cầu. Liên hệ người thân tin cậy và công an nơi gần nhất (**113**).
