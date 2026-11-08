# EXP-027: Đọc mã QR trong ảnh ngay trên máy

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `91b5ca0+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Đọc QR trong ảnh và ghép với ngữ cảnh giúp cảnh báo QR chuyển tiền đáng ngờ, không đổi kết quả các tập chỉ có chữ

## Thay đổi

- Kiểm tra trên Messenger thật, chat popup trên facebook.com: ảnh tin nhắn gửi đến là `data:`, gốc 148 hoặc 1000 px, canvas đọc được. Vì vậy giải mã ngay trong content script, không cần quyền CDN và không tải ảnh đi đâu. Bộ lọc theo kích thước hiển thị từ 80 px thay cho 150 px.
- Thêm `packages/core/src/qr.ts`: đọc VietQR, kiểm tra CRC, phân loại URL, chuyển tiền, Wi-Fi, liên hệ, danh thiếp, cài ứng dụng, tiền ảo, văn bản. Giải mã bằng `jsQR` trong `qrDecode.ts`.
- Tin chỉ có ảnh QR nay vào được bản nháp. Nội dung QR không gửi cho AI. Số tài khoản trong kết quả chỉ còn 4 số cuối.
- Tín hiệu: `qr_payment_request` (Thấp), `qr_payment_context` (Cao), `qr_invalid_crc` (Cần chú ý), `qr_install` (Cao), `qr_crypto` (Cần chú ý). QR chứa link đi qua phân tích link.
- Lời đồng ý có nhắc tới mã QR, có công tắc tắt đọc QR.

## Kết quả

| Kiểm tra | EXP-026 | EXP-027 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 44/65, 1/31, 3/32 | 44/65, 1/31, 3/32 |
| SMS lừa đảo: Cao+, có cảnh báo | 33,9%, 61,1% | 33,9%, 61,1% |
| SMS thường: Cao+, có cảnh báo | 4,0%, 5,2% | 4,0%, 5,2% |
| Tình huống cố định | 211/211 | 223/223 |

Các tập trên không có ảnh, nên không đổi là đúng dự kiến và không nói gì về chất lượng đọc QR.

Thử giải mã qua đúng đường đọc của extension, 6 loại nội dung, mỗi loại 8 biến thể (1000 px, 148 px, 150 px, JPEG nén mạnh, xoay 15 độ, mờ, đảo màu, QR nhỏ trong ảnh chụp lớn): **48/48 đọc đúng, không ca nào đọc sai**. Mục tiêu là 95% với ảnh sạch, 70% với ảnh méo.

`content.js` tăng từ khoảng 78 KB lên khoảng 212 KB vì `jsQR`.

## Kết luận

**Đạt trên ảnh do máy sinh, chưa có số thật.** Ảnh đều sinh từ thư viện rồi làm méo bằng phần mềm, nên 48/48 chưa đại diện cho ảnh chụp bằng điện thoại, QR dán đè hoặc ảnh có viền trang trí.

Hạn chế đã biết:

- Cấu trúc VietQR đối chiếu qua chuẩn EMVCo và mã nguồn mẫu, chưa đọc được bản đặc tả gốc của Napas.
- Chưa có tên ngân hàng: chỉ hiện mã BIN, vì danh sách cần người trong nhóm xác minh.
- Ảnh khác nguồn làm canvas bị khóa thì bỏ qua, không báo cho người dùng. Lần thử chưa gặp trường hợp này nhưng mới thử chat popup.
- jsQR chỉ đọc một mã trong mỗi ảnh.
- Chưa thử giải mã trên Messenger thật, mới thử trên trang giả.

## Tái lập

```bash
git checkout 91b5ca0
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-027" --hypothesis "tái lập" --method rules
```
