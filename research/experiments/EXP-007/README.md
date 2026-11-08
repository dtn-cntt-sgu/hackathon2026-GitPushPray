# EXP-007: Mô hình học trên SMS thật, áp sang hội thoại

- **Ngày:** 2026-11-07
- **Cách suy luận:** TF-IDF ký tự + hồi quy logistic, học trên SMS dev (897 tin)
- **Script:** `research/ml_sms_transfer.py`
- **Xem check:** không. Test SMS không được dùng.

## Giả thuyết

SMS không có lỗi nhãn trùng nguồn như bộ v2 ([EXP-006](../EXP-006/README.md)), nên mô hình học trên SMS có thể phát hiện dấu hiệu thật. Rủi ro: SMS là tin lẻ, nhãn gộp cả quảng cáo, khác miền hội thoại.

## Kết quả

| Đo trên | Bắt được | Báo nhầm |
|---|---:|---:|
| SMS dev, kiểm định chéo | 96,2% | 5,8% |

Áp sang hội thoại tune, chấm từng tin của đối phương rồi lấy tin cao nhất:

| Ngưỡng | Bỏ sót | Báo nhầm |
|---:|---:|---:|
| 0,7 | 0/31 | 28/32 |
| 0,8 | 7/31 | 13/32 |
| 0,9 | 29/31 | 1/32 |

Xác suất trung bình: ca nguy hiểm 0,84, ca bình thường 0,78. Hai nhóm gần như không tách được.

## Kết luận

Giả thuyết **sai với hội thoại**. Mô hình rất tốt trên đúng miền SMS nhưng không chuyển được sang chat: không có ngưỡng nào vừa bắt được vừa ít báo nhầm. Lấy mức cao nhất qua nhiều tin cũng làm báo nhầm tăng, nên phép đo này chưa phải cách tốt nhất để ghép tin, nhưng độ tách quá thấp nên khó cứu. Các repo học trên SMS công khai cũng có thể gặp giới hạn này khi dùng cho hội thoại; mình chưa thử trực tiếp các repo đó.

Không dùng cho hội thoại. Vẫn có thể dùng cho kiểm tra tin lẻ, nếu nhóm cần.

## Tái lập

```bash
python research/ml_sms_transfer.py
```

Seed cố định 20261107. Script từ chối ghi đè nếu đã có kết quả.
