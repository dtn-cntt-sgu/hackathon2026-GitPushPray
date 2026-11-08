# Hướng dẫn cài đặt & kiểm thử SafeChat AI (Developer mode)
 
## 1. Bản build
 
Repo đã có sẵn bản build mới nhất trong `apps/extension/dist/`, nên chỉ để dùng thử thì **không cần cài hay build**, chuyển thẳng sang bước 2.
 
Chỉ khi sửa code extension mới cần build lại:
 
```bash
npm install
npm run build:extension
```
 
## 2. Nạp extension vào Chrome
 
1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** và chọn thư mục `apps/extension/dist`.
4. Ghim biểu tượng SafeChat AI (hình khiên xanh) lên thanh công cụ.
Sau mỗi lần sửa code: chạy `npm run build:extension`, bấm nút ↻ của extension trong `chrome://extensions`, rồi **tải lại tab chat** để content script mới được nạp.
 
## 3. Chạy chat giả lập
 
```bash
npm run dev:extension
```
 
Mở `http://localhost:5178/mock-chat/`. Nếu cổng 5178 đang bận, Vite sẽ báo cổng khác.
 
## 4. Bật AI (tùy chọn)
 
Trong side panel, chọn **Cài đặt**:
 
| Tầng | Cách bật | Ghi chú |
|---|---|---|
| Bộ quy tắc | Luôn chạy | Miễn phí, chạy trên máy |
| Gemini Nano (trên máy) | Bấm **Tải mô hình & bật** | Cần Chrome máy tính, khoảng 22 GB trống, GPU trên 4 GB VRAM hoặc 16 GB RAM. Chỉ chạy khi side panel đang mở. Tiếng Việt chưa được hỗ trợ chính thức, nên đây là chế độ thử nghiệm (`en`). |
| Máy chủ SafeChat (gateway) | Nhập địa chỉ máy chủ (HTTPS) → **Bật máy chủ SafeChat** → đồng ý hộp thoại → cho phép quyền truy cập địa chỉ đó | **Không cần API key.** Khóa mô hình nằm ở máy chủ, extension không giữ khóa nào. Extension tự xin token thiết bị khi dùng lần đầu. Giới hạn lượt gọi mỗi ngày đặt trong Cài đặt. Khi bắt đầu quét, bạn chọn cách đọc: tự cuộn khung chat để tải tối đa 50 tin rồi trả về vị trí cũ, hoặc không cuộn và chỉ đọc các tin đang có trên trang. |
 
**Địa chỉ máy chủ SafeChat:** lấy từ người phụ trách gateway (staging hoặc production): `https://<địa-chỉ-gateway>`. Chỉ chấp nhận HTTPS (riêng `localhost` được dùng `http` khi phát triển). Địa chỉ phải thuộc `*.amazonaws.com`, `*.cloudfront.net` hoặc `*.on.aws`; nếu dùng tên miền riêng thì phải thêm tên miền đó vào `optional_host_permissions` trong `apps/extension/public/manifest.json` rồi build lại. Có thể gắn sẵn địa chỉ mặc định lúc build bằng biến `VITE_SAFECHAT_GATEWAY_URL` (PowerShell: `$env:VITE_SAFECHAT_GATEWAY_URL="https://…"; npm run build:extension`); nếu để trống, người dùng tự nhập trong Cài đặt. Dù có địa chỉ sẵn, người dùng vẫn phải bấm **Bật máy chủ SafeChat** và cấp quyền.
 
**Khi nào AI chạy:** bộ quy tắc chạy sau từng tin; AI chỉ chạy khi có ít nhất 1 tin mới của đối phương và thỏa một trong hai điều kiện: đủ 2 tin mới (mặc định, đổi được trong Cài đặt), hoặc hội thoại im 20 giây thì gọi nốt tin lẻ. Hai lần gọi cách nhau ít nhất 30 giây. Lúc khẩn cấp (bạn sắp hoặc đã làm theo yêu cầu, hoặc có tín hiệu Nghiêm trọng) AI được gọi ngay bằng lượt sâu, chỉ cần cách lượt trước 15 giây. Lần quét đầu và khi mức đã từ Cần chú ý trở lên dùng lượt sâu; mức Thấp dùng lượt nhanh.
 
