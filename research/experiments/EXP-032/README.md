# EXP-032: Vai trò AI mới, bản 1 (nhận định ngữ cảnh, AI cùng luật)

- **Ngày:** 2026-11-08
- **Cách suy luận:** gateway, Groq `openai/gpt-oss-120b`, reasoning low, prompt `bench-v7`
- **Commit:** `f4f412e+dirty` (chạy với `--allow-dirty`, code chưa commit lúc đo)
- **Tập:** set:v2, tune (65 ca)
- **Xem check:** không

## Giả thuyết

Cho AI trả thêm nhận định ngữ cảnh (chuyện đang diễn ra, chiêu, trạng thái nạn nhân, bước tiếp theo, lời cảnh báo), không bỏ tín hiệu AI trùng với luật, và cho AI cùng luật lên Nghiêm trọng khi AI thấy nạn nhân sắp hoặc đã làm theo. Kỳ vọng: bắt thêm ca Nghiêm trọng mà không tăng báo nhầm.

## Thay đổi

- Prompt thêm khối `insight`; `sanitizeInsight` kiểm trích dẫn tin của người dùng, bỏ câu khuyên nguy hiểm.
- Tín hiệu AI cùng loại với luật được gộp thành ghi chú (`ai_note`), khác loại thì thêm mới.
- AI cùng luật: nếu `victim_state` là sắp làm theo hoặc đã làm theo, trích dẫn đúng, và luật đã có tín hiệu thì thêm `ai_victim_compliance` (critical).
- AI một mình nâng mức chỉ cần 1 lần xác nhận (`AI_UPGRADE_CONFIRMATIONS = 1`).
- Gọi AI sớm khi có dấu hiệu nạn nhân sắp làm theo (`urgent`, cách nhau tối thiểu 15 giây).

## Kết quả (tune)

| Cấu hình | Đúng mức | Bỏ sót | Báo nhầm Cao+ | Báo nhầm mọi mức | Bắt đúng Nghiêm trọng |
|---|---:|---:|---:|---:|---:|
| Luật một mình | 48/65 | 1/31 | 3/32 | 6/32 | 20/26 |
| Luật + AI bản 1 | 45/65 | 1/31 | **7/32** | **11/32** | 21/26 |

2/130 dòng lỗi (JSON sai) trong lần chạy; khi AI lỗi thì giữ kết quả luật.

## Kết luận

**Bản 1 không đạt.** AI bắt thêm 1 ca Nghiêm trọng nhưng báo nhầm Cao trở lên tăng từ 3 lên 7 ca bình thường, đúng mức giảm. Nguyên nhân: AI một mình đẩy ca bình thường lên Cao, và điều kiện "luật đã có tín hiệu" quá lỏng. Sửa ở EXP-033.

## Tái lập

Code chưa commit lúc đo nên không tái lập chính xác bằng commit. Lần chạy: `ai-insight-120b`.
