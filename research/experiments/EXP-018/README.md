# EXP-018: Gợi ý Hỏi thử theo diễn biến và bước tiếp theo của AI

- **Ngày:** 2026-11-07
- **Cách suy luận:** luật cho lớp 1, luật và AI cho lớp 2
- **Commit:** xem lệnh tái lập
- **Tập:** 11 kịch bản tự viết trong `research/next-step-trial.ts`, không dùng dữ liệu nhóm hay chat thật
- **Xem check:** không

## Giả thuyết

Phản hồi khi dùng thử: người dùng đã hỏi theo gợi ý nhưng câu "Hỏi thử" đứng yên. Câu hỏi nên đổi theo diễn biến. AI có thể gợi ý câu tiếp theo bám ngữ cảnh, miễn là tin cài lệnh không lợi dụng được đường này.

## Thay đổi

**Lớp 1, không cần AI.** Câu hỏi xếp theo tín hiệu mới nhất, bỏ câu người dùng đã hỏi kể cả khi hỏi bằng lời khác, tạm ẩn khi người dùng vừa hỏi và đang chờ trả lời. Nghiêm trọng vẫn tắt câu hỏi. Mức và điểm không đổi.

**Lớp 2, AI.** Thêm `next_step` vào prompt. Câu gợi ý đi qua `sanitizeNextStep` ở gateway và kiểm tra lại ở client: loại link, số dài, số tiền, mã bí mật, câu khiến người dùng tự chuyển tiền, cài ứng dụng, cung cấp giấy tờ, và câu sai vai. Đánh giá câu trả lời phải có trích dẫn khớp tin của đối phương. AI lỗi hoặc câu bị loại thì dùng gợi ý theo luật. Phần này không đổi mức và điểm.

## Kết quả thử thật

Cả 2 model hết hạn mức ngày giữa lượt nên kết quả không đủ. Đây là thử nhanh, không phải số đo.

| Lượt | Model | Đã chạy | Ghi nhận |
|---|---|---:|---|
| Prompt đầu | 20B, low | 8/8 | Câu hỏi gần như giống nhau ở mọi ca, xưng hô sai, không nhận ra né tránh hay mâu thuẫn. 2 ca cài lệnh: không chép câu độc |
| Prompt đầu | 120B, low | 3/8 | Xưng hô đúng, câu vẫn chung chung, ca mâu thuẫn bị đánh giá "đã trả lời" |
| Sửa prompt | 20B, low | 6/11 | Ca mâu thuẫn có câu bám sát nhưng gần như chép ví dụ trong prompt, nên không tính là bằng chứng. Ca rủ sang Telegram vẫn hỏi tên công ty. Ca đang chờ bị đánh giá "đã trả lời". Ca bình thường đúng, không hỏi gì |

Chưa chạy được ở prompt đã sửa: 3 ca khác ví dụ và 2 ca cài lệnh. Đánh giá "né tránh" và "mâu thuẫn" chưa lần nào đúng trên model thật.

Token vào 2.001–2.244, tăng khoảng 7% ở vòng sửa prompt. Token ra 141–637.

## Quyết định theo kết quả

- Dấu hiệu vừa xuất hiện dùng câu luật trước. Câu AI lấp chỗ luật đã hết câu để hỏi, không đè lên câu luật.
- Không hiện đánh giá "đã trả lời" vì sai cả 3 lần và dễ khiến người dùng yên tâm sai.
- Thêm kiểm tra sai vai vì model hay viết "Em có thể cho biết...".

## Kết luận

**Lớp 1 đạt theo test, chưa thử trên Messenger thật. Lớp 2 chưa đạt về chất lượng:** chốt chặn hoạt động, nhưng câu của AI chưa bám diễn biến và đánh giá câu trả lời chưa dùng được. Chưa đủ số để khẳng định AI có ích hơn luật ở phần này. Việc còn lại khi có hạn mức: chạy đủ 11 ca cho cả 2 model.

## Tái lập

```bash
npm run bench:next-step -- --model openai/gpt-oss-20b --reasoning-effort low --run-id ns-20b-v2
npm run bench:next-step -- --model openai/gpt-oss-120b --reasoning-effort low --run-id ns-120b-v2
```
