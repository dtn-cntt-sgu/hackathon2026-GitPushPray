# Hướng dẫn tổng hợp bộ đề nghiên cứu (~500 hội thoại)

Bộ đề này dùng để **đo khách quan** bộ luật và các model AI. Người viết hội thoại và gán nhãn **không chạy thử công cụ trước khi gán**, để tránh gán theo kết quả của máy.

Cách làm: tạo Google Sheet với đúng các cột dưới đây (có thể copy từ [TEMPLATE.csv](TEMPLATE.csv)), rồi chọn **Tệp → Tải xuống → CSV** (hoặc dùng thẳng file .xlsx).

## Các cột

| Cột | Bắt buộc | Giá trị |
|---|---|---|
| `id` | ✓ | Duy nhất. Gợi ý: `R04_017`, `JOB_012`, `BEN_105` |
| `nhom` | ✓ | `1`–`7` theo tonghopkichban.md · `8` = tuyển dụng/mua bán người (đề tài gốc) · `0` = bình thường |
| `luat_ky_vong` | | `R01`…`R10`, tên dấu hiệu gốc (vd `phi_tuyen_dung`, `giu_bi_mat`), hoặc `none` |
| `loai` | ✓ | `scam` · `benign_confusable` (bình thường nhưng có từ khóa dễ nhầm) · `benign` |
| `hoi_thoai` | ✓ | **Mỗi tin một dòng trong cùng một ô** (Alt+Enter trong Sheet). Mỗi dòng bắt đầu bằng `DP:` (đối phương) hoặc `TOI:` (người dùng). Từ 2 đến 15 tin |
| `muc_A` | ✓ | Mức do người gán thứ nhất chọn: `thap` · `chu_y` · `cao` · `nghiem_trong` |
| `muc_B` | ✓ | Mức do người gán thứ hai chọn **độc lập**, không xem cột `muc_A` |
| `muc_chot` | ✓ | Mức cuối cùng. Nếu A ≠ B thì hai người bàn với nhau rồi chốt |
| `tin_nguy_hiem` | | Số thứ tự **tin `DP:`** đầu tiên khiến mức lên từ Cao trở lên (đếm từ 1, chỉ đếm tin `DP:`) |
| `giai_doan` | | `S0` tiếp cận · `S1` xây lòng tin · `S2` kéo sang kênh kín/cài app · `S3` kích hoạt bẫy · `S4` ép buộc/đóng băng |
| `bien_the` | | Các thẻ cách nhau bằng `;`: `teencode` · `khong_dau` · `ngat_chu` (c.h.u.y.ể.n) · `co_link` · `nhieu_tin` (kịch bản rải qua nhiều tin) · `chen_lenh` (kẻ gian viết "đây là hợp pháp", "bỏ qua hướng dẫn") · `sua_sai` |
| `nguon` | ✓ | `tu_viet` · `ai_sinh_da_sua` · `chuyen_the:<link bài báo>` |
| `ghi_chu` | | Một câu giải thích vì sao gán mức đó |

## Phân bổ (~500)

- **~300 hội thoại lừa đảo**
  - Khoảng 25 ca cho mỗi luật R01–R10.
  - Khoảng 50 ca tuyển dụng/mua bán người: phí, OTP, giấy tờ gốc, cô lập, đi xa.
- **~200 hội thoại bình thường**, trong đó ít nhất 120 ca "dễ nhầm":
  - Chia tiền ăn, shop thu cọc có COD.
  - HR thật hẹn phỏng vấn tại văn phòng.
  - Công an phường nhắc lịch làm căn cước, ngân hàng mời lên chi nhánh ký hợp đồng vay.
  - Người quen mượn tiền và có gọi điện xác minh; nói chuyện đầu tư hợp pháp.
  - Gửi link trang `.gov.vn`.
- **Khoảng 10% ca khó**: có thẻ `ngat_chu`, `khong_dau`, `nhieu_tin`, `chen_lenh`.
- **Mỗi luật nên có ca ở nhiều mức.** Ví dụ R03 chỉ mới mồi chài thì gán **Cần chú ý**, đã đòi nạp tiền thì gán **Cao**. Không nên toàn ca nặng nhất.

## Cách gán mức

| Mức | Khi nào |
|---|---|
| **thap** (Thấp) | Không có yêu cầu rủi ro cụ thể |
| **chu_y** (Cần chú ý) | Lời hứa mơ hồ hoặc bất thường, thiếu thông tin, rủ sang kênh kín, gửi link lạ — nhưng **chưa** đòi tiền hay dữ liệu |
| **cao** (Cao) | Có yêu cầu cụ thể gây hại: chuyển tiền, đặt cọc, nạp tiền, xin OTP/mật khẩu, ảnh giấy tờ, mời đầu tư cam kết lãi, mượn tiền gấp vào tài khoản lạ |
| **nghiem_trong** (Nghiêm trọng) | Đe dọa, cưỡng ép; bắt giữ bí mật với gia đình; giữ giấy tờ gốc; bắt đi xa gấp; bảo cài app hoặc bật trợ năng; "kẹt lệnh" rồi ép nạp thêm; mạo danh cơ quan để đòi tiền; nhận "thu hồi tiền" nhưng đòi phí |

