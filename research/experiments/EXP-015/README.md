# EXP-015: Sửa luật theo bộ phát triển của nhóm, vòng 1

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** xem lệnh tái lập
- **Tập:** 4 file trong `research/dataset/nguoiviet_*.csv`, không lên repo: 20 câu đe dọa, 20 câu kịch bản nâng cao, 2 hội thoại nhiều lượt. Kiểm tra thêm trên tune, SMS, hội thoại dài
- **Xem check:** không

**Người viết luật đã đọc cả 4 file. Số trên các file này không phải số đo.** Chỉ các dòng tune, SMS và tình huống cố định dùng để kiểm tra có tụt không.

## Giả thuyết

Luật đang bỏ sót đe dọa, mã độc không có chữ apk, lừa tình kèm đầu tư. Sửa các nhóm này không làm tụt tune, SMS và hội thoại dài.

## Thay đổi

1. Chuẩn hóa: gỡ gạch dưới trong từ, đổi `j` không đứng đầu từ thành `i`.
2. Thêm `threat_physical` (Nghiêm trọng) và `threat_home_visit` (Cao), có bộ lọc câu xã giao và dịch vụ.
3. `malware_apk`: thêm xúi bỏ qua cảnh báo, tải về rồi cài, xưng cán bộ cùng tin với yêu cầu cài. Sửa kẽ hở: "chưa lên CH Play" làm luật tự tắt.
4. Thêm `romance_investment`, mở rộng `investment_scam` và kiểu đòi phí để rút tiền.
5. `task_deposit` không tính nạp tiền trong game và tài khoản xem phim chung.

Sửa thêm một lỗi có sẵn: `isProtectiveWarning` coi câu "bỏ qua cảnh báo" là tin cảnh báo an toàn nên xóa trắng cả tin. Thêm 18 tình huống viết lại bằng câu mới (118–135). Mốc eval cập nhật vì thêm ca.

## Kết quả

| Tập phát triển, đã đọc | Đúng mức | Nguy hiểm dưới Cao | Bình thường từ Cao trở lên |
|---|---:|---:|---:|
| Đe dọa, trước | 8/20 | 8/10 | 1/10 |
| Đe dọa, sau | 13/20 | 2/10 | 0/10 |
| Kịch bản nâng cao, trước | 9/20 | 5/10 | 2/10 |
| Kịch bản nâng cao, sau | 16/20 | 0/10 | 1/10 |
| Hội thoại lừa đảo, trước và sau | 3/6 | 2/5 | 0/1 |
| Hội thoại "nhiễu", trước và sau | 1/5 | không có | 4/5 |

| Kiểm tra tụt | Trước | Sau |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 43/65, 1/31, 3/32 |
| SMS: bình thường Cao+, lừa đảo Cao+ | 3,6%, 33,1% | 3,6%, 33,1% |
| Cuối 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 4/32 | 1/31, 4/32 |
| Đầu 50 tin: bỏ sót, báo nhầm Cao+ | 1/31, 2/32 | 1/31, 2/32 |
| Tình huống cố định | 117/117 | 135/135 |

## Kết luận

**Không tụt, nhưng chưa có bằng chứng cải thiện độc lập.** Tune và SMS không đổi ca nào, nên các thay đổi chỉ có tác dụng trên câu đã đọc. EXP-014 cho thấy lần trước luật đạt 22/22 trên câu tự viết nhưng chỉ 2/10 trên câu người khác viết, nên số 2/10 và 0/10 ở trên chắc chắn lạc quan.

Còn thiếu:

- Hội thoại giả danh cơ quan: lời dọa khóa định danh và chuyển sang Zalo chưa được bắt (T01, T03, T05).
- 2 câu đe dọa che chữ mạnh (A07, A10).
- Hội thoại "nhiễu" có link file apk ngoài kho và hướng dẫn bỏ qua cảnh báo, nhãn ghi bình thường, luật báo Nghiêm trọng. Giữ nguyên luật, cần người viết xem lại nhãn.

## Tái lập

```bash
git checkout $(git log -1 --format=%h -- research/experiments/EXP-015/metrics.json)
```

```bash
npm run bench:rules-dev
```

```bash
npm run bench:long-eval
```
