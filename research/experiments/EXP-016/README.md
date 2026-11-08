# EXP-016: Sửa luật vòng 2, giả danh cán bộ hành chính

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** xem lệnh tái lập
- **Tập:** hội thoại trong bộ phát triển ngoài repo, kiểm tra thêm trên tune, SMS, hội thoại dài
- **Xem check:** không

**Bộ phát triển đã được đọc khi viết luật. Số trên đó không phải số đo.**

## Giả thuyết

Luật chưa bắt được kiểu giả cán bộ hành chính dọa khóa định danh rồi dẫn sang Zalo. Thêm luật riêng, loại trừ trường hợp mời ra trụ sở, không làm tụt các tập kiểm tra.

## Thay đổi

- `gov_id_claim` (Cần chú ý): nhắn báo hồ sơ định danh hoặc căn cước bị lỗi.
- `gov_id_pressure` (Cao): dọa khóa định danh, mất quyền làm giấy tờ, hoặc dẫn sang Zalo gặp cán bộ làm từ xa.
- Cả hai bỏ qua câu mời ra phường, xã, trụ sở. "Không cần ra phường" vẫn bị tính.
- Thêm 7 tình huống (136–142). Mốc eval cập nhật vì thêm ca.

## Kết quả

| | Trước | Sau |
|---|---:|---:|
| Hội thoại giả danh, đúng mức theo lượt (đã đọc) | 3/6 | 6/6 |
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 43/65, 1/31, 3/32 |
| SMS: bình thường Cao+, lừa đảo Cao+ | 3,6%, 33,1% | 3,6%, 33,1% |
| Cuối 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 4/32 | 1/31, 4/32 |
| Đầu 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 2/32 | 1/31, 2/32 |
| Tình huống cố định | 135/135 | 142/142 |

Luật mới khớp 1 tin trong SMS dev và không đổi tỷ lệ.

## Kết luận

**Không tụt, chưa có bằng chứng độc lập.** Số 6/6 chỉ trên một hội thoại đã đọc. Tune và SMS không có ca kiểu này nên không đo được lợi ích. Cần bộ mới do người khác viết.

Điểm yếu đã biết: kẻ gian nói "cứ ra phường" rồi vẫn lừa ở bước khác thì 2 luật này không chạy, phải trông vào các luật khác và AI.

## Tái lập

```bash
git checkout $(git log -1 --format=%h -- research/experiments/EXP-016/metrics.json)
```

```bash
npm run bench:rules-dev
```
