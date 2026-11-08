# SafeChat AI — tài liệu kỹ thuật (v0.4.0)

Hướng dẫn cài đặt và checklist kiểm thử: [HUONG_DAN_CAI_DAT.md](../apps/extension/HUONG_DAN_CAI_DAT.md) · Nguyên tắc và quy trình phát triển: [quy-tac-phat-trien.md](quy-tac-phat-trien.md).

Chrome Extension (Manifest V3) hỗ trợ nhận biết dấu hiệu lừa đảo tuyển dụng, dụ dỗ và nguy cơ mua bán người trong **một** cuộc trò chuyện Messenger do người dùng chọn.

> Bản mẫu. Điểm 0–100 là **điểm dấu hiệu**, không phải xác suất phạm tội hay xác nhận an toàn.

## Chạy thử

```bash
npm install
npm run check     # typecheck + test + eval (so với mốc) + build — chạy trước khi commit
npm test          # Vitest: core + bộ tình huống + vòng đời phiên ở background
npm run eval      # chỉ số trên fixtures/scenarios.json
npm run build     # build extension vào dist/
npm run icons     # tạo lại icon PNG
npm run dev       # server dev: /mock-chat/ (chat giả lập) và /dev/panel-preview.html
```

**Nạp vào Chrome:** `chrome://extensions` → bật *Developer mode* → *Load unpacked* → chọn thư mục `dist/`.

**Demo với chat giả lập:**
1. `npm run dev`, mở `http://localhost:5178/mock-chat/`.
2. Bấm biểu tượng SafeChat AI để mở side panel → tích đồng ý → **Bắt đầu theo dõi**.
3. Chọn kịch bản, bấm **Phát tin tiếp** / **Tự phát**. Side panel sẽ cập nhật mức cảnh báo, bằng chứng và gợi ý theo từng tin mới.
4. Thử **Render lại DOM** (để kiểm tra khử trùng lặp), đổi kịch bản (tương đương chuyển chat), **Dừng và xóa phiên**.

`/dev/panel-preview.html?s=<id kịch bản>` hiển thị giao diện side panel với dữ liệu phân tích thật, không cần nạp extension.

## Kiến trúc

```
src/core/        logic thuần (không gọi chrome.*), test được bằng Vitest
  normalize.ts   chữ thường, bỏ dấu, teencode (ck, stk, ko…), tách đơn vị tiền (500k, 8tr)
  normalize.ts   + gỡ chữ ngắt quãng (c.h.u.y.ể.n), leetspeak (ti3n), "nv" theo ngữ cảnh
  entities.ts    link (rút gọn / đuôi rẻ / giả thương hiệu; bỏ qua tên miền chính thức ngân hàng, nhà mạng), .apk, ví TRC20, STK vs SĐT
  rules/         luật 1 tin (`patterns`) + luật nhiều khía cạnh (`groups`, ANY_2 trong cửa sổ 6 tin):
                 finance (+R04 kẹt lệnh, R08 quà/hải quan, cảnh báo thẻ giả, dịch vụ hạn mức thẻ, giả bưu cục đòi phí), account, identity, jobTerms (+R03),
                 pressure (+ đòi nợ đe dọa danh bạ), isolation, impersonation (R01 cơ quan, R06 mượn tiền, R09 thu hồi tiền),
                 investment (R05 sàn ảo, R07 vay online, mời vay dẫn tải app/link), technical (R02 .apk/trợ năng, R10 bình chọn/QR, kênh kín, giả CSKH hoàn tiền qua link)
  context.ts     tín hiệu từ thực thể + luật ngữ cảnh hạ mức giao dịch đời thường (chia tiền ăn, mua hàng COD ≤ 500k)
  stages.ts      giai đoạn S0–S4 suy ra từ tín hiệu; cộng tối đa 15 điểm khi đi qua nhiều giai đoạn
  stability.ts   chống dao động: tăng ngay khi luật đủ bằng chứng; phần chỉ nhờ AI chờ 1 lần xác nhận;
                 hạ khi 2 lần đánh giá liên tiếp thấp hơn; không tự hạ từ Nghiêm trọng; ghi mức cao nhất
  context-manager.ts  ảnh chụp phiên (bản nháp + khóa khử trùng lặp, tóm tắt/tín hiệu AI, đánh dấu, diễn biến,
                 trạng thái cảnh báo) có phiên bản + mã kiểm tra; đọc lại kiểm tra chặt để "tiếp tục từ bản nháp"
  ledger.ts      Claim Ledger: phí / lương / công ty / địa điểm / hợp đồng → phát hiện mâu thuẫn
  scoring.ts     điểm 0–100 và 4 mức; tín hiệu nguy hiểm trực tiếp → Nghiêm trọng
  advice.ts      việc nên làm và câu hỏi xác minh; ở mức Nghiêm trọng thì tắt câu hỏi thăm dò
  evidence.ts    kiểm tra trích dẫn khớp tin nhắn gốc (bắt buộc với kết quả AI)
  transcript.ts  bản nháp tạm: khử trùng lặp theo cửa sổ DOM, giữ tối đa 300 tin
  export.ts      báo cáo HTML/JSON (escape HTML)
src/content/     content script thụ động cho tới khi người dùng bấm bắt đầu; adapter riêng cho Messenger và chat giả lập
src/background/  state machine của phiên, chrome.storage.session, Groq qua gateway (tùy chọn)
src/sidepanel/   giao diện (TypeScript thuần, chỉ dùng textContent)
```

