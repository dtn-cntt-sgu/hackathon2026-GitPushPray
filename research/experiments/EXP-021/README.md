# EXP-021: Cảnh báo đòi tiền theo từ ngữ và ngữ cảnh, bỏ ngưỡng số tiền

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `49e9962+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Thêm cách nói đòi thêm tiền, ghép ngữ cảnh và bỏ ngưỡng 500.000 giúp bắt thêm yêu cầu tiền mà không tăng báo nhầm

## Thay đổi

Theo yêu cầu của Duy: cảnh báo đòi tiền theo từ ngữ và ngữ cảnh, không theo số tiền.

- Thêm `money_request_phrase` (Cần chú ý), `money_request_context` (Cao khi kèm việc làm, lời hứa hoàn tiền, giục gấp, giá trị quá cao), `money_request_threat` (Nghiêm trọng khi dọa mất tiền).
- Thêm `repeated_money_request`: đòi tiền từ 2 tin trở lên. Số tiền sau cao hơn trước trong bối cảnh nhiệm vụ thì là nạp leo thang.
- Bỏ `SMALL_AMOUNT = 500_000`. Bỏ mẫu chỉ bắt "triệu" trong `task_escalating_deposit`.
- Sửa báo nhầm: phủ định ở `task_deposit`, kể chuyện người khác bị lừa, đặt cọc qua kênh chính thức. Từ đời thường không còn khớp đuôi `.com`.

## Kết quả

Lần đo đầu, **báo nhầm tăng** nên chưa dùng được.

| Kiểm tra | EXP-020 | EXP-021 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 43/65, 1/31, **4/32** |
| SMS thường: Cao+, có cảnh báo | 3,6%, 4,7% | 3,6%, **6,1%** |
| SMS lừa đảo: Cao+ | 33,1% | 33,5% |
| 30 tin ở cuối: báo nhầm Cao+ | 4/32 | **6/32** |

Nguyên nhân: tin nhà mạng khớp "nạp vào tài khoản", "nạp thêm tiền"; một ca sinh hoạt ở tune lên Cao vì bối cảnh đời thường chưa hạ được luật ghép. 8/8 câu đời thường tự viết thêm đều ra Cần chú ý.

## Kết luận

**Chưa đạt, sửa tiếp ở EXP-022.**

## Tái lập

```bash
git checkout 49e9962
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-021" --hypothesis "tái lập" --method rules
```
