# EXP-029: Trục nạn nhân, dấu hiệu giai đoạn cuối, phát hiện vòng vo

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `0360ea5+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Nạn nhân sắp hoặc đã làm theo yêu cầu mức Cao thì lên Nghiêm trọng, thêm dấu hiệu giai đoạn cuối và né câu hỏi, không tăng báo nhầm

## Thay đổi

Theo yêu cầu của Duy sau khi thử phiên tuyển mẫu ảnh: nạn nhân nghi ngờ 4 lần vẫn bị dụ tới mức định gửi mã, nhưng hệ thống chỉ báo Cao.

- Trục nạn nhân: `user_intends_*` (sắp làm theo) và `user_complied_*` (đã làm theo). Sau yêu cầu từ mức Cao trở lên thì bắt buộc Nghiêm trọng; sau yêu cầu nhẹ hơn thì Cao. Bằng chứng vẫn là lời yêu cầu của đối phương.
- Dấu hiệu giai đoạn cuối, mức Nghiêm trọng: `withdrawal_fee` (nộp phí, thuế mới cho rút hoặc giải ngân), `bait_then_demand` (báo đã hoàn tiền rồi đòi nạp tiếp, chỉ trong bối cảnh nhiệm vụ), `account_takeover_code` (dẫn đăng nhập rồi xin gửi lại mã). Thêm `apk_install_request` (Cao).
- `evasive_reassurance`: từ 2 câu hỏi hoặc nghi ngờ bị né bằng trấn an, khen, viện quy trình thì Cần chú ý, có yêu cầu nguy hiểm thì Cao. Ô "Bạn đã hỏi nhưng chưa được trả lời rõ" trong widget và side panel.
- Lời cảnh báo riêng khi người dùng đang hoặc vừa làm theo.
- Sửa đọc Messenger: bỏ chữ trạng thái "Đã gửi" dính vào tin, bỏ thông báo mã hóa đầu cuối, gộp mã tin hàng ngoài và hàng trong. Chữ "Đã gửi" từng làm tín hiệu "đã đưa mã" bật vì khớp chữ, không phải vì hiểu câu.
- Đổi kỳ vọng 5 tình huống cũ (36, 163, 194, 195, 222) từ Cao lên Nghiêm trọng theo quy tắc mới. Thêm 20 tình huống (225–244), gồm ca viết lại từ phiên thử và các ca đối chứng.

## Kết quả

Lần đo đầu có 1 ca thường trên tune (V2_BT_32, hội thoại kiểm thử phần mềm) lên Nghiêm trọng vì câu "nhập mã OTP cố định là 123456" bị hiểu là đã đưa mã. Sửa ở EXP-030.

## Kết luận

**Chưa đạt, sửa ở EXP-030.**

## Tái lập

```bash
git checkout 0360ea5
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-029" --hypothesis "tái lập" --method rules
```
