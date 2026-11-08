# EXP-014: Thử bản nháp luật đe dọa trên bộ câu do thành viên khác viết

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules, thêm 2 luật nháp `threat_physical`, `threat_home_visit` lúc chạy
- **Commit:** `39c9962`, luật nháp không có trong commit này
- **Tập:** 20 câu trong file riêng, không lên repo: 10 câu đe dọa, 10 câu bình thường dễ nhầm
- **Xem check:** không

## Giả thuyết

Bản nháp luật đạt 22/22 câu tự viết sẽ giữ được kết quả trên câu do người khác viết.

## Kết quả

| | Luật hiện tại | Có 2 luật nháp |
|---|---:|---:|
| Câu đe dọa đạt từ Cao trở lên | 2/10 | 2/10 |
| Đạt Nghiêm trọng trên số câu nhãn Nghiêm trọng | 0/6 | 1/6 |
| Câu bình thường bị báo từ Cao trở lên | 1/10 | 2/10 |
| Đúng mức | 8/20 | 8/20 |

Câu đe dọa được nâng mức có 1 câu. Câu bình thường bị nhầm thêm có 1 câu, và rơi vào mức Nghiêm trọng.

## Kết luận

**Giả thuyết bị bác.** Số 22/22 chỉ phản ánh câu do chính người viết luật nghĩ ra. Không thêm 2 luật này.

Đe dọa có quá nhiều cách nói để luật từ khóa phủ được. Có câu đe dọa không dùng từ "đến nhà", có câu cố ý viết tách chữ và thay ký tự. Mức cao của bộ này thuộc về phần AI, nên cần đo AI trên cùng bộ trước khi quyết định.

Giới hạn:

- File không có cột nhóm. Đã giả định 10 câu đầu là đe dọa, 10 câu sau là bình thường, theo thứ tự trong file.
- File được đính kèm vào phiên nên người viết luật đã đọc. Số này còn giá trị vì luật được chốt trước khi đọc (bản nháp mã băm `04f20ac8471b`). Không được sửa luật theo các câu này rồi đo lại trên chính bộ này.
- Mẫu 20 câu, mỗi câu bằng 10% của nhóm.
- Chưa rõ câu có viết hoàn toàn bằng tay hay không.
