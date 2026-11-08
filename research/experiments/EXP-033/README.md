# EXP-033: AI cùng luật, giới hạn theo mức luật (bản 2)

- **Ngày:** 2026-11-08
- **Cách suy luận:** gateway, Groq `openai/gpt-oss-120b`, reasoning low, prompt `bench-v7` (cùng prompt với EXP-032, đo lại từ cache, không tốn lượt gọi)
- **Commit:** `f4f412e+dirty` (chạy với `--allow-dirty`)
- **Tập:** set:v2, tune (65 ca)
- **Xem check:** không

## Giả thuyết

Giới hạn AI theo mức của luật kéo báo nhầm Cao+ về như luật một mình mà vẫn giữ phần bắt thêm ca Nghiêm trọng của EXP-032.

## Thay đổi so với EXP-032

- Luật ở mức Thấp: tín hiệu AI tối đa Cần chú ý (medium).
- Luật từ Cần chú ý trở lên: tín hiệu AI tối đa Cao, không bao giờ critical.
- `ai_victim_compliance` (lên Nghiêm trọng) chỉ khi luật đã có tín hiệu mức Cao trở lên thuộc nhóm nguy hiểm (tài chính, tài khoản, kỹ thuật, mạo danh), không tính tín hiệu hạ mức.

## Kết quả (tune)

| Cấu hình | Đúng mức | Bỏ sót | Báo nhầm Cao+ | Báo nhầm mọi mức | Bắt đúng Nghiêm trọng |
|---|---:|---:|---:|---:|---:|
| Luật một mình | 48/65 | 1/31 | 3/32 | 6/32 | 20/26 |
| Luật + AI bản 1 (EXP-032) | 45/65 | 1/31 | 7/32 | 11/32 | 21/26 |
| Luật + AI bản 2 | 45/65 | 1/31 | 3/32 | **11/32** | 21/26 |

So từng ca với luật một mình:

- Tốt hơn (2): V2_S06 Thấp → Cần chú ý (đúng nhãn); V2_S31 Cao → Nghiêm trọng (đúng nhãn, nạn nhân sắp làm theo).
- Tệ hơn (6): V2_C01, V2_C04, V2_BT_05, V2_BT_31, V2_BT_33 từ Thấp lên Cần chú ý (ca bình thường); V2_BT_07 luật đã báo nhầm Cao, AI đẩy lên Nghiêm trọng.
- AI không hạ đúng ca nào.

## Kết luận

**Báo nhầm Cao+ đã về bằng luật (3/32), nhưng đúng mức vẫn kém luật một mình (45 so với 48).** AI vẫn đẩy 5 ca bình thường lên Cần chú ý và đẩy 1 ca đã báo nhầm lên Nghiêm trọng. Phần có ích rõ nhất của AI ở bản này là lời nhận định và bước tiếp theo hiển thị cho người dùng, chưa phải mức cảnh báo. Đây là số tune (dev), không phải số test. **Duy chọn giữ bản 2 (2026-11-08):** chấp nhận thêm báo nhầm ở mức Cần chú ý để AI còn nâng được ca luật bỏ qua như V2_S06. Phương án "luật Thấp thì AI chỉ hiện nhận định" không được chọn.

## Tái lập

Code chưa commit lúc đo. Lần chạy: `ai-insight-120b-v2`.
