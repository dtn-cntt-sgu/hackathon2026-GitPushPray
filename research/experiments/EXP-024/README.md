# EXP-024: Phân tích link trên máy, ghép ngữ cảnh, nhận biết người dùng đã làm theo

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `a7e518c+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Phân tích URL thật, ghép link với lời nói và không tăng mức vì đuôi tên miền sẽ bắt thêm link giả mà không tăng báo nhầm

## Thay đổi

- Thêm `packages/core/src/link.ts`: phân tích URL thật bằng `tldts`, nhận mọi đuôi tên miền có thật, địa chỉ số, dấu @, punycode, chữ giả, gần giống thương hiệu. Gỡ link bọc Facebook. Không truy cập link.
- Đọc địa chỉ thật trong thẻ a. Địa chỉ này không gửi cho AI.
- `claim_link_mismatch`: tự xưng đơn vị, link không phải trang của đơn vị. `link_with_pressure`: link kèm dọa khóa hoặc giục gấp.
- `user_complied_*`: người dùng nói đã làm theo yêu cầu, chuyển sang việc cần làm ngay.
- Đuôi tên miền rẻ đứng một mình không tăng mức.

## Kết quả

Lần đo đầu, **mất nhiều ca lừa đảo**:

| Kiểm tra | EXP-023 | EXP-024 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 44/65, 1/31, 3/32 | 44/65, 1/31, 3/32 |
| SMS lừa đảo: Cao+, có cảnh báo | 33,1%, 59,8% | 33,9%, **44,8%** |
| SMS thường: Cao+, có cảnh báo | 3,6%, 4,7% | **4,1%, 5,3%** |

Nguyên nhân: 44 tin lừa đảo xuống Thấp vì chỉ có đuôi rẻ, chủ yếu `.cc`, `.vip`, `.top`, `.online`. Trong SMS thường không có tin nào ở trường hợp này, nên hạ mức đuôi rẻ không giảm được báo nhầm nào.

## Kết luận

**Chưa đạt, sửa ở EXP-025.**

## Tái lập

```bash
git checkout a7e518c
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-024" --hypothesis "tái lập" --method rules
```
