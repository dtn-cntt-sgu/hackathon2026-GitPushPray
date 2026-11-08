# EXP-011: Luật + gpt-oss-120b mức low

- **Ngày:** 2026-11-07
- **Cách suy luận:** `hybrid-hint`, Groq `openai/gpt-oss-120b`, `reasoning_effort` low, trần 2048 token, prompt `bench-v2`
- **Commit:** `098afb3`
- **Tập:** `set:v2/tune`, 65 ca
- **Xem check:** không

## Giả thuyết

Thêm `gpt-oss-120b` mức low vào luật giảm báo nhầm trên tune mà không tăng bỏ sót.

## Kết quả

| Tune, 65 ca | Chỉ luật | Luật + 120B low |
|---|---:|---:|
| Đúng mức | 66,2% | 55,4% |
| Macro-F1 | 0,499 | 0,504 |
| Bỏ sót nguy hiểm | 1/31 | 1/31 |
| Bắt đúng Nghiêm trọng | 57,1% | 57,1% |
| Báo nhầm bất kỳ mức | 21,9% | 50,0% |
| **Báo nhầm Cao+** | **3/32** | **8/32** |

Vận hành: 65/65 JSON hợp lệ, không lượt nào chạm trần token, không lỗi. Trung bình 1.755 token vào và 507 token ra mỗi lượt, tổng khoảng 147.000 token. Độ trễ p50 2,4 giây, p95 4,0 giây. Có 7 tín hiệu bị loại vì trích dẫn sai và 1 tín hiệu bị loại vì sai cấu trúc.

## Kết luận

**Giả thuyết bị bác trên tune.** Cấu hình này không giảm báo nhầm mà làm tăng: báo nhầm Cao+ từ 3 lên 8 ca, và không bắt thêm được ca nguy hiểm nào. Cũng chưa thể kết luận AI vô ích, vì:

- Luật đã được sửa theo chính tập tune (1/31 bỏ sót), nên AI gần như không còn chỗ để bắt thêm trên tập này. Lợi ích bắt thêm chỉ đo được trên dữ liệu chưa dùng để sửa luật.
- Đây là một model ở một mức suy luận. Chưa so với mức medium và với 20B.
- Nhãn có hạn chế đã nêu ở [EXP-006](../EXP-006/README.md).

Mức low đạt yêu cầu về vận hành. Vấn đề là chất lượng phán đoán trên ca bình thường. Cần đọc 5 ca bị báo nhầm thêm trên tune trước khi sửa prompt. Check chưa xem.

## Tái lập

```bash
git checkout 098afb3
```

```bash
npm run bench:run -- --provider groq --dataset set:v2 --split tune --configs rules,hybrid-hint --models openai/gpt-oss-120b --reasoning-effort low --interval-ms 20000 --run-id <mã mới>
```
