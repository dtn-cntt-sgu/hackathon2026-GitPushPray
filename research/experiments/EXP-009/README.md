# EXP-009: Gom đủ 5 tin mới gọi AI một lần, gọi nốt tin lẻ khi dừng 60 giây

- **Ngày:** 2026-11-07
- **Cách suy luận:** đếm lượt gọi bằng AI giả, không gọi mạng
- **Commit:** `a7abe92+dirty`, đo trước khi commit thay đổi
- **Tập:** `set:v2/tune`, 65 ca, 381 tin của đối phương
- **Xem check:** không

## Thay đổi

`decideAiRun` gọi AI trong hai trường hợp:

1. Có đủ `batchSize` tin mới của đối phương, mặc định 5.
2. Có tin mới chưa đủ lô và hội thoại đã dừng `idleFlushSec` giây, mặc định 60. Đặt 0 để tắt.

Bỏ hai điều kiện gọi sớm: mức cảnh báo tăng và có tín hiệu quy tắc mới. Luật vẫn chạy và cảnh báo sau từng tin.

Extension dùng `chrome.alarms` để hẹn giờ vì service worker có thể bị tắt trước khi `setTimeout` 60 giây chạy. Vì vậy manifest có thêm quyền `alarms`.

## Giả thuyết

Gom tin giảm lượt gọi mà cảnh báo của luật không chậm đi. Gọi nốt tin lẻ giúp AI đọc hết hội thoại, đổi lại tốn thêm lượt gọi.

## Kết quả

| Tune, AI giả | Trước, có gọi sớm | Lô 5, không gọi nốt | Lô 5, gọi nốt sau 60 giây (đang dùng) | Lô 3, không gọi nốt |
|---|---:|---:|---:|---:|
| Lượt gọi AI | 96 | 61 | **116** | 115 |
| Ca không được gọi lần nào | 1 | 4 | **0** | 1 |
| Tin chưa được AI đọc ở cuối ca | 103 | 76 | **0** | 36 |
| Ca nguy hiểm có tin nguy hiểm đầu tiên nằm sau lượt gọi cuối (trên 31 ca) | chưa đo | 3 | **0** | 1 |

So với trước, cách đang dùng tốn thêm 21% lượt gọi (116 so với 96). Đổi lại, AI đọc hết mọi tin, nhưng các tin cuối chỉ được đọc sau khi hội thoại dừng 60 giây.

## Kết luận

**Mới đo được lượt gọi, chưa đo được chất lượng.** Số này không dùng model nên không nói được về bỏ sót hay báo nhầm.

Hạn chế:

- Mục tiêu giảm lượt gọi không đạt: 116 lượt cao hơn 96 lượt lúc đầu. 55/65 ca phát sinh thêm một lượt gọi nốt, kể cả khi chỉ còn 1 tin lẻ.
- Số 116 là mức tối thiểu của cách này trên tập đo. Bản phát lại dùng khoảng cách 20 giây giữa các tin nên chỉ có khoảng dừng ở cuối ca. Hội thoại thật dừng 60 giây ở giữa chừng sẽ tốn thêm lượt.
- AI đọc tin lẻ chậm hơn lúc trước. Trong lúc chờ, cảnh báo chỉ đến từ luật.
- `chrome.alarms` mới được thử bằng chrome giả trong test, chưa thử trên Chrome thật. Từ Chrome 120 alarm có thể đặt tối thiểu 30 giây; bản 116–119 là 1 phút, nên có thể lệch nhẹ.

Các cấu hình `ai` và `hybrid-hint` đọc cả hội thoại một lần nên thay đổi này không ảnh hưởng tới chúng. Muốn đo đúng sản phẩm phải chạy `replay-hybrid` với model thật.

## Tái lập

```bash
npm run bench:ai-calls -- --batch 5 --idle 60
```

Đặt `--idle 0` để lấy số khi không gọi nốt. Muốn lấy cột "Trước", checkout commit `a7abe92` rồi chép `research/ai-call-count.ts` sang, bỏ `idleFlushSec`.
