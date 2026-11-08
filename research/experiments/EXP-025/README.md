# EXP-025: Tách đuôi tên miền bị lạm dụng khỏi đuôi phổ biến

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `a7e518c+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Giữ Cần chú ý cho đuôi hay bị lạm dụng sẽ lấy lại các SMS lừa đảo đã mất ở EXP-024 mà không tăng báo nhầm

## Thay đổi

Tách đôi danh sách đuôi: đuôi hay bị lạm dụng giữ Cần chú ý; đuôi trang thật cũng hay dùng (`.shop`, `.store`, `.live`, `.site`, `.club`, `.link`, `.work`) đứng một mình không tăng mức.

## Kết quả

| Kiểm tra | EXP-024 | EXP-025 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 44/65, 1/31, 3/32 | 44/65, 1/31, 3/32 |
| SMS lừa đảo: Cao+, có cảnh báo | 33,9%, 44,8% | 33,9%, 61,1% |
| SMS thường: Cao+, có cảnh báo | 4,1%, 5,3% | 4,1%, 5,3% |

Còn 4 tin thường có tín hiệu ghép: tin Lazada dặn không chia sẻ OTP, tin nhà mạng báo thiếu tiền đăng ký gói, 2 tin nhà mạng khác.

## Kết luận

**Gần đạt, sửa 2 tin rõ ràng ở EXP-026.**

## Tái lập

```bash
git checkout a7e518c
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-025" --hypothesis "tái lập" --method rules
```
