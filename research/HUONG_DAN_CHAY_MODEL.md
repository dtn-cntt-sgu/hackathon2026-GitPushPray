# Hướng dẫn chạy so sánh bộ luật với model AI miễn phí

Dành cho thành viên phụ trách chạy model. Mục tiêu: đo **model AI (Groq / OpenRouter `:free`)** so với **bộ luật** trên cùng bộ đề, rồi lưu kết quả thành một đợt bằng chứng.

## 0. Quy tắc bắt buộc

- **Trên `set:v2` (đã khóa tune/check): chỉ chạy `--split tune`.** Không chạy `--split dev` (vì `dev` của `set:v2` gồm cả 40 ca `check`), không chạy `--split check` trừ lần xem duy nhất sau khi đã chọn xong model (`--split check --unlock-check`).
- **Trên bộ đề thường (`bench`, `ext:sms`): chỉ chạy `--split dev`.** Không chạy `--split test`; test chỉ chạy ở mốc chốt do cả nhóm quyết định.
- **Không sửa `test.lock`**, không dùng `--force-new-test` trừ khi nhóm đã thống nhất.
- **Không commit** `research/.env` (key), `research/data/`, `research/results/`, `research/reports/`, `research/cache/`. Các thư mục này đã được gitignore, đừng `git add -f`.
- Chỉ dùng bộ đề trong hướng dẫn này (hội thoại giả lập / chuyển thể). **Không gửi chat thật** của ai lên model miễn phí: endpoint miễn phí có thể lưu dữ liệu gửi lên.
- Phạm vi sản phẩm là **tin nhắn / chat**. Không dùng các bộ lời thoại cuộc gọi (`tele28k`, `scamtext`).

## Đo trên Groq (đường chính của nhóm)

Sản phẩm dừng ở Tầng 1 nên model sẽ dùng là model trên Groq. Đo trên **tune**, không chạy trên check.

1. Tạo khóa ở console.groq.com, thêm `GROQ_API_KEY=` vào `research/.env`. Dùng khóa benchmark, không dùng khóa của gateway.
2. Xem hạn mức thật ở trang Limits. Lần thử ngày 2026-11-07 đọc được 1.000 lượt/ngày và 8.000 token/phút. Mỗi lượt của `gpt-oss` tốn khoảng 3.700 token, nên đặt `--interval-ms 30000`. Có thể thêm `--reasoning-effort low|medium|high`; mỗi mức có cache riêng và là một lần đo riêng. Xem model khóa của bạn dùng được bằng `GET /openai/v1/models`.
3. Chạy thử 2 ca:

```bash
npm run bench:run -- --provider groq --dataset set:v2 --split tune --limit 2 --configs ai,hybrid-hint --models openai/gpt-oss-20b --interval-ms 30000 --run-id groq_thu
```

4. Chạy đủ tune cho từng model. `hybrid-hint` là cấu hình chấm chính (giống sản phẩm nhất); `ai`, `hybrid`, `hybrid-veto` dùng chung một lượt gọi, còn `hybrid-hint` tốn thêm một lượt nên có thể chạy gộp hoặc tách ngày nếu hạn mức ít:

```bash
npm run bench:run -- --provider groq --dataset set:v2 --split tune --configs rules,ai,gateway,gateway-nocal --models openai/gpt-oss-20b --reasoning-effort low --interval-ms 30000 --run-id groq_20b_tune
```

Hết hạn mức ngày thì lệnh tự dừng. Hôm sau chạy lại đúng lệnh, cùng `--run-id`; ca đã xong lấy từ cache.

5. Ghi vào sổ thí nghiệm (chấm theo `--config hybrid-hint`), rồi tự viết `README.md` của thí nghiệm đó:

```bash
npm run bench:experiment-ai -- --id EXP-011 --run groq_20b_tune --model openai/gpt-oss-20b --config gateway --title "Luật + Groq gpt-oss-20b" --hypothesis "..."
```

```bash
npm run bench:experiment -- --ledger
```

6. `ai` và `hybrid-hint` đọc cả hội thoại một lần. Sản phẩm thì gọi AI mỗi 2 tin mới của cả hai phía và gọi nốt tin lẻ khi hội thoại dừng 20 giây, nên sau khi chọn model phải đo thêm bằng `replay-hybrid`, khoảng 350 lượt trên tune. Muốn thử quét ban đầu thì thêm `--pad-to 50` để có hội thoại dài ([EXP-009](experiments/EXP-009/README.md)):