**Gửi đi những gì:** chỉ các tin mới, kèm 4 tin ngữ cảnh và bản tóm tắt do AI viết lần trước. Số điện thoại, số tài khoản và email được che trước khi gửi. Gemini Nano chạy trên máy nên dữ liệu không rời máy; máy chủ SafeChat nhận dữ liệu đã che. **Dừng và xóa phiên** xóa dữ liệu trên máy này nhưng không thu hồi được dữ liệu đã gửi tới máy chủ. Có thể tắt máy chủ SafeChat bất cứ lúc nào; khi tắt, token thiết bị bị xóa khỏi máy.
 
**Khi AI không dùng được** (hết lượt, máy chủ lỗi, mất mạng): extension báo lỗi bằng tiếng Việt, bộ quy tắc vẫn chạy bình thường và mức cảnh báo **không** bị hạ. Sau lỗi, extension tạm nghỉ một lúc (30 giây đến 10 phút tùy loại lỗi) rồi mới gọi lại.
 
## 5. Checklist kiểm thử thủ công
 
Dùng chat giả lập. Với mỗi bước, đánh dấu ✅ hoặc ❌.
 
| # | Thao tác | Kỳ vọng |
|---|---|---|
| 1 | Mở side panel trên trang không hỗ trợ (ví dụ google.com) | Báo "chưa hỗ trợ"; nút Bắt đầu bị khóa |
| 2 | Mở chat giả lập, chưa tích đồng ý | Nút Bắt đầu bị khóa |
| 3 | Tích đồng ý → Bắt đầu theo dõi | Trạng thái "Đang theo dõi", đã ghi nhận 0 tin |
| 4 | Kịch bản `05` → Tự phát | Mức tăng dần lên **Cao**; tab Bằng chứng có thẻ "Lời nói về phí chưa nhất quán" với trích dẫn Trước/Sau |
| 5 | Bấm **Render lại DOM** nhiều lần | Số tin đã ghi nhận **không** tăng |
| 6 | Tab **Phân tích** | Có bảng cách tính điểm, thống kê theo nhóm, diễn biến theo thời gian |
| 7 | Đổi sang kịch bản `08` | Phiên tạm dừng với lý do "đã chuyển chat"; dữ liệu không bị trộn |
| 8 | Bấm "Xóa phiên này & theo dõi chat mới" → Tự phát | Mức **Nghiêm trọng**, khung "Ưu tiên an toàn", **không** có câu hỏi thăm dò |
| 9 | Tự gõ tin (người gửi "Tôi"): "có phải đặt cọc không ạ?" | Không gắn cờ tin của bạn |
| 10 | Tab Bản nháp → Xuất HTML / JSON | File tải về mở được; nội dung đúng phạm vi đã chọn |
| 11 | Đánh dấu một tín hiệu "Không liên quan" | Thẻ tín hiệu mờ đi; điểm không đổi; báo cáo xuất có ghi nhãn |
| 12 | Tạm dừng → gửi thêm tin → Tiếp tục | Tin gửi trong lúc tạm dừng không được tính; tin sau khi tiếp tục được tính |
| 13 | Đóng tab chat | Side panel báo "Tạm dừng — tab đã đóng" |
| 14 | **Dừng và xóa phiên** | Có thông báo đã xóa. Kiểm tra trong DevTools của service worker: `chrome.storage.session.get(null)` trả về `{}` |
| 15 | (Gateway) Nhập địa chỉ máy chủ → Bật máy chủ SafeChat → cho phép quyền → chạy kịch bản `03` | Dòng trạng thái AI hiện "Máy chủ SafeChat" (kèm tên model nếu có); tab Phân tích có tóm tắt AI; số lượt hôm nay tăng; **không** có ô nhập API key nào |
| 16 | (Gateway) Nhập địa chỉ sai (không phải `https://…`) rồi bấm Bật; sau đó thử địa chỉ đúng dạng nhưng không tồn tại | Địa chỉ sai dạng: báo "Địa chỉ máy chủ không hợp lệ (cần dạng https://…)", không bật. Địa chỉ không tồn tại: báo "Không kết nối được máy chủ SafeChat"; kết quả quy tắc giữ nguyên, mức không bị hạ |
| 17 | (Nano) Bật AI trên máy, giữ side panel mở, chạy một kịch bản | Trạng thái AI hiện "Gemini Nano trên máy" (hoặc lỗi kèm chuyển sang máy chủ SafeChat nếu đã bật) |
| 18 | Kịch bản `16_tc01_task_freeze` | **Nghiêm trọng**, khung an toàn hướng dẫn *dừng giao dịch / gọi ngân hàng* (không phải hướng dẫn di chuyển) |
| 19 | Kịch bản `17_tc02_police_apk` | **Nghiêm trọng**; tab Bằng chứng có thẻ R02 và "Đường link đáng ngờ" |
| 20 | Kịch bản `20_tc05_shop_deposit` | **Thấp**; thẻ "Đặt cọc trong giao dịch thông thường" có nhãn *Đã hạ mức theo ngữ cảnh* |
| 21 | Kịch bản `24_r03_task_ctv` → tab Phân tích | "Tiến trình kịch bản" sáng S1 → S2 → S3; "Vì sao" có dòng cộng điểm giai đoạn |
| 22 | Kịch bản `21_r01_police_scam` | Thẻ R01 dẫn chứng cả tin 1 và tin 3 (luật ghép nhiều tin) |
| 23 | Theo dõi một kịch bản lên mức Cao → tab Bản nháp → **Lưu phiên (.json)** → Dừng và xóa → mở lại side panel → tích đồng ý → **Tiếp tục từ bản nháp** chọn file → Tiếp tục phiên này | Phiên quay lại đủ tin, bằng chứng, đánh dấu; đầu phiên ghi "Tiếp tục từ bản nháp lưu lúc …"; phát thêm tin → chỉ tin mới được thêm (không trùng) |
| 24 | Sửa tay 1 chữ trong file phiên .json rồi chọn file đó | Báo "File đã bị chỉnh sửa hoặc hỏng", không khôi phục |
| 25 | Kịch bản `08_secrecy_family` (Nghiêm trọng) → gõ thêm vài tin bình thường từ phía đối phương | Mức **giữ** Nghiêm trọng, có dòng "Giữ mức Nghiêm trọng…", hướng dẫn an toàn vẫn hiện |
| 26 | Kịch bản `41_borrow_verified_small` → Tự phát | Sau tin nhờ mượn: **Cần chú ý**; sau khi "Tôi" xác nhận cuộc gọi: hiện dòng "Giữ mức Cần chú ý: cần thêm 1 lần đánh giá…"; tin kế tiếp: hạ về **Thấp**, thẻ "Mượn tiền sau khi đã xác minh người thật" có nhãn *Đã hạ mức theo ngữ cảnh* |
| 27 | Kịch bản `45_borrow_forged_call` (kẻ gian tự gõ "[cuộc gọi]") | Vẫn **Cao**, không hạ mức |
| 28 | Facebook thật: mở 2 khung chat → Kiểm tra lại | Panel liệt kê 2 tên để chọn; chỉ cuộc được chọn được đọc |
| 29 | Đang theo dõi → đóng khung chat → mở lại | Panel hiện "Đang chờ mở lại khung chat", mở lại thì đọc tiếp, bản nháp không trùng tin |
| 30 | Facebook thật: kiểm tra bản nháp | Tin của mình là "Tôi", của đối phương là người kia; không lẫn chữ "Nhập, bản sao trợ năng" |
| 31 | Facebook thật: mở facebook.com, **chưa** tích đồng ý, chưa bấm Bắt đầu | **Không** có khung SafeChat nổi nào trên trang (mặc định tắt) |
| 32 | Tích đồng ý → Bắt đầu theo dõi một cuộc chat | Khung nổi hiện, trạng thái "LIVE", chỉ có **mức và điểm** (không có nội dung chat, tên người, bằng chứng). Chi tiết xem ở side panel |
| 33 | Tải lại trang Facebook khi đang theo dõi | Khung nổi hiện lại với mức và điểm hiện tại; bản nháp vẫn nhận tin mới sau khi tải lại |
| 34 | Tạm dừng, hoặc chuyển sang chat khác | Khung nổi biến mất. Trong Console của trang, `document.body.lastElementChild.shadowRoot` trả về `null` (Shadow DOM đóng) |
 
