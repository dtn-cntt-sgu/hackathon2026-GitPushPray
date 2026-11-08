# Nghiên cứu: bộ luật vs model AI miễn phí

> Người chạy model: đọc [HUONG_DAN_CHAY_MODEL.md](HUONG_DAN_CHAY_MODEL.md) trước (cài đặt, lấy bộ đề, lệnh chạy, lưu bằng chứng).

Thư mục này đo **độ chính xác của việc chấm mức cảnh báo** trên bộ đề độc lập. Có 4 cấu hình được so sánh:

| Cấu hình | Mô tả | Lượt gọi API |
|---|---|---|
| `rules` | Chỉ dùng bộ luật (`packages/core/src/analyzer.ts`) | 0 |
| `ai` | Chỉ dùng AI, **không** thấy tín hiệu của luật, tự chấm `risk_level` | 1 lượt mỗi hội thoại |
| `hybrid` | Luật + tín hiệu AI. AI chỉ được **bổ sung**, không hạ mức. Dùng lại phản hồi của `ai` | 0 lượt thêm |
| `hybrid-veto` | Như `hybrid`, nhưng AI được hạ ≤ 1 bậc khi tự chấm thấp hơn luật. Dùng để đo đánh đổi giữa bớt báo nhầm và bỏ sót | 0 lượt thêm |
| `hybrid-hint` | Giống sản phẩm thật: AI thấy tín hiệu luật và đề nghị hạ mức qua `level_adjustment` | 1 lượt mỗi hội thoại |

| `replay-rules` | **Phát lại từng tin** như phiên thật: chạy lại luật sau mỗi tin, chấm mức tại các mốc (`moc_muc`) | 0 |
| `replay-hybrid` | Phát lại từng tin, có AI. Gọi AI theo đúng chính sách của sản phẩm: chỉ khi mức tăng, có tín hiệu mới hoặc đủ N tin; mỗi lần gửi phần chênh lệch kèm tóm tắt | Chỉ các lượt mà chính sách cho phép |

## Chuẩn bị

1. Tổng hợp bộ đề theo [dataset/README.md](dataset/README.md) (mẫu: [dataset/TEMPLATE.csv](dataset/TEMPLATE.csv)).
2. Chép file `research/.env.example` thành `research/.env` và điền `OPENROUTER_API_KEY`. File `.env` không được commit.
3. Hạn mức của OpenRouter cho model miễn phí:
   - Tối đa 20 lượt/phút.
   - **50 lượt/ngày** nếu tài khoản chưa từng nạp tiền.
   - **1.000 lượt/ngày** nếu tài khoản đã từng nạp ≥ 10 credits. Dùng model `:free` không trừ vào số credit này.

   Bộ đề 500 hội thoại cần mức 1.000 lượt/ngày. Nếu chưa nạp, thêm `--daily-cap 45` vào lệnh chạy.

## Quy trình

```bash
npm run bench:import -- duong/dan/bo-de.csv
```
Bước này kiểm tra lỗi, chia **dev 30% / test 70%** và khóa bộ test bằng mã băm.

```bash
npm run bench:rules
```
Chạy bộ luật trên toàn bộ đề. Miễn phí và cho kết quả ngay; đây là điểm chuẩn để so.

```bash
npm run bench:models
```
Lấy danh sách model `:free` đang có trên OpenRouter, kèm giá bản trả phí tương ứng.

```bash
npm run bench:run -- --configs ai,hybrid,hybrid-veto --models <id1>,<id2>,<id3>,<id4>,<id5> --split dev --limit 50
```
**Sàng lọc:** 5–6 model × 50 ca dev.

```bash
npm run bench:run -- --configs rules,ai,hybrid,hybrid-veto --models <top1>,<top2>,<top3> --split dev
```
**Chạy đầy đủ trên dev** với 3 model tốt nhất.

```bash
npm run bench:run -- --configs ai,hybrid --models <top1>,<top2>,<top3> --split dev --limit 50 --repeat 3
```
**Đo độ ổn định:** chạy lặp 3 lần trên 50 ca.

```bash
npm run bench:report -- --runs <runId1>,<runId2>
```
Xuất báo cáo dạng Markdown và HTML vào `research/reports/`.

- **Khi chạm trần lượt/ngày:** lệnh dừng an toàn. Hôm sau chạy lại **đúng lệnh cũ**, các ca đã chạy sẽ lấy từ cache trong `research/cache/` nên không tốn lượt.
- **Mỗi lần chạy** được ghi một dòng vào `research/RUNS.md` gồm model, phiên bản prompt, commit của bộ luật và kết quả.

### Phát lại từng tin (bộ đề v2 có mốc)

```bash
npm run bench:run -- --configs replay-rules --split dev
```
Chỉ dùng bộ luật.

```bash
npm run bench:run -- --configs replay-rules,replay-hybrid --models <id> --split dev --gap-sec 20
```
Có AI. `--gap-sec` là khoảng cách giả lập giữa 2 tin (mặc định 20 giây). Giá trị này quyết định việc giãn cách giữa các lần gọi AI.

```bash
npm run bench:run -- --dataset duong/dan/dot-moi.xlsx --configs replay-rules
```
Kiểm tra nhanh một đợt ca mới viết mà không cần nhập vào và không khóa bộ test.

Các chỉ số thêm ở mục **"Theo dõi diễn biến"** trong báo cáo:

