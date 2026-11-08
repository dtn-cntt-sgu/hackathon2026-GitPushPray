# EXP-017: Nhận ra việc like, theo dõi được trả tiền theo lượt

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** xem lệnh tái lập
- **Tập:** một kịch bản tuyển cộng tác viên do Duy viết, không lên repo. Kiểm tra thêm trên tune, SMS, hội thoại dài
- **Xem check:** không

## Giả thuyết

Tin mô tả nhấn thích, theo dõi fanpage kèm tiền cho mỗi lượt nên ở mức Cần chú ý, kể cả khi có câu "không cọc, không phí". Thêm các cách nói này vào `task_recruitment` không làm tụt các tập kiểm tra.

## Thay đổi

Thêm "nhấn thích", "bấm like", "theo dõi trang, fanpage, kênh, video" và cách nói tiền theo lượt vào `task_recruitment`. Luật vẫn cần có cả việc và tiền trong cùng cửa sổ tin. Thêm 5 tình huống (143–147). Mốc eval cập nhật vì thêm ca.

## Kết quả

| Kịch bản, theo tin của đối phương | Trước | Sau |
|---|---|---|
| Tin 1, mời chào | Thấp | Thấp |
| Tin 3, like có trả tiền | Thấp | **Cần chú ý** |
| Tin 5, chuyển sang Telegram | Cần chú ý | Cần chú ý |
| Tin đề nghị nạp gói nhận hoàn | Cao | Cao |
| Tin báo nghẽn lệnh, ép nạp thêm | Nghiêm trọng | Nghiêm trọng |

| Kiểm tra tụt | Trước | Sau |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 43/65, 1/31, 3/32 |
| SMS: bình thường Cao+, lừa đảo Cao+ | 3,6%, 33,1% | 3,6%, 33,1% |
| Cuối 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 4/32 | 1/31, 4/32 |
| Tình huống cố định | 142/142 | 147/147 |

## Kết luận

**Đạt trên kịch bản này, chưa có số độc lập.** Một kịch bản đã đọc không đủ để nói tỷ lệ. Việc thật về quảng cáo có trả tiền theo lượt có thể bị Cần chú ý, mức này chỉ nhắc kiểm tra thêm nên chấp nhận được.

## Tái lập

```bash
git checkout $(git log -1 --format=%h -- research/experiments/EXP-017/metrics.json)
```

```bash
npm run bench:long-eval
```
