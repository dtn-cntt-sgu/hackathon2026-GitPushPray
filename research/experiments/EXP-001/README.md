# EXP-001: 10 đề xuất từ phân tích lỗi trên tune

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `2f0e1c7+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** có, chỉ số tổng

## Giả thuyết

Thêm và mở rộng luật theo nguyên nhân lỗi đọc được trên tune sẽ giảm bỏ sót, nhận ra tin cảnh báo và phủ định sẽ giảm báo nhầm.

## Kết quả

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

## Kết luận

Giả thuyết **chỉ đúng một phần**. Tune giảm bỏ sót từ 11/31 xuống 1/31, nhưng check giữ nguyên 10/19, nên các luật mới khớp với ca đã đọc và chưa tổng quát. Số tune không dùng làm thành tích. Báo nhầm giảm trên cả hai tập, SMS thật không tăng báo nhầm và tăng nhẹ tin bắt được, nên phần giảm báo nhầm đáng giữ.

## Tái lập

```bash
git checkout 2f0e1c7
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-001" --hypothesis "tái lập" --method rules
```
