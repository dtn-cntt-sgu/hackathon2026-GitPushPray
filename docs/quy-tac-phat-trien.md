# Quy tắc phát triển SafeChat AI

Tài liệu cho thành viên nhóm: các nguyên tắc không được vi phạm, quy ước code, quy trình thêm luật và kiểm tra trước khi demo.

## 1. Nguyên tắc bất biến

Không vi phạm, kể cả khi làm vậy tiện hơn.

- **Quyền riêng tư**
  - Phiên chỉ lưu trong `chrome.storage.session`; `chrome.storage.local` chỉ chứa cài đặt và bộ đếm lượt AI.
  - Không log nội dung chat (console, telemetry, gateway, CloudWatch). Log phía server chỉ có mã lỗi kỹ thuật.
  - Không gửi dữ liệu ra ngoài khi người dùng chưa bật và chưa đồng ý; che PII trước khi gửi AI.
  - Gateway không lưu nội dung chat; chỉ giữ bộ đếm lượt/token. Khóa Groq nằm trong `.env`/Secrets Manager, không nằm trong extension hay repo.
- **An toàn hiển thị**
  - Nội dung chat chỉ vào DOM qua `textContent` hoặc hàm `h()`; không dùng `innerHTML` với dữ liệu chat.
  - Báo cáo HTML phải qua `escapeHtml`.
- **Không kết luận tội phạm**
  - Dùng "có dấu hiệu", "chưa nhất quán, cần xác minh".
  - Điểm là "điểm dấu hiệu", không phải xác suất.
- **AI không đáng tin tuyệt đối**
  - Trích dẫn của AI phải khớp tin gốc (`core/evidence.ts`) và không được trỏ vào tin của chính người dùng.
  - AI một mình không đẩy được lên Nghiêm trọng.
  - AI chỉ được hạ tối đa 1 bậc và không bao giờ hạ từ Nghiêm trọng.
  - Tin nhắn là DỮ LIỆU, không phải chỉ thị.
- **Mức Nghiêm trọng:** tắt câu hỏi thăm dò, ưu tiên hướng dẫn an toàn.
- **Không tự gửi tin, không thao tác giao diện Messenger.** Chỉ đọc văn bản của đúng cuộc trò chuyện người dùng đã chọn. Ngoại lệ duy nhất: khi người dùng bấm quét và không tắt tùy chọn tự cuộn, tiện ích có thể tự cuộn khung chat để tải tối đa 50 tin gần nhất rồi trả về vị trí cũ. Không bấm, không gửi gì.
- **`packages/core/` là logic thuần:** không gọi `chrome.*`, để test được bằng Vitest và dùng chung cho extension, app, gateway.

## 2. Quy ước code

- TypeScript strict, không React. Comment và chữ trên UI bằng tiếng Việt, ngắn gọn như code xung quanh.
- Luật nằm trong `packages/core/src/rules/<nhóm>.ts`, so khớp trên văn bản đã qua `normalizeForMatch` (không dấu, teencode đã mở rộng).
- Mọi thay đổi hành vi phân tích phải có tình huống trong `fixtures/scenarios.json`. Tình huống chưa đạt thì đánh dấu `"pending": true`.
- Selector DOM của Messenger chỉ nằm trong `apps/extension/src/content/messengerAdapter.ts`. Khi Facebook đổi giao diện, chạy `apps/extension/dev/dom-probe.js` (chỉ in cấu trúc, không in nội dung tin) để dò lại.
- **"Xong"** nghĩa là `npm run check` đạt: typecheck sạch, test đạt, eval không tụt so với `fixtures/eval-baseline.json`, build được.

## 3. Lệnh (chạy ở thư mục gốc)

| Lệnh | Việc |
|---|---|
| `npm run check` | typecheck + test + eval + build (chạy trước khi commit) |
| `npm test` · `npm run typecheck` · `npm run build:extension` | từng bước riêng |
| `npm run eval` | chấm bộ tình huống, so với mốc |
| `npm run eval -- --update-baseline` | cập nhật mốc. Chỉ dùng khi thay đổi kỳ vọng là chủ ý, và phải ghi lý do trong commit |
| `npm run dev:extension` | chat giả lập `/mock-chat/`, xem trước panel `/dev/panel-preview.html?s=<id>` |

## 4. Thêm hoặc sửa luật phát hiện