**Xem log:** vào `chrome://extensions`, bấm **service worker** để mở DevTools của background. Mở DevTools của side panel bằng cách chuột phải vào panel và chọn **Inspect**. Extension không ghi nội dung chat ra console.
 
## 6. Messenger thật (thử nghiệm)
 
Messenger web hiện chỉ còn **khung chat popup** trên facebook.com. Mở khung chat (không thu nhỏ) → panel → Kiểm tra lại → (đang mở nhiều khung thì chọn một người) → Bắt đầu theo dõi.
- Cuộc trò chuyện được xác định bằng ID tài khoản người kia (link ở phần đầu khung), không bằng tên; mọi mã tin phải khớp ID đó, lệch là bộ đọc tự ngừng và báo trong panel.
- Đóng khung chat: phiên được giữ ở trạng thái **Đang chờ mở lại khung chat**; mở lại đúng người đó thì đọc tiếp. Mở thêm khung khác không ảnh hưởng.
- Chat nhóm, ảnh/sticker/tin thoại: chưa hỗ trợ.
- Khung cảnh báo nổi chỉ hiện sau khi bắt đầu theo dõi (xem mục 7).
- Selector dò trên giao diện thật 11/2026 (`apps/extension/dev/dom-probe.js`, chỉ in cấu trúc). Facebook đổi giao diện → chạy lại script và chỉnh `apps/extension/src/content/messengerAdapter.ts`.
## 7. Khung cảnh báo nổi trên trang
 
