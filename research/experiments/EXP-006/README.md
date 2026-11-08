# EXP-006: Kiểm tra mô hình học văn phong hay học dấu hiệu

- **Ngày:** 2026-11-07
- **Cách làm:** kiểm tra rò rỉ trên tune, script `research/ml_leak_test.py`
- **Commit:** `2f0e1c7+dirty`
- **Xem check:** không

## Giả thuyết

Nếu mô hình đoán được nguồn dữ liệu gần như tuyệt đối và nhãn trùng với nguồn, số kiểm định chéo cao chỉ phản ánh khác biệt văn phong.

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Nhãn nguy hiểm trùng với nguồn "chuyển thể" | 95.4% số ca |
| Mô hình đoán đúng nguồn chỉ từ chữ | 90.8% |
| Bỏ ca AI sinh khi huấn luyện, báo nhầm trên chính ca đó | 4/9 |
| Độ dài trung bình theo nguồn (ký tự) | chuyển thể 502, tự viết 925, AI sinh 370 |
| Đặc trưng nặng nhất phía nguy hiểm | có `example`, là tên miền giả của bộ đề |

## Kết luận

Giả thuyết **đúng**. Trong bộ v2, "có nguy hiểm" gần như đồng nghĩa với "lấy từ nguồn chuyển thể", còn "bình thường" gần như đồng nghĩa với "tự viết hoặc AI sinh". Mô hình phân biệt được hai nhóm mà không cần hiểu lừa đảo.

**Hệ quả:** không tin số của mọi mô hình huấn luyện trên bộ này. Số của luật ít bị ảnh hưởng hơn vì luật không học văn phong, nhưng báo nhầm đo trên phần bình thường vẫn thiếu đại diện. Check có cùng lỗi nên không phát hiện được vấn đề này. Việc ưu tiên nhất là tạo cặp đối chứng cùng văn phong, xem [GIAM_HAN_CHE.md](../GIAM_HAN_CHE.md).
