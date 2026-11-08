# EXP-002: Khung ý định thay cho mẫu câu

- **Ngày:** 2026-11-07
- **Cách suy luận:** frames (frames-v1)
- **Commit:** `2f0e1c7+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Lừa đảo khác câu chữ nhưng giống cấu trúc: yêu cầu gây hại, cớ để tin, sức ép. Suy luận theo tổ hợp này sẽ bắt được cách nói mới tốt hơn luật mẫu câu, có thể đổi lại bằng báo nhầm cao hơn.

## Kết quả

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

## Kết luận

Giả thuyết **sai**. Khung ý định bỏ sót 9/31 và báo nhầm 8/32 ngay trên tune, tệ hơn luật về cả hai phía. Trên SMS thật có cảnh báo ở 53,5% tin bình thường, nghĩa là từ vựng rộng bắt quá nhiều giao dịch đời thường. Không xem check vì không có lý do chọn. Không dùng hướng này.

## Tái lập

```bash
git checkout 2f0e1c7
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-002" --hypothesis "tái lập" --method frames
```
