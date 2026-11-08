# EXP-010: Chạy thử Groq 2 ca: model dùng được, token, reasoning_effort

- **Ngày:** 2026-11-07
- **Cách suy luận:** cấu hình `ai`, Groq, trần 2048 token, prompt `bench-v2`
- **Commit:** `309ab2d`, công cụ đo đang sửa dở (chưa commit `run.ts`, `providers/openrouter.ts`)
- **Tập:** 2 ca đầu của `set:v2/tune`, cả hai có nhãn Cao
- **Xem check:** không

**Đây là chạy thử để kiểm tra công cụ. 2 ca không đủ để so chất lượng hay chọn model.**

## Giả thuyết

`reasoning_effort` mức `low` giảm token ra và giảm lỗi JSON so với `medium`.

## Kết quả

**Model:** khóa của nhóm không dùng được `llama-3.1-8b-instant` (404 `model_not_found`). Danh sách model cũng không có `llama-3.3-70b-versatile`. Có `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`.

**Hạn mức đọc từ header:** 1.000 lượt/ngày, 8.000 token/phút. Header không cho biết hạn mức token/ngày.

| Model, mức | Token ra | Token suy luận | Độ trễ | Lỗi | Tín hiệu bị loại vì trích dẫn sai |
|---|---:|---:|---:|---|---:|
| 20B, medium | 2048, 1786 | 1718, 1172 | 3,3–3,9 s | 1 lượt chạm trần, thiếu `risk_level` | 0 |
| 120B, medium | 1336, 1976 | 756, 1310 | 4,1–5,4 s | Không | 0 |
| 20B, low | 487, 729 | 53, 78 | 1,2–1,6 s | Không | **3** |
| 120B, low | 747, 506 | 70, 88 | 1,7–2,4 s | Không | 0 |

Token vào là 1678 và 1803. Ở lần chạy không đặt mức, 20B bị Groq từ chối JSON 1/2 lượt, còn token ra của cả hai model tương tự `medium`. Lần đó chưa lưu lý do từ chối.

## Kết luận

**Giả thuyết đúng về token trên mẫu rất nhỏ:** `low` giảm token ra khoảng 44–76% và không lượt nào lỗi. Mỗi lượt còn khoảng 2.150–2.550 token, nên chạy được khoảng 3 lượt/phút thay vì 2.

**Chưa biết `low` có làm giảm chất lượng không:** 120B ở `low` ra ít tín hiệu hơn (3 và 1, so với 4 và 4), còn 20B có 3 tín hiệu bị loại vì trích dẫn không khớp tin gốc. Cả hai đều cần đo trên đủ tune.

Ở mức `medium`, trần 2048 token không đủ cho 20B: phần suy luận chiếm gần hết, nên phản hồi có thể thiếu `risk_level` dù vẫn là JSON hợp lệ. Vì vậy chỉ số "JSON hợp lệ" không đủ, phải xem thêm số dòng lỗi và `finishReason` trong file raw.

Kết quả thô nằm ở `research/results/groq_thu*`, không lên repo.

## Tái lập

```bash
npm run bench:run -- --provider groq --dataset set:v2 --split tune --limit 2 --configs ai --models openai/gpt-oss-20b,openai/gpt-oss-120b --interval-ms 30000 --reasoning-effort low --run-id groq_thu_low
```