```bash
npm run bench:run -- --provider groq --dataset set:v2 --split tune --configs replay-rules,replay-hybrid --models <model đã chọn> --interval-ms 15000 --run-id groq_replay_tune
```

**Khi đọc số:** luật đã được sửa theo chính tập tune (1/31 bỏ sót), nên trên tune AI gần như không còn chỗ để bắt thêm. Lợi ích nhìn thấy được trên tune chủ yếu là giảm báo nhầm ở `hybrid-hint`, năng lực riêng của model đọc ở `ai`, và bài kiểm tra thật là lần xem check duy nhất sau khi đã chọn model. Check đã xem 2 lần, không xem thêm để chọn giữa các model.

## 1. Cài đặt

```bash
npm install
npm run check
```

Chạy ở thư mục gốc của repo.

- Cần Node.js 20 trở lên.
- `npm run check` chạy typecheck, test, eval so với mốc và build. Lệnh phải đạt trước khi làm tiếp.
- Tạo file `research/.env` từ `research/.env.example`, điền `GROQ_API_KEY=` hoặc `OPENROUTER_API_KEY=` bằng **key của chính bạn**.
- Hạn mức model `:free` trên OpenRouter:
  - tối đa 20 lượt/phút;
  - **50 lượt/ngày** nếu tài khoản chưa từng nạp tiền;
  - **1.000 lượt/ngày** nếu đã từng nạp từ 10 credits. Dùng model `:free` không trừ credit.

## 2. Lấy bộ đề

**Repo này không chứa dữ liệu.** Bản dữ liệu dùng được đang ở máy của người phụ trách AI, trong `research/data/`. Các lệnh dưới đây chỉ dùng khi lấy lại từ nhánh `research/evidence` của repo nghiên cứu riêng của nhóm:

```bash
git fetch origin research/evidence
```

**Bộ đề v2** (105 hội thoại dài, đã chia khóa cứng 65 ca `tune` / 40 ca `check`). Đây là **bộ chính cần chạy**:

```bash
git show origin/research/evidence:bo-de/v2_2026-11-04/bo_de_v2.csv > research/dataset/bo_de_v2.csv
npm run bench:import -- research/dataset/bo_de_v2.csv --name v2
```

Kết quả đúng là in ra `dev 105 / test 0`. Từ đây luôn dùng `--dataset set:v2 --split tune`.

**Bộ đề nhóm Đợt 1** (100 ca ngắn, có chia dev/test):

```bash
git show origin/research/evidence:dot-08-tuyen-ctv_2026-11-03/dataset/dataset.csv > research/dataset/dot1.csv
npm run bench:import -- research/dataset/dot1.csv
```

Mã khóa test in ra phải là `5dfd4b597d3271a9…`. Nếu khác thì **dừng lại và báo nhóm**. Từ đây dùng `--dataset bench`.

**SMS công khai** (2.991 tin, nhãn 2 lớp, đúng phạm vi):

```bash
mkdir -p research/data/external/sms
for f in cases.json split.json test.lock manifest.json; do
  git show origin/research/evidence:dot-08-tuyen-ctv_2026-11-03/dataset/sms/$f > research/data/external/sms/$f
done
```

Từ đây dùng `--dataset ext:sms`.

## 3. Chạy trên OpenRouter (phụ)

**Bước 1: xem các model miễn phí đang có**

```bash
npm run bench:models
```

Chọn 5–6 model, ưu tiên model lớn, có hỗ trợ tiếng Việt và cửa sổ ngữ cảnh dài.

**Bước 2: sàng lọc nhanh**, 20 ca `tune` × các model đã chọn:

```bash
npm run bench:run -- --dataset set:v2 --split tune --limit 20 --configs ai,hybrid-hint --models <id1>,<id2>,<id3>,<id4>,<id5> --run-id dot09_sangloc
```

Thêm `--daily-cap 45` nếu tài khoản chưa nạp credit.

**Bước 3: chạy đầy đủ trên `tune`** với 2–3 model tốt nhất:

```bash
npm run bench:run -- --dataset set:v2 --split tune --configs rules,ai,hybrid,hybrid-veto,hybrid-hint --models <top1>,<top2>,<top3> --run-id dot09_v2_full
```

