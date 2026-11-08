# Sổ thí nghiệm

Tự sinh bằng `npm run bench:experiment -- --ledger`. Không sửa tay. Cách đọc và quy tắc ở [README.md](README.md).

`Cao+` là cảnh báo từ mức Cao trở lên. `Bỏ sót` là ca nhãn từ Cao trở lên bị chấm dưới Cao. Mọi số là số dev.

| Mã | Nội dung | Cách suy luận | Commit | Tune: bỏ sót | Tune: báo nhầm Cao+ | Check: bỏ sót | Check: báo nhầm Cao+ | SMS BT Cao+ | SMS LĐ Cao+ | Lần xem check (cộng dồn) |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| [EXP-000](EXP-000/README.md) | Mốc bộ luật trước khi sửa | rules | `e420e93` | 35.5% (11/31) | 21.9% (7/32) | 52.6% (10/19) | – (chưa tách) | 3.6% | 31.0% | 1 |
| [EXP-001](EXP-001/README.md) | 10 đề xuất từ phân tích lỗi trên tune | rules | `2f0e1c7+dirty` | 3.2% (1/31) | 9.4% (3/32) | 52.6% (10/19) | 10.0% (2/20) | 3.6% | 33.1% | 2 |
| [EXP-002](EXP-002/README.md) | Khung ý định thay cho mẫu câu | frames (frames-v1) | `2f0e1c7+dirty` | 29.0% (9/31) | 25.0% (8/32) | chưa xem | chưa xem | 4.9% | 2.5% | 2 |
| [EXP-003](EXP-003/README.md) | Luật kết hợp khung ý định | rules+frames (frames-v1) | `2f0e1c7+dirty` | 3.2% (1/31) | 28.1% (9/32) | chưa xem | chưa xem | 8.2% | 33.1% | 2 |
| [EXP-004](EXP-004/README.md) | Mô hình học từ dữ liệu, không dùng luật | ML ký tự TF-IDF + hồi quy logistic | `2f0e1c7+dirty` | 6.5% (2/31) | 3.1% (1/32) | chưa xem | chưa xem | 38.3% | 66.1% | 2 |
| [EXP-005](EXP-005/README.md) | Luật HOẶC mô hình học máy | ML ký tự TF-IDF + hồi quy logistic HOẶC luật EXP-001 | `2f0e1c7+dirty` | 0.0% (0/31) | 12.5% (4/32) | chưa xem | chưa xem | 38.3% | 66.1% | 2 |
| [EXP-006](EXP-006/README.md) | Kiểm tra mô hình học văn phong hay học dấu hiệu | Kiểm tra rò rỉ trên tune | `2f0e1c7+dirty` | – (–) | – (–) | chưa xem | chưa xem | – | – | 2 |
| [EXP-007](EXP-007/README.md) | Mô hình học trên SMS thật, áp sang hội thoại | ML ký tự TF-IDF + hồi quy logistic, học trên SMS dev | `ca76683` | 0.0% (0/31) | 100.0% (32/32) | chưa xem | chưa xem | 5.8% | 96.2% | 2 |
| [EXP-008](EXP-008/README.md) | Đợt 1: phủ định liệt kê, chiều tiền, giấu gia đình, ứng tiền | rules | `ca76683+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-009](EXP-009/README.md) | Gom đủ 5 tin mới gọi AI một lần, gọi nốt tin lẻ khi dừng 60 giây | đếm lượt gọi bằng AI giả, không gọi mạng | `a7abe92+dirty` | – (–) | – (–) | chưa xem | chưa xem | – | – | 2 |
| [EXP-010](EXP-010/README.md) | Chạy thử Groq 2 ca: model dùng được, token, reasoning_effort | ai, groq, 2 ca tune, trần 2048 token, prompt bench-v2 | `309ab2d` | – (–) | – (–) | chưa xem | chưa xem | – | – | 2 |
| [EXP-011](EXP-011/README.md) | Luật + gpt-oss-120b mức low | hybrid-hint, groq openai/gpt-oss-120b (reasoning low), prompt bench-v2 | `098afb3` | 3.2% (1/31) | 25.0% (8/32) | chưa xem | chưa xem | – | – | 2 |
| [EXP-012](EXP-012/README.md) | Quét ban đầu 50 tin, đánh giá mỗi 2 tin, prompt gọn: kiểm tra offline và 4 lượt thật | đếm offline trên tune, 4 lượt thật gpt-oss-20b mức low, prompt bench-v5 | `9840674` | – (–) | – (–) | chưa xem | chưa xem | – | – | 2 |
| [EXP-013](EXP-013/README.md) | Xét ngữ cảnh đời thường trong ±4 tin quanh bằng chứng | rules, tune và ca đệm 30, 50 tin | `xem-git-log` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | – | – | 2 |
| [EXP-014](EXP-014/README.md) | Thử bản nháp luật đe dọa trên bộ câu do thành viên khác viết | rules + 2 luật nháp lúc chạy, 20 câu ngoài repo | `39c9962` | – (–) | – (–) | chưa xem | chưa xem | – | – | 2 |
| [EXP-015](EXP-015/README.md) | Sửa luật theo bộ phát triển của nhóm, vòng 1 | rules | `xem-git-log` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-016](EXP-016/README.md) | Sửa luật vòng 2, giả danh cán bộ hành chính | rules | `xem-git-log` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-017](EXP-017/README.md) | Nhận ra việc like, theo dõi được trả tiền theo lượt | rules | `xem-git-log` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-018](EXP-018/README.md) | Gợi ý Hỏi thử theo diễn biến và bước tiếp theo của AI | rules+ai | `xem-git-log` | – (–) | – (–) | chưa xem | chưa xem | – | – | 2 |
| [EXP-019](EXP-019/README.md) | Xin OTP kèm tự xưng ngân hàng hoặc dọa khóa | rules | `93b9e3a+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-020](EXP-020/README.md) | Sửa bỏ sót APK ngoài kho, thêm cách rủ đổi kênh | rules | `93b9e3a+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-021](EXP-021/README.md) | Cảnh báo đòi tiền theo từ ngữ và ngữ cảnh, bỏ ngưỡng số tiền | rules | `49e9962+dirty` | 3.2% (1/31) | 12.5% (4/32) | chưa xem | chưa xem | 3.6% | 33.5% | 2 |
| [EXP-022](EXP-022/README.md) | Siết từ khóa đòi tiền sau lần đo EXP-021 | rules | `49e9962+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-023](EXP-023/README.md) | Cảnh báo đòi tiền theo ngữ cảnh, bản chốt | rules | `49e9962+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 3.6% | 33.1% | 2 |
| [EXP-024](EXP-024/README.md) | Phân tích link trên máy, ghép ngữ cảnh, nhận biết người dùng đã làm theo | rules | `a7e518c+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.1% | 33.9% | 2 |
| [EXP-025](EXP-025/README.md) | Tách đuôi tên miền bị lạm dụng khỏi đuôi phổ biến | rules | `a7e518c+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.1% | 33.9% | 2 |
| [EXP-026](EXP-026/README.md) | Phân tích link trên máy, bản chốt | rules | `a7e518c+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.0% | 33.9% | 2 |
| [EXP-027](EXP-027/README.md) | Đọc mã QR trong ảnh ngay trên máy | rules | `91b5ca0+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.0% | 33.9% | 2 |
| [EXP-028](EXP-028/README.md) | Giữ bằng chứng khi gộp nạp tiền vào kẹt lệnh | rules | `0360ea5+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.0% | 33.9% | 2 |
| [EXP-029](EXP-029/README.md) | Trục nạn nhân, dấu hiệu giai đoạn cuối, phát hiện vòng vo | rules | `0360ea5+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.0% | 33.9% | 2 |
| [EXP-030](EXP-030/README.md) | Trục nạn nhân, bản sửa báo nhầm mã mẫu | rules | `0360ea5+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.0% | 33.9% | 2 |
| [EXP-031](EXP-031/README.md) | Đổi nhãn chốt 5 ca tune theo trục nạn nhân | rules | `0360ea5+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | 4.0% | 33.9% | 2 |
| [EXP-032](EXP-032/README.md) | Vai trò AI mới: nhận định ngữ cảnh, AI cùng luật | gateway, groq openai/gpt-oss-120b (reasoning low), prompt bench-v7 | `f4f412e+dirty` | 3.2% (1/31) | 21.9% (7/32) | chưa xem | chưa xem | – | – | 2 |
| [EXP-033](EXP-033/README.md) | AI cùng luật, giới hạn theo mức luật | gateway, groq openai/gpt-oss-120b (reasoning low), prompt bench-v7 | `f4f412e+dirty` | 3.2% (1/31) | 9.4% (3/32) | chưa xem | chưa xem | – | – | 2 |