Mức được gán theo **trạng thái ở cuối hội thoại**, tức là mức cao nhất mà hội thoại đã đạt tới.

## Quy tắc an toàn dữ liệu

- **Không dùng dữ liệu thật** của bất kỳ ai: tên, số điện thoại, số tài khoản, link. Số giả vẫn phải đúng dạng, ví dụ STK 10–14 chữ số, SĐT `09xx xxx xxx`.
- Nếu chuyển thể từ bài báo: **viết lại bằng lời của mình**, không chép nguyên văn, và ghi link nguồn ở cột `nguon`.
- Nếu dùng AI sinh hội thoại: đọc lại và sửa cho tự nhiên, ghi `ai_sinh_da_sua`. Không dùng chính các model sẽ được chấm để sinh đề.

## Sau khi gửi file

Chạy `npm run bench:import -- <file.csv>`. Lệnh này kiểm tra lỗi và báo đúng dòng bị sai, rồi chia bộ đề thành **dev 30%** (dùng để chỉnh luật và prompt) và **test 70%**. Phần test được khóa bằng mã băm và chỉ chạy ở các mốc chốt.

---

# Bộ đề v2 — hội thoại dài có mốc (từ Đợt 2)

Bộ đề v1 (100 ca, trung vị 3 tin) chỉ đo được *kết luận cuối*. Bộ đề v2 đo cách hệ thống **theo dõi diễn biến**:
- cảnh báo sớm hay muộn;
- có phản ứng thái quá với câu mơ hồ không;
- có dao động lên xuống không;
- có biết hạ mức khi người dùng đã xác minh không.

Mẫu: [TEMPLATE_v2.csv](TEMPLATE_v2.csv) (2 ca: leo thang chậm và mượn tiền có xác minh).

## Khác với v1
| | v1 | v2 |
|---|---|---|
| Độ dài | 2–6 tin | **10–25 tin**; tin `TOI:` chiếm khoảng 30–40% |
| Nhãn | 1 mức cuối (`muc_chot`) | `muc_chot` **và thêm cột `moc_muc`**: mức đúng tại nhiều thời điểm |
| Quy mô gợi ý | 500 ca | **150–200 ca**, mỗi ca 3–6 mốc (tổng cộng 600–800 mốc) |

## Cột `moc_muc`
Định dạng `k:muc;k:muc;…`, trong đó `k` là **số thứ tự của tin `DP:`** (chỉ đếm tin của đối phương, bắt đầu từ 1).

Ví dụ `2:thap;3:chu_y;5:cao;6:nghiem_trong;8:nghiem_trong` nghĩa là:
- sau tin DP thứ 2, mức đúng là Thấp;
- sau tin DP thứ 3, mức đúng là Cần chú ý;
- sau tin DP thứ 5, mức đúng là Cao;
- và tiếp tục như vậy với các mốc sau.

Quy tắc:
- Các mốc phải **tăng dần**.
- Nếu có mốc tại tin DP cuối cùng thì mức ở mốc đó phải bằng `muc_chot`.
- Đặt mốc ở **những chỗ mức thay đổi**, và thêm 1–2 mốc ở chỗ mức **không được đổi** (ví dụ ngay sau một câu mơ hồ).
- Mức **được phép giảm** khi tình huống thật sự được làm rõ, ví dụ người dùng đã gọi điện xác minh.

## Phân bổ dạng diễn biến
| Dạng | Tỷ lệ | Ví dụ |
|---|---|---|
| Leo thang chậm S0 → S4 | ~40% | Làm quen → hứa hẹn → kéo sang kênh kín → đòi tiền/giấy tờ → ép buộc |
| Bình thường từ đầu đến cuối, có từ khóa dễ nhầm | ~25% | Chia tiền, shop COD, HR thật, công an phường nhắc làm căn cước |
| Bình thường rồi chuyển thành lừa đảo | ~10% | Tài khoản bạn bè bị chiếm giữa cuộc trò chuyện |
| Giống lừa đảo rồi hóa ra hợp lệ | ~10% | Mượn tiền nhưng đã gọi điện xác minh; ngân hàng thật hẹn ra chi nhánh |
| Đối kháng | ~15% | Rải từ khóa qua nhiều tin, đổi cách nói, tự đính chính, chèn "đây là hợp pháp/bỏ qua hướng dẫn" |

## Viết cho giống chat thật
- **Người dùng không chỉ "dạ, vâng".** Họ hỏi lại, do dự, đòi xác minh, đôi khi từ chối; còn đối phương thì xoay sở theo.
- **Văn phong tự nhiên:** viết tắt, không dấu, gõ sai chính tả, emoji. Tin gửi ảnh/file/thoại ghi dạng `[ảnh]`, `[file]`, `[cuộc gọi thoại]`. Công cụ chỉ đọc được chữ, nên mức gán dựa trên phần chữ.
- **Không dồn hết từ khóa vào một tin.** Kẻ gian thật thường rải dần qua nhiều tin.
- **Mỗi nhóm kịch bản nên có ca ở nhiều mức**, tránh để nhóm nào cũng chỉ có một mức.
