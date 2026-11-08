# EXP-012: Quét ban đầu 50 tin, đánh giá mỗi 2 tin, prompt gọn

- **Ngày:** 2026-11-07
- **Cách suy luận:** đếm offline trên tune, 4 lượt thật `gpt-oss-20b` mức low, prompt `bench-v5`
- **Commit:** `9840674`
- **Tập:** `set:v2/tune`. Hội thoại dài được tạo bằng cách thêm tin của ca bình thường vào trước, không phải dữ liệu thật
- **Xem check:** không

**Chưa đo đủ 65 ca với AI vì hết hạn mức trong ngày. Không dùng để chọn model.**

## Thay đổi

- Khi bấm quét: đọc tin đã có, tự cuộn khung chat để tải tối đa 50 tin rồi trả về vị trí cũ, AI đọc ngay bằng lượt sâu.
- Đánh giá mỗi 2 tin của cả hai phía, phải có ít nhất 1 tin của đối phương. Tin lẻ gọi nốt sau 20 giây. Hai lượt cách nhau tối thiểu 30 giây.
- Gộp phần trùng giữa prompt core và gateway, mỗi tin ghi một dòng, báo chế độ initial hoặc update và mức của luật.

## Giả thuyết

Prompt gọn giảm token mà vẫn trả JSON đúng. Đọc lịch sử dài không làm tăng báo nhầm của luật.

## Kết quả

| Đầu vào | Trước | Sau |
|---|---:|---:|
| Ký tự prompt hệ thống | khoảng 8.500–9.000 | 4.285–4.751 |
| Token vào mỗi lượt | 3.319 (trung bình 48 lượt) | 2.049 và 2.155 (2 lượt) |
| Lượt 50 tin | bị cắt còn 28 tin hoặc bị từ chối | 2.956 và 3.046 token vào (2 lượt), gửi đủ 50 tin |

| Lượt gọi AI trên tune, AI giả | Số lượt |
|---|---:|
| 5 tin của đối phương, gọi nốt sau 60 giây | 116 |
| 2 tin của cả hai phía, gọi nốt sau 20 giây | 354 |

| Chỉ dùng luật | Đúng mức | Bỏ sót | Báo nhầm Cao+ |
|---|---:|---:|---:|
| Ca gốc | 43/65 | 1/31 | 3/32 |
| Đệm lên 30 tin | 36/65 | 1/31 | 7/32 |
| Đệm lên 50 tin | 34/65 | 1/31 | 9/32 |

## Kết luận

**Phần token đạt, phần báo nhầm của luật bị bác.**

- Token vào giảm khoảng 35%. Mới có 4 lượt nên đây chỉ là dấu hiệu.
- Luật đọc càng dài càng báo nhầm nhiều: báo nhầm Cao+ từ 3 lên 9 ca ở 50 tin, bỏ sót không đổi. Luật cộng dồn tín hiệu trên toàn hội thoại, nên các tín hiệu yếu rải rác dễ cộng lại thành Cao. Một phần có thể do cách ghép, vì tin đệm không liên quan đến ca được đệm. Cần hội thoại dài viết tay để đo chắc. Chưa sửa luật, chờ người duyệt.
- Gọi mỗi 2 tin tốn gấp khoảng 3 lần so với lịch cũ.
- Bản đầu của cách ghi tin dùng mã một chữ làm model ghi sai id và nhầm người gửi. Đã đổi sang `msg-012|new|other|...`. Ở 2 lượt 50 tin vẫn có 3 tín hiệu bị loại vì trích dẫn, cần xem khi đo đủ. Các tín hiệu này bị chặn đúng như thiết kế.
- Chưa thử trên Messenger thật: phần tự cuộn chỉ có test với khung chat giả.

## Tái lập

```bash
git checkout 9840674
```

```bash
npm run bench:ai-calls -- --batch 2 --idle 20
```

```bash
npm run bench:run -- --provider groq --dataset set:v2 --split tune --limit 2 --pad-to 50 --configs gateway --models openai/gpt-oss-20b --reasoning-effort low --interval-ms 25000 --run-id <mã mới>
```
