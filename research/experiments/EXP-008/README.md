# EXP-008: Đợt 1: phủ định liệt kê, chiều tiền, giấu gia đình, ứng tiền

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `ca76683+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Các lỗi đọc được từ bộ gợi ý nội bộ là lỗi chung của luật: không hiểu phủ định liệt kê, chiều tiền, lời bảo giấu người thân, ứng tiền trước. Sửa sẽ giảm báo nhầm mà không làm tăng bỏ sót trên tune và SMS.

## Kết quả

Số đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).

| So với EXP-001 | Trước | Sau |
|---|---:|---:|
| Tune: bỏ sót | 1/31 | 1/31 |
| Tune: báo nhầm Cao+ | 3/32 | 3/32 |
| Tune: số ca đổi mức | | 0/65 |
| SMS dev: bình thường Cao+ | 3,6% | 3,6% |
| SMS dev: lừa đảo Cao+ | 33,1% | 33,1% |

Bộ tình huống tăng từ 95 lên 111 ca, gồm các cặp phải bắt và không được bắt, cùng 2 ca né luật. `npm run check` đạt.

Năm thay đổi:

1. Phủ định liệt kê: "không cần A hay B" phủ định cả B, chỉ trong cùng một vế câu.
2. Chiều tiền: không tính "chuyển 100k tiền công", "chuyển khoản lương".
3. `malware_apk` hiểu phủ định: "không cần quyền trợ năng" không tính.
4. Giấu gia đình: thêm mẹ, ba, chú, vợ, chồng và "đừng hỏi ai". Không thêm "cô" vì sau khi bỏ dấu trùng với "có". Chưa thêm "anh", "chị" vì dễ báo nhầm.
5. Thêm "ứng tiền rồi hoàn kèm hoa hồng" và "chuyển STK + số".

## Kết luận

**Giả thuyết chưa được xác nhận.** Không có gì tụt, nhưng tune và SMS cũng không đổi một ca nào, nên không có bằng chứng các thay đổi giảm được báo nhầm trên dữ liệu đã khóa. Bằng chứng duy nhất là các ca thử mới và bộ gợi ý nội bộ dùng để viết luật, cả hai đều không độc lập nên không tính là số đo.

Vẫn giữ các thay đổi vì chúng sửa lỗi đọc sai câu rõ ràng và không gây hại trên phần đo được. Bộ v2 có thể không phát hiện được loại lỗi này vì có ít ca cùng văn phong ([EXP-006](../EXP-006/README.md)). Cần cặp đối chứng viết tay để đo. Không xem check ở lần này.

Nguồn gợi ý là bộ nháp nội bộ do AI hỗ trợ soạn và người sửa. Các ca thử đều viết lại bằng câu mới.

## Tái lập

Trường commit ở trên ghi `ca76683+dirty` vì lúc đo các thay đổi chưa được commit. Để tái lập, checkout commit đã thêm chính thư mục này:

```bash
git checkout $(git log -1 --format=%h -- research/experiments/EXP-008/metrics.json)
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-008" --hypothesis "tái lập" --method rules
```