**Dữ liệu:** phiên nằm trong `chrome.storage.session` (chỉ trong bộ nhớ, tự mất khi đóng trình duyệt). Dừng và xóa sẽ xóa dữ liệu rồi đọc lại để xác nhận. Cài đặt nằm trong `chrome.storage.local`; khi dùng gateway thì extension không giữ khóa model. Gateway local (`services/gateway`) giữ khóa Groq trong `.env` và **không lưu nội dung chat**; xem [README gateway](../services/gateway/README.md). Bản demo hiện chạy local-first, chưa dùng AWS thật.

**AI phân tầng (tùy chọn)** — `src/core/ai.ts`, `src/background/ai.ts`, `src/sidepanel/nano.ts`:

```
Bộ quy tắc (luôn chạy, miễn phí)
  └─ ngay khi bắt đầu quét (đọc tối đa 50 tin gần nhất), sau đó khi đủ N tin mới của cả hai phía (mặc định 2, có ít nhất 1 tin của đối phương) hoặc hội thoại dừng 20 giây mà còn tin lẻ, cách nhau ≥ X giây (mặc định 30):
       1. Gemini Nano trên máy (nếu bật + side panel đang mở) — không tốn lượt, dữ liệu không rời máy
       2. Groq `openai/gpt-oss-120b` qua gateway — mặc định, lượt nhanh
            └─ leo lên lượt sâu (cùng model, prompt đầy đủ, ngân sách lớn hơn) khi mức ≥ Cần chú ý,
               hoặc lượt nhanh thấy dấu hiệu nặng
```

- **Gửi phần chênh lệch (delta):** mỗi lần chỉ gửi tin mới, kèm 4 tin ngữ cảnh và bản tóm tắt cuộn do AI viết lần trước. Số điện thoại, số tài khoản và email được che trước khi gửi.
- **Giới hạn lượt gọi:** đặt số lượt Groq mỗi ngày (mặc định 200). Khi hết lượt, bộ quy tắc vẫn chạy bình thường.
- **Kiểm tra kết quả AI:** trích dẫn phải khớp tin gốc, không được trích tin của người dùng; nếu không thì tín hiệu bị loại.
- **Giới hạn quyền của AI:** AI chạy một mình không thể đưa lên mức Nghiêm trọng (mức "critical" của AI bị hạ xuống "high"). Khi AI lỗi, kết quả quy tắc được giữ nguyên, không hạ mức.
- **Gemini Nano:** chạy trong side panel vì Prompt API không khả dụng trong service worker. Prompt API chưa hỗ trợ `vi`, nên khai báo `en` (chế độ thử nghiệm), tin vẫn gửi nguyên văn tiếng Việt.

**Phân tích chi tiết** (tab *Phân tích*): bảng đóng góp điểm của từng tín hiệu, lý do ra mức hiện tại, thống kê theo nhóm, diễn biến mức cảnh báo theo từng tin, và trạng thái/tóm tắt của AI.

