# EXP-026: Phân tích link trên máy, bản chốt

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `a7e518c+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Sửa tin dặn không chia sẻ OTP và tin nhà mạng, giữ các ca lừa đảo đã bắt được

## Kết quả

So với trước đợt link (EXP-023):

| Kiểm tra | EXP-023 | EXP-026 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 44/65, 1/31, 3/32 | 44/65, 1/31, 3/32 |
| SMS lừa đảo: Cao+, có cảnh báo | 33,1%, 59,8% | 33,9%, 61,1% |
| SMS thường: Cao+, có cảnh báo | 3,6%, 4,7% | 4,0%, 5,2% |
| 50 tin ở cuối: đúng mức, bỏ sót, báo nhầm Cao+ | 39/65, 1/31, 4/32 | 39/65, 1/31, 4/32 |
| 50 tin ở đầu: đúng mức, bỏ sót, báo nhầm Cao+ | 40/65, 1/31, 2/32 | 40/65, 1/31, 2/32 |
| Tình huống cố định | 185/185 | 211/211 |

## Kết luận

**Đạt có điều kiện, chưa có số độc lập.** Bắt thêm SMS lừa đảo khoảng 1 điểm phần trăm, đổi lại SMS thường bị cảnh báo cũng tăng khoảng 0,5 điểm phần trăm, chủ yếu do tin nhà mạng dùng link rút gọn và tin nhắc xác thực thuê bao. Tune không đổi nên không cho biết thêm về luật mới; tune có ít ca chứa link.

Hạn chế đã biết:

- Danh sách tên miền chính thức và thương hiệu chưa được người trong nhóm xác minh.
- Link có token trong path vẫn hiện path. Query không được lưu vào kết quả.
- `user_complied_*` dựa vào câu nói của người dùng, có thể lọt nếu nói khác đi.
- Đọc địa chỉ thẻ a chưa thử trên Messenger thật.

## Tái lập

```bash
git checkout a7e518c
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-026" --hypothesis "tái lập" --method rules
```
