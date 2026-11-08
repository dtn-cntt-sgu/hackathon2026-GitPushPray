# EXP-023: Cảnh báo đòi tiền theo ngữ cảnh, bản chốt

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `49e9962+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Sửa trùng chữ cọc nhà, giữ nguyên các số của EXP-022

## Kết quả

So với trước đợt này (EXP-020):

| Kiểm tra | EXP-020 | EXP-023 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 44/65, 1/31, 3/32 |
| Tune: báo nhầm mọi mức | 21,9% | 18,8% |
| SMS thường: Cao+, có cảnh báo | 3,6%, 4,7% | 3,6%, 4,7% |
| SMS lừa đảo: Cao+, có cảnh báo | 33,1%, 59,8% | 33,1%, 59,8% |
| 50 tin ở cuối: đúng mức, bỏ sót, báo nhầm Cao+ | 39/65, 1/31, 4/32 | 39/65, 1/31, 4/32 |
| 50 tin ở đầu: đúng mức, bỏ sót, báo nhầm Cao+ | 40/65, 1/31, 2/32 | 40/65, 1/31, 2/32 |
| Tình huống cố định | 160/160 | 185/185 |

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

## Kết luận

**Đạt, chưa có số độc lập.** Các tập đo không cho thấy tăng báo nhầm, nhưng cũng chưa cho thấy bắt thêm ca lừa đảo: bỏ sót ở tune và tỷ lệ bắt SMS lừa đảo không đổi. Lợi ích hiện chỉ thấy trên các câu tự viết, nên cần bộ câu độc lập do người khác viết.

Hạn chế đã biết:

- "Tiền cơm 50 triệu" giờ ra Thấp nếu không có dấu hiệu khác. Đây là đánh đổi đã chấp nhận khi bỏ ngưỡng số tiền.
- "Gửi thêm tiền chợ cho mẹ" vẫn ra Cần chú ý, vì không dấu "tiền chợ" trùng "tiền cho".
- `VERIFIED_SAMPLE_LIMIT` (2 triệu) ở ca mượn tiền đã xác minh vẫn còn, chưa đổi trong đợt này.
- Từ khóa và ngữ cảnh do người viết luật soạn, nên cần người khác xem lại.

## Tái lập

```bash
git checkout 49e9962
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-023" --hypothesis "tái lập" --method rules
```