**Bước 4 (tùy chọn, tốn lượt): phát lại từng tin như phiên thật**

```bash
npm run bench:run -- --dataset set:v2 --split tune --configs replay-rules,replay-hybrid --models <top1> --run-id dot09_v2_replay
```

**Ước lượng số lượt gọi:**

| Cấu hình | Số lượt |
|---|---|
| `ai` | 1 lượt / ca / model |
| `hybrid`, `hybrid-veto` | Dùng lại phản hồi của `ai`, không tốn thêm |
| `hybrid-hint` | 1 lượt / ca |
| `replay-hybrid` | Khoảng 5 lượt / ca (mỗi 2 tin một lượt, cộng một lượt gọi nốt ở cuối) |

Ví dụ: `set:v2` tập `tune` có 65 ca × 1 cấu hình gọi mạng (`ai` hoặc `hybrid-hint`) = 65 lượt / model.

**Khi gặp sự cố:**
- Hết lượt trong ngày hoặc bị lỗi 429: lệnh tự dừng an toàn, tiến độ nằm ở `research/results/<runId>.meta.json`. Hôm sau **chạy lại đúng lệnh cũ, cùng `--run-id`**. Ca nào đã có phản hồi sẽ lấy từ cache, không tốn lượt.
- Nguyên văn phản hồi của model nằm ở `research/results/<runId>.raw.jsonl`. Giữ file này, đó là bằng chứng.

## 4. Xem báo cáo

```bash
npm run bench:report -- --runs dot09_v2_full
```

Báo cáo ghi vào `research/reports/`. Nên đọc theo thứ tự:

| Chỉ số | Ý nghĩa |
|---|---|
| **Bỏ sót nguy hiểm** | Quan trọng nhất: ca nguy hiểm mà hệ thống chấm thấp |
| Báo nhầm (bình thường / dễ nhầm) | Bộ v2 có 52 ca bình thường, gồm cả ca thù địch nhưng bình thường |
| Đúng mức, Macro-F1 | Độ chính xác chung khi chấm 4 mức |
| JSON hợp lệ, độ trễ | Model có ổn định không |
| Theo dõi diễn biến (khi chạy replay) | Đúng tại từng mốc, cảnh báo sớm hay muộn |

Mốc của bộ luật trên v2, chạy ngày 2026-11-04: đúng mức 45,7%, bỏ sót nguy hiểm 42%, báo nhầm 30,8%.

## 5. Lưu bằng chứng (bắt buộc sau mỗi lần chạy có ý nghĩa)

Cần quyền **Write** vào repo:

```bash
npm run bench:archive -- --dot dot-09-model-v2 --runs dot09_sangloc,dot09_v2_full --title "So sánh bộ luật với model miễn phí trên bộ đề v2 (tune)" --push
```

Lệnh này:
- tạo thư mục `dot-09-model-v2_<ngày>/` trên nhánh `research/evidence`, gồm kết quả, nguyên văn phản hồi model, báo cáo, bản chụp bộ đề và danh sách model;
- commit, push, rồi gắn tag `eval/dot-09-model-v2`.

Sau đó mở `.evidence/dot-09-model-v2_<ngày>/README.md` và **viết tay** 3 mục:
- **Mục đích**;
- **Kết quả chính**: model nào tốt nhất, tốt hơn hay kém hơn bộ luật ở chỉ số nào;
- **Hạn chế**: ví dụ bộ v2 do người viết luật chuyển thể và chỉ ở dev, model free có thể đổi theo ngày.

Viết xong thì commit và push nhánh `research/evidence`.

## 6. Lưu ý khi diễn giải

- **Bộ v2 chưa độc lập hoàn toàn.** Phần lớn ca do chính người viết luật chuyển thể, và 36 ca bình thường đang chờ xác nhận người viết. Kết quả trên v2 **chỉ là số dev**, không phải số test.
- **Danh sách model `:free` thay đổi thường xuyên.** Báo cáo phải ghi ngày chạy và tên model chính xác (có sẵn trong `models/` của đợt).
- **Nếu AI tốt hơn luật ở ca bình thường dễ nhầm** (ít báo nhầm hơn), đó là bằng chứng ủng hộ cấu hình "luật + AI hạ ≤ 1 bậc" của sản phẩm. Ghi rõ điều này trong phần kết quả.