| Chỉ số | Ý nghĩa |
|---|---|
| Đúng tại mốc | Mức sau tin đối phương thứ k có khớp nhãn ở cột `moc_muc` không. Ca không có mốc thì chấm ở tin cuối |
| Phát hiện đúng lúc / muộn / không bao giờ, độ trễ | Hệ thống lên ≥ Cao sớm hay muộn bao nhiêu tin so với nhãn. Số âm nghĩa là sớm hơn |
| Báo động quá sớm | Hệ thống ≥ Cao trong khi nhãn ở mốc đó còn < Cao. Đây là phản ứng thái quá với câu mơ hồ |
| Dao động, hạ mức vô cớ | Mức đổi chiều lên xuống, hoặc bị hạ trong khi nhãn không hạ |
| Lượt AI / ca, lượt AI / 10 tin | Đo chi phí của chính sách gọi AI |

Phần mô phỏng giả định AI trả lời xong trước khi tin kế tiếp đến, và không giới hạn lượt gọi trong ngày (trần thật vẫn áp dụng cho API).

## Lưu bằng chứng từng đợt

**Trong lúc chạy:** mọi thứ được ghi liên tục vào `research/results/`, nên dừng giữa chừng hay hết lượt cũng không mất:

| File | Nội dung |
|---|---|
| `<runId>.jsonl` | Kết quả từng ca, ghi ngay khi xong mỗi ca |
| `<runId>.meta.json` | Cấu hình, commit bộ luật, phiên bản prompt, **tiến độ** (`status`: running/stopped/finished, `done`, `lastCase`, số lượt đã dùng hôm nay) |
| `<runId>.raw.jsonl` | **Nguyên văn phản hồi của model** cho từng lượt gọi (thời điểm, ca, model, độ trễ, token, nội dung hoặc lỗi) |

**Sau khi chạy:** đóng gói vào nhánh `research/evidence`, mỗi đợt một thư mục:

```bash
npm run bench:archive -- --dot dot-03-thu --runs <runId1>,<runId2> --title "v2 thử trên model miễn phí" --push
```

```
dot-03-thu_<ngày>/
  README.md    mục đích · bảng các lần chạy (tự cập nhật) · kết quả chính · hạn chế · cách tái lập
  RUNS.md      nhật ký các lần chạy của đợt
  dataset/     bản chụp bộ đề đã dùng + SHA256.txt
  models/      danh sách model miễn phí lúc chạy (từ bench:models)
  results/     .jsonl · .meta.json · .raw.jsonl của từng lần chạy
  reports/     báo cáo MD + HTML gộp mọi lần chạy của đợt
  analysis/    phân tích viết tay (lệnh không ghi đè)
```

- Lệnh dùng một git worktree ở `.evidence/` (thư mục gốc repo, không đưa lên `main`).
- Chạy lại với `runId` mới thì bổ sung vào cùng thư mục đợt; báo cáo và bảng trong README tự gộp lại.
- Có `--push`: đẩy nhánh `research/evidence` và gắn tag `eval/<dot>` vào đúng commit code đã chạy.
- Trước khi commit, lệnh quét chuỗi giống API key; thấy là dừng.
- Phần "Mục đích / Kết quả chính / Hạn chế" trong README đợt phải viết tay sau khi đọc báo cáo.

## Nguyên tắc giữ số liệu trung thực

- **Chỉ chỉnh luật và prompt dựa trên dev.** Bộ `--split test` chỉ chạy ở các mốc chốt. Báo cáo luôn ghi cả số liệu dev lẫn test.
- **Không đọc nội dung ca test khi sửa luật.** Báo cáo của lần chạy test chỉ dùng để trình bày kết quả.
- **Bộ đề `fixtures` (40 tình huống phát triển)** chỉ dùng để thử quy trình chạy, không dùng làm số liệu nghiên cứu.
- **Endpoint miễn phí có thể lưu dữ liệu gửi lên.** Bộ đề giả lập thì không sao. Nhưng muốn kết luận "dùng model X cho chat thật" thì phải kèm điều kiện về quyền riêng tư.
- **Danh sách model `:free` thay đổi thường xuyên.** Báo cáo ghi rõ ngày chạy và tên chính xác của model.

## Chỉ số trong báo cáo

| Chỉ số | Ý nghĩa |
|---|---|
| **Bỏ sót nguy hiểm** | Tỷ lệ ca có nhãn ≥ Cao nhưng hệ thống chấm < Cao. Đây là chỉ số quan trọng nhất và dùng để xếp hạng trước |
| Đúng mức, Macro-F1, Sai số bậc | Độ chính xác tổng thể của việc chấm 4 mức |
| Bắt Nghiêm trọng | Tỷ lệ ca Nghiêm trọng được chấm đúng là Nghiêm trọng |
| Báo nhầm (bình thường / dễ nhầm) | Tỷ lệ ca bình thường bị chấm cao hơn nhãn |
| Không trả lời / JSON hợp lệ | Model lỗi, hoặc trả về không đúng định dạng yêu cầu |
| Ổn định κ | Mức nhất quán giữa các lần chạy lặp (1 = hoàn toàn giống nhau) |
| Trễ p50/p95 | Độ trễ phản hồi: mức trung vị và mức 95% |
| Chi phí/1000 hội thoại | Quy đổi theo giá bản trả phí của cùng model |
| `[a–b]` | Khoảng tin cậy 95% (bootstrap) |
