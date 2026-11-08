# EXP-031: Đổi nhãn chốt 5 ca tune theo trục nạn nhân

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `0360ea5+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Sau khi Duy duyệt đổi nhãn 5 ca từ Cao lên Nghiêm trọng, đúng mức trên tune tăng mà không đổi luật

## Thay đổi

Không đổi luật. Duy duyệt ngày 2026-11-08 đổi nhãn chốt của 5 ca thuộc tune từ Cao lên Nghiêm trọng: V2_S19, V2_S37, V2_S44, TT_CTV_005, TT_CTV_007. Lý do: nạn nhân đã chuyển hoặc sắp chuyển tiền, hoặc bị mồi rồi đòi tiếp, nên theo quy tắc ở EXP-029 là Nghiêm trọng. Chi tiết ở [label_changes.md](../label_changes.md).

Chỉ đổi nhãn chốt. Nhãn của hai người gán ban đầu giữ nguyên (V2_S44: người B đã gán Nghiêm trọng từ trước). Không ca nào thuộc bộ check, không đụng `test.lock`.

## Kết quả

| Kiểm tra | EXP-030 | EXP-031 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 43/65, 1/31, 3/32 | 48/65, 1/31, 3/32 |
| Tune: bắt đúng ca Nghiêm trọng | 15/21 | 20/26 |
| 50 tin ở đầu: đúng mức, báo nhầm Cao+ | 43/65, 2/32 | 48/65, 2/32 |

## Kết luận

**Số tăng do đổi nhãn, không phải do luật tốt hơn.** Không được trình bày mức tăng từ 43 lên 48 như cải thiện của bộ luật. Nhãn mới phản ánh quy tắc của nhóm; vẫn nên nhờ một người chưa viết luật xem lại 5 ca này bằng phiếu gán nhãn độc lập.

## Tái lập

```bash
git checkout 0360ea5
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-031" --hypothesis "tái lập" --method rules
```
