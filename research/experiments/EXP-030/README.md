# EXP-030: Trục nạn nhân, bản sửa báo nhầm mã mẫu

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `0360ea5+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Không coi câu nói mã OTP cố định khi kiểm thử là đã đưa mã, giữ các ca bắt được của EXP-029

## Kết quả

So với trước đợt này (EXP-028):

| Kiểm tra | EXP-028 | EXP-030 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 44/65, 1/31, 3/32 | 43/65, 1/31, 3/32 |
| Tune: bắt đúng ca Nghiêm trọng | 12/21 | 15/21 |
| Tune: ca nhãn Cao bị đẩy lên Nghiêm trọng | 3/10 | 7/10 |
| SMS: thường Cao+, lừa đảo Cao+ | 4,0%, 33,9% | 4,0%, 33,9% |
| 50 tin ở cuối: đúng mức, báo nhầm Cao+ | 39/65, 4/32 | 38/65, 4/32 |
| Tình huống cố định | 224/224 | 244/244 |

Không ca thường nào trên tune lên Nghiêm trọng. Phiên thử tuyển mẫu ảnh phát lại: lên Nghiêm trọng khi đối phương bảo đăng nhập rồi chụp mã gửi lại, nhận ra 4 câu bị né.

## Kết luận

**Đạt theo quy tắc mới, cần duyệt nhãn.** Đúng mức giảm 1 ca vì 5 ca lừa đảo có nhãn Cao (V2_S19, V2_S37, V2_S44, TT_CTV_005, TT_CTV_007) nay là Nghiêm trọng: nạn nhân đã chuyển hoặc sắp chuyển tiền, hoặc bị mồi rồi đòi tiếp. Nhãn được gán trước quy tắc này. Đổi nhãn cần người duyệt, chưa đổi.

Hạn chế đã biết:

- Nhận ra ý định qua câu chữ, nạn nhân nói khác đi vẫn có thể lọt.
- Phát hiện vòng vo dựa vào từ trấn an, viện cớ; đối phương trả lời dài, có vẻ cụ thể nhưng không kiểm chứng được thì có thể lọt.
- Chưa có số độc lập: các ca đều do người viết luật soạn hoặc viết lại.

## Tái lập

```bash
git checkout 0360ea5
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-030" --hypothesis "tái lập" --method rules
```
