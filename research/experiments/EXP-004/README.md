# EXP-004: Mô hình học từ dữ liệu, không dùng luật

- **Ngày:** 2026-11-07
- **Cách suy luận:** ML ký tự TF-IDF + hồi quy logistic
- **Commit:** `2f0e1c7+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Đo xem học từ dữ liệu có tổng quát sang ca và kịch bản chưa thấy không. Dữ liệu ít nên có thể yếu, nhưng cho biết giới hạn của phương pháp này.

## Kết quả

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

## Kết luận

Số đẹp nhưng **không đáng tin**. Kiểm định chéo bỏ sót 6–13%, báo nhầm 3%, trong khi SMS thật báo nhầm 38,3% và bắt 66,1%. EXP-006 cho thấy mô hình chủ yếu học văn phong của nguồn dữ liệu. Thử kịch bản chưa thấy bắt được 22/31, thấp hơn rõ rệt so với kiểm định chéo. Không xem check vì check có cùng lỗi nên không kiểm chứng được. Không dùng.

## Tái lập

Chạy `research/ml_baseline.py` với cùng tham số, seed cố định 20261107.
