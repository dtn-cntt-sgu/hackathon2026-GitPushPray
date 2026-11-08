# EXP-013: Xét ngữ cảnh đời thường trong ±4 tin quanh bằng chứng

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules, trên hội thoại dài ghép từ tune
- **Commit:** xem lệnh tái lập
- **Tập:** `set:v2/tune`, ca gốc và ca đệm lên 30, 50 tin
- **Xem check:** không

## Giả thuyết

Báo nhầm tăng ở hội thoại dài là do bước hạ mức cho giao dịch đời thường xét ngữ cảnh trên cả hội thoại. Xét trong ±4 tin quanh bằng chứng sẽ giảm báo nhầm mà không tăng bỏ sót, kể cả khi đoạn lừa đảo nằm ở đầu.

## Thay đổi

- `applyContextMitigations` xét số tiền, từ khóa và tín hiệu khác trong ±4 tin quanh bằng chứng.
- Chốt chặn: có tín hiệu nguy hiểm trực tiếp, Nghiêm trọng, cô lập, kỹ thuật hoặc lừa việc làm ở bất kỳ đâu trong hội thoại thì không hạ.
- Thêm 6 tình huống (112–117), trong đó 2 ca né luật và 1 ca đòi phí từ sớm rồi nói chuyện thường. Tổng 117 tình huống, mốc eval cập nhật vì thêm ca.

## Kết quả

Mỗi ô: bỏ sót /31, báo nhầm Cao+ /32. Cột đầu là số trước khi sửa.

| Tập | Trước | Sau | Đúng mức trước | Đúng mức sau |
|---|---:|---:|---:|---:|
| Ca gốc | 1, 3 | 1, 3 | 43/65 | 43/65 |
| Đoạn gốc ở cuối, 30 tin | 1, 7 | 1, 4 | 36/65 | 41/65 |
| Đoạn gốc ở cuối, 50 tin | 1, 9 | 1, 4 | 34/65 | 39/65 |
| Đoạn gốc ở đầu, 30 tin | 2, 6 | 1, 3 | 36/65 | 40/65 |
| Đoạn gốc ở đầu, 50 tin | 1, 8 | 1, 2 | 35/65 | 40/65 |

Bắt đúng Nghiêm trọng giữ 12/21 ở mọi tập. Không ca gốc nào đổi mức, nên tune gốc và SMS (tin đơn) không có bằng chứng thay đổi.

Các phương án đã thử và bỏ:

| Phương án, đoạn gốc ở đầu, 30 và 50 tin | Bỏ sót |
|---|---:|
| Hạ bậc tín hiệu cũ hơn 15 tin | 16 và 14 trên 31 |
| Chỉ đọc 20 tin cuối | 29 và 31 trên 31 |

Hai phương án này làm hệ thống quên yêu cầu đòi tiền đã có từ sớm.

## Kết luận

**Giả thuyết đúng trên dữ liệu ghép, chưa có số độc lập.** Tin đệm ghép từ chính tune và không liên quan đến ca được đệm, nên có thể phóng đại cả lỗi cũ lẫn tác dụng của bản sửa. Cần hội thoại dài viết tay để đo chắc.

Hạn chế còn lại:

- Báo nhầm ở ca đệm vẫn cao hơn ca gốc: 4/32 so với 3/32 ở đoạn gốc nằm cuối.
- Kẻ gian không có tín hiệu nào được luật nhận ra ở xa vẫn có thể chèn "tiền cơm" để né. Khi đó phải trông vào AI.
- **Lỗ hổng riêng, chưa sửa:** câu "Không đóng là chị cho người đến tận nhà xử lý em đó" không kích hoạt luật đe dọa nào. Cần duyệt riêng theo quy trình sửa luật.
- `TT_CTV_008` vẫn bị bỏ sót.

## Tái lập

```bash
git checkout $(git log -1 --format=%h -- research/experiments/EXP-013/metrics.json)
```

```bash
npm run bench:long-eval
```