- Khung nổi **không bao giờ tự hiện khi tải trang**. Chỉ hiện sau khi người dùng tích đồng ý và bấm **Bắt đầu theo dõi** trong side panel. Vì vậy trên Facebook, extension mặc định không hiện gì cho tới khi bắt đầu theo dõi.
- Khung chỉ nhận **mức cảnh báo, điểm và trạng thái** (đang theo dõi, chờ mở lại khung chat, tạm dừng). Nội dung tin nhắn, tên người, tóm tắt và bằng chứng không bao giờ được gửi tới khung này; muốn xem chi tiết thì mở side panel.
- Khung nằm trong Shadow DOM ở chế độ đóng, script của trang không truy cập được nội dung bên trong.
- Khung biến mất khi tạm dừng, đổi chat, dừng và xóa phiên, hoặc đóng tab. Bấm nút **—** để thu nhỏ thành nút nổi.
## 8. Ghi kết quả thử Facebook thật (mục 28–34)
 
Dùng **tài khoản thử**, không dùng tài khoản chính hoặc hội thoại thật của người khác. Ghi kết quả vào bảng dưới (hoặc `docs/test-facebook.md`).
 
- Phiên bản Chrome: …
- Ngày thử: …
- Phiên bản extension (`manifest.json`): …
| Mục | Kỳ vọng | Thực tế | Đạt / Không đạt | Ảnh chụp / ghi chú |
|---|---|---|---|---|
| 28 | | | | |
| 29 | | | | |
| 30 | | | | |
| 31 | | | | |
| 32 | | | | |
| 33 | | | | |
| 34 | | | | |
 
Nếu không đạt, ghi thêm lỗi trong Console (trang và service worker) và các bước tái hiện. Không dán nội dung chat thật vào báo cáo.