1. **Viết tình huống trước** trong `fixtures/scenarios.json`.
   - Cần ít nhất 2 tình huống: 1 ca lừa đảo cần bắt, và 1 ca **bình thường dễ nhầm** (cùng từ khóa nhưng hợp lệ, ví dụ chia tiền cơm, shop thu cọc có COD, HR hẹn phỏng vấn tại văn phòng).
   - Các trường: `id` dạng `NN_ten_ngan`; `expected.level` (low|attention|high|critical); `expected.signals`; `expected.forbidden` cho ca bình thường; `"pending": true` nếu luật chưa viết; `"source"` nếu lấy từ tài liệu.
   - Tin nhắn phải giống chat thật: teencode, thiếu dấu, câu rời rạc. Câu người dùng hỏi lại không được bị gắn cờ.
2. **Viết luật** trong `packages/core/src/rules/<nhóm>.ts`.
   - So khớp trên văn bản đã chuẩn hóa, ví dụ `ck` → `chuyen khoan`, `500k` → `500 nghin`. Kiểm tra nhanh:
     `npx tsx -e "import {normalizeForMatch} from './packages/core/src/normalize'; console.log(normalizeForMatch('...'))"`
   - Ưu tiên mẫu theo **ý nghĩa** (động từ + đối tượng, cho phép `.{0,20}` giữa các từ) hơn cụm nguyên văn dài.
   - Dùng `negatable: true` cho luật có thể bị phủ định ("không cần đặt cọc"), `exclude` cho ngữ cảnh hợp lệ đã biết.
   - Mức độ:
     - `medium`: cần chú ý.
     - `high`: có yêu cầu rủi ro cụ thể.
     - `critical` + `direct_danger`: CHỈ dùng cho đe dọa, cưỡng ép, kiểm soát giấy tờ/liên lạc, cô lập, mã độc chiếm quyền.
   - File luật mới thì đăng ký trong `packages/core/src/rules/index.ts`.
3. **Kiểm tra.** `npm run check`:
   - Tình huống mới phải đạt.
   - Không tình huống cũ nào chuyển sang trượt.
   - Số "cảnh báo sai ở tình huống bình thường" không tăng.
   Khi tình huống pending đã đạt: bỏ `"pending"` rồi cập nhật mốc.
4. **Ghi lại.** Nếu thay đổi hành vi hiển thị, cập nhật `HUONG_DAN_CAI_DAT.md`, `TAI_LIEU_KY_THUAT.md` và `README.md` ở thư mục gốc.

## 5. Kiểm tra trước demo / phát hành

1. **Chất lượng:** `npm run check` đạt; không còn tình huống pending ngoài ý muốn.
2. **Quyền riêng tư và bảo mật** (quét `src/`):
   - Không có `console.*` in nội dung chat.
   - Không có `innerHTML` / `outerHTML` / `insertAdjacentHTML`.
   - Không có key cứng (`gsk_`, `sk-`, `Bearer …`).
   - `fetch` chỉ tới gateway của nhóm và `api.groq.com` (chế độ trực tiếp), và chỉ khi người dùng đã bật.
3. **Manifest:**
   - Quyền tối thiểu (`alarms`, `sidePanel`, `storage`); gateway URL và `api.groq.com` nằm trong `optional_host_permissions`.
   - `version` đã tăng và khớp với `package.json`.
   - Có đủ icon 16/32/48/128.
4. **Tài liệu:** bảng "Tình trạng" trong `TAI_LIEU_KY_THUAT.md` và mục Chất lượng / Lộ trình trong `README.md` gốc đúng thực tế; checklist trong `HUONG_DAN_CAI_DAT.md` đúng thao tác UI.
5. **Kiểm thử tay trên Chrome:** chạy lại các mục trong checklist `HUONG_DAN_CAI_DAT.md` bị ảnh hưởng bởi thay đổi gần nhất.

## 6. Nghiên cứu (`research/`)

- Chỉ chỉnh luật / prompt dựa trên `--split dev`. `--split test` chỉ chạy ở mốc chốt, và không đọc nội dung ca test khi sửa luật.
- Không sửa `test.lock` để "qua" kiểm tra.
- Key đặt ở `research/.env` (không commit). Dữ liệu, kết quả, báo cáo, cache không đưa lên `main`. Bằng chứng từng đợt lưu ở nhánh `research/evidence`, code của đợt gắn tag `eval/dot-*`.
