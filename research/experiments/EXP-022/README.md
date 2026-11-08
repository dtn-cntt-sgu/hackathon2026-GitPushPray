# EXP-022: Siết từ khóa đòi tiền sau lần đo EXP-021

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `49e9962+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Loại tin nhà mạng, phí ship, kể chuyện và cho ngữ cảnh đời thường hạ luật ghép sẽ đưa báo nhầm về như trước mà vẫn giữ các ca đòi tiền

## Thay đổi

So với EXP-021: loại tin nhà mạng, phí ship, mua thêm, thẻ xe, công ty đóng bảo hiểm khỏi từ khóa; bỏ "tiền cọc" đứng một mình; cho bối cảnh đời thường hạ được `money_request_context`, trừ khi có lời hứa rút tiền, hoàn tiền, lợi nhuận hoặc tiền hàng, tiền nợ.

## Kết quả

| Kiểm tra | EXP-021 | EXP-022 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 4/32 | 44/65, 1/31, 3/32 |
| SMS thường: Cao+, có cảnh báo | 3,6%, 6,1% | 3,6%, 4,7% |
| SMS lừa đảo: Cao+ | 33,5% | 33,1% |

Tình huống cố định còn 1 ca sai: không dấu thì "cọc nhà" trùng "cọc nha".

## Kết luận

**Gần đạt, sửa nốt ở EXP-023.**

## Tái lập

```bash
git checkout 49e9962
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-022" --hypothesis "tái lập" --method rules
```
