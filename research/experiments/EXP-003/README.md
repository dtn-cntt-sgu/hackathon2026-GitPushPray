# EXP-003: Luật kết hợp khung ý định

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules+frames (frames-v1)
- **Commit:** `2f0e1c7+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Lấy mức cao hơn của luật và khung sẽ giảm bỏ sót so với luật một mình; cần xem báo nhầm tăng bao nhiêu.

## Kết quả

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

## Kết luận

Giả thuyết **không đạt yêu cầu**. Không giảm thêm bỏ sót so với luật (đều 1/31) mà báo nhầm từ mức Cao tăng từ 3/32 lên 9/32. Khung không bổ sung được gì cho luật. Không xem check.

## Tái lập

```bash
git checkout 2f0e1c7
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-003" --hypothesis "tái lập" --method rules+frames
```
