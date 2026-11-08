# EXP-019: Xin OTP kèm tự xưng ngân hàng hoặc dọa khóa

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `93b9e3a+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Xin OTP, mật khẩu kèm tự xưng ngân hàng hoặc dọa khóa tài khoản nên ở mức Nghiêm trọng, không làm tăng báo nhầm

## Thay đổi

Thêm luật `otp_institution_pressure` mức Nghiêm trọng: cần có lời xin OTP, mật khẩu, kèm một trong hai điều kiện là tự xưng ngân hàng, ví điện tử, hoặc dọa khóa tài khoản, trong cùng cửa sổ tin. Xin mã một mình vẫn ở mức Cao. Thêm 6 tình huống (148–153), gồm 3 ca không được đẩy lên. Luật cũ `otp_password_request` không đổi hành vi, chỉ tách mẫu ra để dùng chung.

## Kết quả

| Kiểm tra | Trước | Sau |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 43/65, 1/31, 3/32 |
| SMS: bình thường Cao+, lừa đảo Cao+ | 3,6%, 33,1% | 3,6%, 33,1% |
| Cuối 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 4/32 | 1/31, 4/32 |
| Đầu 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 2/32 | 1/31, 2/32 |
| Tình huống cố định | 147/147 | 153/153 |

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

## Kết luận

**Đạt trên các câu tự viết, chưa có số độc lập.** Tune không đổi nên chưa thấy tăng báo nhầm, nhưng cũng có nghĩa tune không cho thấy luật này giúp được gì thêm. Điểm yếu đã biết: người quen thật nhắn tài khoản bị khóa rồi xin mật khẩu cũng sẽ lên Nghiêm trọng. Chấp nhận vì đưa mật khẩu cho người khác vẫn là việc nên dừng lại kiểm tra.

## Tái lập

```bash
git checkout 93b9e3a
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-019" --hypothesis "tái lập" --method rules
```