## Tình trạng so với lộ trình

| Giai đoạn | Trạng thái |
|---|---|
| Khung Vite/MV3, chat giả lập, 15 tình huống | Xong |
| Lõi phân tích (rules, ledger, scoring, advice) + test | Xong — 15/15 tình huống đúng mức |
| Extension: phiên, side panel, xuất, chuyển chat, đóng tab, dừng và xóa | Xong, đã test logic background bằng chrome giả |
| AI phân tầng (Nano + Groq `gpt-oss-120b`, delta, hạn mức) | Xong, đã test bằng `fetch` giả — **chưa chạy với API/mô hình thật** |
| Phân tích chi tiết, diễn biến, icon, hướng dẫn cài đặt | Xong |
| Bộ đọc khung chat Messenger trên facebook.com | Đã dò trên giao diện thật: xác định cuộc bằng ID tài khoản người kia, chọn 1 trong nhiều khung, đóng khung thì chờ mở lại — cần kiểm thử tay thêm |
| v0.3 — 7 nhóm kịch bản (tonghopkichban.md): R01–R10, ANY_2, thực thể, giai đoạn S0–S4, luật ngữ cảnh, AI hạ ≤ 1 bậc | Xong — 40/40 tình huống (5 ca TC của tài liệu + 20 ca cặp lừa đảo/bình thường), 0/17 cảnh báo nhầm |
| v0.4 — chống dao động mức cảnh báo, Context Manager (lưu phiên / tiếp tục từ bản nháp), luật nhận biết người dùng tự xác minh (mượn tiền) | Xong — 46/46 tình huống, 0/19 báo nhầm; test lõi + luồng background |
| Khung nghiên cứu (`research/`): bộ đề CSV/xlsx, chia dev/test khóa mã băm, OpenRouter, phát lại từng tin theo mốc, báo cáo MD/HTML | Xong — 157 test toàn dự án; bằng chứng Đợt 1, Đợt 2 thử nghiệm ở nhánh `research/evidence` |
| Đánh giá trên dữ liệu độc lập, thử nghiệm người dùng | Đợt 1 xong (nhánh `research/evidence`); Đợt 2 chờ bộ đề v2 |

## Giới hạn đã biết

- **Kết quả eval đang lạc quan:** fixtures được viết song song với rules nên rất dễ "học thuộc". Cần một bộ tình huống do người khác viết (held-out) để đo cho thật.
- Bộ đọc Messenger (`src/content/messengerAdapter.ts`) dựa vào cấu trúc trang hiện tại của khung chat popup (`role=log`, `data-message-id`, nhãn "Lúc …, Bạn: …"). Facebook đổi giao diện thì chạy `dev/dom-probe.js` để dò lại. Chat nhóm chưa hỗ trợ.
- Chỉ đọc văn bản. Ảnh, sticker, tin thoại, file và tin bị thu gọn đều bị bỏ qua.
- Tin cũ hơn thời điểm bắt đầu theo dõi (khi cuộn lên xem lịch sử) không được bổ sung vào bản nháp. Tin đến lúc khung chat đang đóng có thể bị bỏ sót.
- Quy tắc dựa trên mẫu từ khóa tiếng Việt không dấu: có thể bỏ sót cách diễn đạt mới và nhầm với từ đồng âm sau khi bỏ dấu.
- Ngoài phạm vi (theo quyết định 2026-10-30): SMS, cuộc gọi/robocall, bưu kiện COD, video call deepfake — chỉ bắt phần tin nhắn đi kèm.
- Luật ngữ cảnh chỉ hạ mức khi số tiền ≤ 500.000đ, có ngữ cảnh ăn uống/mua hàng có COD, không có ngữ cảnh tuyển dụng và không có tín hiệu rủi ro nào khác.
- Chưa rà soát chính sách Chrome Web Store hay điều khoản Meta (mục 16 kế hoạch); hiện chỉ dùng qua Developer mode.
- Gemini Nano chưa hỗ trợ chính thức tiếng Việt, nên chất lượng phân tích trên máy chưa được đánh giá.
