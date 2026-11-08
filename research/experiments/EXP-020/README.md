# EXP-020: Sửa bỏ sót APK ngoài kho, thêm cách rủ đổi kênh

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `93b9e3a+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Sửa ngoại trừ CH Play và thêm cách nói đổi kênh giúp bắt được hai lỗ hổng, không tăng báo nhầm

## Thay đổi

- `malware_apk`: phần ngoại trừ "có trên CH Play" khớp nhầm cả câu "không có trên CH Play" nên cả tin bị bỏ qua. Đã sửa. Thêm "ngoài kho ứng dụng", "không có trên CH Play", "nguồn lạ" vào nhóm dấu hiệu nguy hiểm.
- `channel_migration`: thêm "kết bạn, nhắn tin... trên Telegram" ở khoảng cách xa hơn, và kéo sang Zalo chỉ tính khi có ý nói riêng hoặc chê chỗ hiện tại bất tiện, vì nhắn Zalo rất phổ biến.
- Thêm 7 tình huống (154–160), gồm 3 ca không được đẩy lên.

## Kết quả

| Kiểm tra | Trước | Sau |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 43/65, 1/31, 3/32 |
| SMS: bình thường Cao+, lừa đảo Cao+ | 3,6%, 33,1% | 3,6%, 33,1% |
| Cuối 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 4/32 | 1/31, 4/32 |
| Đầu 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 2/32 | 1/31, 2/32 |
| Tình huống cố định | 153/153 | 160/160 |

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

## Kết luận

**Đạt trên các câu tự viết, chưa có số độc lập.** Hai cách nói bị bỏ sót đã bắt được, tune và SMS không đổi. Các tập này không cho thấy luật giúp thêm, chỉ cho thấy chưa tăng báo nhầm. Kẻ gian đổi cách nói về Zalo vẫn có thể lọt, phần đó để AI xử lý.

## Tái lập

```bash
git checkout 93b9e3a
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-020" --hypothesis "tái lập" --method rules
```
