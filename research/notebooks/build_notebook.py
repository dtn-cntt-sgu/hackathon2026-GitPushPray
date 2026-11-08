"""Sinh research/notebooks/phan_tich_luat.ipynb, không kèm kết quả chạy (repo public)."""
import sys
from pathlib import Path

import nbformat as nbf

sys.stdout.reconfigure(encoding="utf-8")
nb = nbf.v4.new_notebook()
nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}


def md(text: str) -> None:
    nb.cells.append(nbf.v4.new_markdown_cell(text.strip()))


def code(text: str) -> None:
    nb.cells.append(nbf.v4.new_code_cell(text.strip()))


md("""
# Quy trình nghiên cứu bộ luật SafeChat AI

**Câu hỏi nghiên cứu:** bộ luật tiếng Việt nhận ra dấu hiệu lừa đảo trong hội thoại tốt đến đâu, sai ở ngữ cảnh nào, và cần thêm hay sửa luật gì để bớt bỏ sót ca nguy hiểm mà không tăng báo nhầm?

**Quy trình gồm 12 bước:**

| Bước | Việc | Kết quả |
|---:|---|---|
| 1 | Xác định nguồn dữ liệu | Biết mỗi ca đến từ đâu, dùng được đến mức nào |
| 2 | Thu thập, lọc trùng, chuyển thể | Hội thoại `DP:` / `TOI:` đã thay thông tin cá nhân |
| 3 | Gán nhãn | Mức cuối, mốc theo từng tin, độ đồng thuận |
| 4 | Làm sạch và kiểm tra | Bộ đề đúng định dạng, có mã băm |
| 5 | Chia dữ liệu | Tune để đọc lỗi, check để kiểm chứng |
| 6 | Chuẩn hóa văn bản | Văn bản dùng để so khớp luật |
| 7 | Chia theo ngữ cảnh | Biết luật yếu ở đâu |
| 8 | Tìm mẫu ngôn ngữ | Cụm từ đặc trưng của tin nguy hiểm |
| 9 | Đo vùng phủ của luật | Tin nguy hiểm nào luật chưa chạm tới |
| 10 | Phân tích lỗi | Nguyên nhân gốc của từng lỗi |
| 11 | Đề xuất và thử ứng viên luật | Danh sách luật nên làm, có số liệu |
| 12 | Quy trình cải tiến, tiêu chí nghiệm thu | Cách sửa và cách biết đã tốt hơn |
| 13 | Đo kết quả sau khi sửa | Luật có thật sự tổng quát hay không |

**Quy tắc xuyên suốt:** chỉ đọc nội dung trên tập **tune**. Tập **check** chỉ có số tổng. Mọi số trong tài liệu này là **số dev**, không phải kết quả kiểm tra độc lập.
""")

code("""
import json
import math
import os
import re
from collections import Counter
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from IPython.display import Markdown, display

ROOT = Path(os.environ.get("SAFECHAT_RESEARCH", Path.cwd()))
while not (ROOT / "results").exists() and ROOT != ROOT.parent:
    ROOT = ROOT.parent
DATA = ROOT / "results" / "rule_analysis"

def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))

# Bước 1–12 mô tả quá trình tìm luật nên đọc mốc TRƯỚC khi sửa. Bước 13 so với bản hiện tại.
has_baseline = (DATA / "summary_before.json").exists()
summary = load("summary_before.json" if has_baseline else "summary.json")
cases = load("tune_before.json" if has_baseline else "tune_cases.json")
sms = pd.DataFrame(load("sms_before.json" if has_baseline else "sms_dev.json"))
summary_after = load("summary.json")
cases_after = load("tune_cases.json")
sms_after = pd.DataFrame(load("sms_dev.json"))

LEVELS = ["low", "attention", "high", "critical"]
LEVEL_VI = {"low": "Thấp", "attention": "Cần chú ý", "high": "Cao", "critical": "Nghiêm trọng"}
RANK = {k: i for i, k in enumerate(LEVELS)}
GROUP_VI = {
    0: "0. Bình thường", 1: "1. Mạo danh, app độc", 2: "2. Đầu tư, vay", 3: "3. CTV nhiệm vụ", 4: "4. Hack, mượn tiền",
    5: "5. Tình cảm, tống tiền", 6: "6. Lừa đảo kép", 7: "7. TMĐT, đặt cọc", 8: "8. Tuyển dụng, mua bán người",
}
SOURCE_VI = {"chuyen_the": "Chuyển thể từ nguồn công khai", "ai_sinh_da_sua": "AI sinh, đã sửa", "tu_viet": "Ghi là tự viết"}
INK, MUTED, GRID, BAR = "#1f2937", "#6b7280", "#e5e7eb", "#2f6fb3"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "text.color": INK,
    "xtick.color": MUTED, "ytick.color": INK, "axes.spines.top": False, "axes.spines.right": False,
})


def show(frame, pct=(), dec=()):
    fmt = {c: "{:.1%}" for c in pct} | {c: "{:.2f}" for c in dec}
    display(frame.style.format(fmt, na_rep="").hide())


def barh(labels, values, title, notes=None, width=7.0):
    fig, ax = plt.subplots(figsize=(width, 0.42 * len(labels) + 1))
    bars = ax.barh(labels, values, color=BAR, height=0.6)
    for i, bar in enumerate(bars):
        text = notes[i] if notes else str(values[i])
        ax.text(bar.get_width() + max(values) * 0.012, bar.get_y() + bar.get_height() / 2, text, va="center", color=MUTED, fontsize=9)
    ax.xaxis.set_visible(False)
    ax.spines["bottom"].set_visible(False)
    ax.tick_params(length=0)
    ax.set_title(title, loc="left", fontsize=11)
    plt.tight_layout()
    plt.show()


def heat(matrix, row_labels, col_labels, title, xlabel, ylabel):
    matrix = np.array(matrix)
    fig, ax = plt.subplots(figsize=(5.6, 4.3))
    ax.imshow(matrix, cmap="Blues", vmin=0)
    ax.set_xticks(range(len(col_labels)), col_labels, rotation=20)
    ax.set_yticks(range(len(row_labels)), row_labels)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    threshold = matrix.max() * 0.55 if matrix.max() else 0
    for i in range(matrix.shape[0]):
        for j in range(matrix.shape[1]):
            ax.text(j, i, int(matrix[i, j]), ha="center", va="center", color="white" if matrix[i, j] > threshold else INK)
    ax.spines[:].set_visible(False)
    ax.tick_params(length=0)
    ax.set_title(title, loc="left", fontsize=11)
    plt.tight_layout()
    plt.show()


df = pd.DataFrame(cases)
df["gold_rank"] = df.gold.map(RANK)
df["pred_rank"] = df.pred.map(RANK)
df["benign"] = df.kind != "scam"
df["danger"] = df.gold_rank >= 2
df["missed_danger"] = df.danger & (df.pred_rank < 2)
df["false_alarm"] = df.benign & (df.pred_rank >= 1)
df["signal_types"] = df.signals.map(lambda s: sorted({x["type"] for x in s}))
print(f"Phiên bản luật: {summary['rulesCommit']} | Bộ đề: {summary['dataset']} | Tập tune/check: {summary['counts']} | Mã băm: {summary['splitSha256'][:12]}")
""")

md("""
## Bước 1. Nguồn dữ liệu

Nghiên cứu dùng 2 loại dữ liệu cho 2 mục đích khác nhau:

| Bộ | Quy mô | Dùng để | Giới hạn |
|---|---|---|---|
| **Bộ đề v2** | 105 hội thoại dài, có mốc theo từng tin | **Bộ chính**: đo theo dõi diễn biến, tìm luật | Phần lớn do người viết luật chuyển thể, nên chưa độc lập |
| **SMS công khai** (CC BY 4.0) | 2.991 tin thật đã ẩn danh, dev 897 | Kiểm tra mẫu mới có bắt nhầm tin bình thường thật không | Tin lẻ, không phải hội thoại. Nhãn gộp cả quảng cáo |
| Bộ Đợt 1 của nhóm | 100 ca ngắn | Mốc lịch sử | Chỉ 10 ca bình thường |
| Lời thoại cuộc gọi `tele28k`, `scamtext` | ~17.000 mẫu | Không dùng để chỉnh luật | Ngoài phạm vi vì là cuộc gọi, không phải chat |

Bộ v2 gồm 4 phần:

| Phần | Số ca | Cách tạo | Vai trò |
|---|---:|---|---|
| `V2_S..` | 46 | Chuyển thể từ 48 kịch bản lấy từ báo chí, Threads, Facebook. Bỏ 2 ca chỉ diễn ra qua cuộc gọi | Lừa đảo sát thực tế |
| `TT_..` | 11 | Chuyển thể từ bài báo | Tuyển CTV, dụ đi xa, tuyển mẫu nhí |
| `V2_C..` | 12 | Đối chứng do AI sinh rồi sửa: 6 ca thù địch nhưng bình thường, 6 ca lịch sự nhưng bình thường | Kiểm tra luật có bị đánh lừa bởi giọng điệu không |
| `V2_BT..` | 36 | Ca bình thường có từ khóa dễ nhầm, ghi nguồn tự viết | Đo báo nhầm |
""")

code("""
shape = summary["shape"]["all"]
show(pd.DataFrame([
    {"Chỉ số": "Hội thoại", "Giá trị": str(shape["n"])},
    {"Chỉ số": "Tổng số tin", "Giá trị": f"{shape['messages']:,}"},
    {"Chỉ số": "Tin của đối phương (luật chỉ đọc phần này)", "Giá trị": str(shape["dpMessages"])},
    {"Chỉ số": "Trung bình tin mỗi hội thoại", "Giá trị": f"{shape['messages'] / shape['n']:.1f}"},
]))
show(pd.DataFrame([{"Nguồn": SOURCE_VI.get(k, k), "Số ca": v} for k, v in shape["source"].items()]))
group_counts = {int(k): v for k, v in shape["group"].items()}
ordered = sorted(group_counts, key=lambda g: group_counts[g])
barh([GROUP_VI.get(g, str(g)) for g in ordered], [group_counts[g] for g in ordered], "Số hội thoại theo nhóm kịch bản (toàn bộ v2)")
""")

md("""
**Nhận xét:** bộ đề cân bằng giữa lừa đảo và bình thường, nhưng mỗi nhóm kịch bản lừa đảo có ít ca. Vì vậy số liệu theo từng nhóm chỉ mang tính định hướng.

## Bước 2. Thu thập, lọc trùng, chuyển thể

1. **Thu thập:** nhóm tổng hợp 48 kịch bản dạng mô tả từng bước (`scam_scenarios_vi.jsonl`, `SafeChat_kich_ban_lua_dao.xlsx`) và 11 ca hội thoại chuyển thể từ báo (`chuyen_the.csv`).
2. **Lọc trùng:** bản jsonl và xlsx trùng hoàn toàn nên giữ một bản. So nội dung giữa các ca và với bộ Đợt 1 không phát hiện trùng vụ. Sau lọc còn **59 ca**.
3. **Xác định phạm vi:** 46 ca trong phạm vi, 11 ca một phần qua cuộc gọi, 2 ca ngoài phạm vi (S21, S34) bị loại. Ca một phần chỉ chuyển thể phần diễn ra qua tin nhắn.
4. **Chuyển thể:** mỗi bước mô tả được viết lại thành 1–3 tin `DP:` / `TOI:`, giữ thứ tự giai đoạn và cách kẻ gian nói. Phần do người viết tự thêm được ghi riêng ở cột `phan_bo_sung`.
5. **Che thông tin:** thay tên, số điện thoại, số tài khoản, link bằng giá trị giả. Ẩn 29 link mạng xã hội vì chứa tên tài khoản cá nhân.
6. **Bổ sung ca bình thường:** vì nguồn ban đầu chỉ có 4/59 ca bình thường, nhóm bổ sung 12 ca đối chứng và 36 ca bình thường.

**Ghi rõ nguồn gốc:** mỗi ca có cột `nguon`. Riêng 9 ca trong nhóm S20–S29 ghi rõ không truy lại được bài gốc trên Facebook.

## Bước 3. Gán nhãn

Mỗi hội thoại có 2 loại nhãn:

**a) Mức cuối** (`muc_A`, `muc_B`, `muc_chot`), gán theo mức cao nhất hội thoại đã đạt:

| Mức | Khi nào | Ví dụ |
|---|---|---|
| Thấp | Không có yêu cầu rủi ro cụ thể | Trò chuyện đời thường |
| Cần chú ý | Lời hứa mơ hồ, thiếu thông tin, rủ sang kênh kín, link lạ, **chưa** đòi tiền hay dữ liệu | Việc nhẹ lương cao |
| Cao | Yêu cầu cụ thể gây hại | Chuyển tiền, đặt cọc, OTP, ảnh giấy tờ, đầu tư cam kết lãi |
| Nghiêm trọng | Đe dọa, cô lập, giữ giấy tờ gốc, đi xa gấp, cài app, ép nạp thêm, mạo danh cơ quan đòi tiền | Kẹt lệnh, tống tiền |

**b) Mốc theo từng tin** (`moc_muc`), ví dụ `2:thap;3:chu_y;5:cao` nghĩa là mức đúng sau tin đối phương thứ 2, 3, 5. Mốc này cho phép đo hệ thống cảnh báo sớm hay muộn, không chỉ đúng hay sai ở cuối.
""")

code("""
pairs = summary["labelPairs"]
conf = np.zeros((4, 4), dtype=int)
for key, value in pairs.items():
    a, b = key.split("|")
    conf[RANK[a], RANK[b]] = value
n = conf.sum()
observed = np.trace(conf) / n
expected = (conf.sum(1) * conf.sum(0)).sum() / (n * n)
kappa = (observed - expected) / (1 - expected)
heat(conf, [LEVEL_VI[l] for l in LEVELS], [LEVEL_VI[l] for l in LEVELS], "Đồng thuận giữa 2 người gán nhãn", "Người B", "Người A")
final_a, final_b = summary["labelFinalEqualsA"], summary["labelFinalEqualsB"]
display(Markdown(f"Trùng nhãn **{np.trace(conf)}/{n}** ca, Cohen's κ = **{kappa:.3f}**. Mức chốt trùng người A ở **{final_a}/{n}** ca, trùng người B ở **{final_b}/{n}** ca."))
""")

md("""
**Đọc kết quả với sự thận trọng:**

- **Mức chốt luôn trùng người A.** Trên dữ liệu, 11 ca bất đồng đều được chốt theo A, nên không thấy dấu hiệu của một bước bàn bạc độc lập.
- **Cả 11 ca bất đồng, B đều chấm nặng hơn A một bậc.** Vì mức chốt theo A, nhãn đang nghiêng về phía nhẹ hơn ở các ca khó.
- **Mốc theo từng tin trùng 58/58 ca** ở phần chuyển thể giữa 2 bản, nên thực chất mới có một người gán mốc.
- **36 ca `V2_BT`** có cùng khuôn 12 tin, xen kẽ đều, và gần như cùng một nhãn, nên chúng làm κ tổng cao hơn mức thực tế.

Vì vậy κ ở trên **là mức trên, chưa phải bằng chứng đầy đủ về độ độc lập**. Khi nộp phải nêu hạn chế này, đồng thời có `DATA_CARD.md`.

## Bước 4. Làm sạch và kiểm tra

Lệnh `npm run bench:import` kiểm tra từng dòng và báo đúng dòng lỗi:

- Đủ cột bắt buộc, `id` không trùng, mức nằm trong 4 giá trị hợp lệ.
- Mỗi tin bắt đầu bằng `DP:` hoặc `TOI:`.
- Ca `scam` không được có mức chốt Thấp. Ca bình thường chỉ được Thấp hoặc Cần chú ý.
- Mốc phải tăng dần, không vượt số tin đối phương, và mốc ở tin cuối phải bằng mức chốt.
- Lưu bản chụp CSV kèm mã băm: bộ đề v2 có SHA256 `7746f782…`. Không sửa file đã khóa. Muốn sửa nhãn thì tạo phiên bản `v2.1`.

## Bước 5. Chia dữ liệu

Toàn bộ v2 thuộc dev vì người viết luật đã tham gia chuyển thể. Để sửa luật mà không tự làm đẹp số, dev được chia tiếp:

| Tập | Mục đích | Được đọc gì |
|---|---|---|
| **Tune** | Đọc lỗi, tìm mẫu, sửa luật | Toàn bộ nội dung |
| **Check** | Biết sửa có tổng quát hay không | Chỉ số tổng |
| Test cũ (SMS, bộ Đợt 1), bộ đề kín | Con số cuối cùng | Chạy một lần sau khi đóng băng |

**Cách chia:** phân tầng theo loại ca và mức nguy hiểm, seed cố định. Các ca cùng một bài báo được gom vào cùng một phía để tránh rò rỉ. Danh sách được khóa bằng mã băm trong `research/splits/`.
""")

code("""
rows = []
for name in ("tune", "check"):
    s = summary["shape"][name]
    rows.append({
        "Tập": name, "Số ca": s["n"], "Lừa đảo": s["kind"].get("scam", 0), "Bình thường": s["kind"].get("benign_confusable", 0) + s["kind"].get("benign", 0),
        "Thấp": s["gold"].get("low", 0), "Cần chú ý": s["gold"].get("attention", 0), "Cao": s["gold"].get("high", 0), "Nghiêm trọng": s["gold"].get("critical", 0),
    })
show(pd.DataFrame(rows))
""")

md("""
**Lưu ý:** check chỉ có 40 ca, khoảng 19 ca nguy hiểm, nên 1 ca tương đương khoảng 5 điểm phần trăm. Chênh lệch dưới 3 ca được coi là nhiễu.

## Bước 6. Chuẩn hóa văn bản

Chat tiếng Việt thiếu dấu, nhiều viết tắt, có khi cố tình né từ khóa. Trước khi so khớp, mọi tin đi qua `normalizeForMatch`:

1. Chữ thường, bỏ dấu, `đ` thành `d`.
2. Gỡ chữ ngắt quãng (`c.h.u.y.ể.n`) và số thay chữ (`t1ền`).
3. Tách đơn vị tiền (`500k` thành `500 nghin`, `8tr` thành `8 trieu`).
4. Mở rộng viết tắt (`ck` thành `chuyen khoan`, `stk`, `ko`).
5. Sửa nghĩa theo ngữ cảnh (`nv` mặc định là nhân viên, sau "làm/nhận" là nhiệm vụ).
""")

code("""
show(pd.DataFrame(summary["normalizationExamples"]).rename(columns={"text": "Tin gốc (ví dụ tự tạo)", "normalized": "Sau chuẩn hóa"}))
""")

md("""
## Bước 7. Chia theo ngữ cảnh

Cùng một câu có thể bình thường hoặc nguy hiểm tùy ngữ cảnh. Vì vậy phân tích theo **5 cấp**, từ nhỏ đến lớn:

| Cấp | Đơn vị | Câu hỏi |
|---|---|---|
| Người nói | Tin `DP` hay `TOI` | Luật chỉ đọc lời đối phương |
| Tin | Từng tin | Tin nào làm mức tăng? |
| Đoạn | Giữa 2 mốc | Đoạn nào hội thoại đổi mức? |
| Giai đoạn | S0 tiếp cận → S4 ép buộc | Kịch bản đi đến đâu? |
| Hội thoại | Nhóm, quan hệ, nguồn, biến thể | Luật yếu ở loại nào? |

Luật nhiều khía cạnh dùng **cửa sổ 6 tin** của đối phương, vì kẻ gian thường rải kịch bản qua nhiều tin.

### 7.1. Kết quả tổng trên tune và check
""")

code("""
rows = []
for part in ("tune", "check"):
    m = summary["final"][part]
    rows.append({"Tập": part, "Số ca": m["n"], "Đúng mức": m["accuracy"], "Macro-F1": m["macroF1"], "Bỏ sót nguy hiểm": m["dangerMiss"], "Bắt đúng Nghiêm trọng": m["criticalRecall"], "Báo nhầm": m["falseAlarm"]})
show(pd.DataFrame(rows), pct=["Đúng mức", "Bỏ sót nguy hiểm", "Bắt đúng Nghiêm trọng", "Báo nhầm"], dec=["Macro-F1"])
heat(np.array(summary["final"]["tune"]["confusion"])[:, :4], [LEVEL_VI[l] for l in LEVELS], [LEVEL_VI[l] for l in LEVELS], "Luật chấm so với nhãn (tune)", "Luật chấm", "Nhãn")
""")

md("Ô dưới đường chéo là chấm **thấp hơn** nhãn, ô trên đường chéo là chấm **cao hơn** nhãn.\n\n### 7.2. Theo cấp hội thoại")

code("""
def relation_group(text):
    t = (text or "").lower()
    if "bị chiếm" in t or "giả người thân" in t: return "Người quen bị chiếm tài khoản"
    if any(w in t for w in ("công an", "cán bộ", "luật sư", "cơ quan", "ngân hàng", "thám tử")) and ("giả" in t or "lạ" in t or "xưng" in t): return "Giả cơ quan, người có thẩm quyền"
    if any(w in t for w in ("tuyển", "hướng dẫn", "cskh", "công ty", "nhà tuyển dụng")) and "thật" not in t and "nha_tuyen_dung" not in t: return "Người tuyển dụng, CSKH lạ"
    if any(w in t for w in ("người lạ", "người yêu", "tâm giao", "chim mồi", "người đòi nợ")): return "Người lạ, làm quen qua mạng"
    if any(w in t for w in ("fanpage", "người bán", "shipper", "nhà xe")) and "nguoi_ban" not in t: return "Bán hàng, dịch vụ lạ"
    if any(w in t for w in ("nha_tuyen_dung", "nhà tuyển dụng thật", "nguoi_ban", "dich_vu", "shop", "ngân hàng thật", "giáo viên", "chủ trọ")): return "Giao dịch, công việc có thật"
    if any(w in t for w in ("ban_be", "bạn", "nguoi_nha", "mẹ", "dì", "anh em", "dong_nghiep", "đồng nghiệp", "nguoi_quen", "người quen")): return "Người thân, bạn bè, đồng nghiệp thật"
    return "Chưa ghi quan hệ"

df["relation_group"] = df.relation.map(relation_group)
df["length_group"] = pd.cut(df.messages.map(len), [0, 8, 11, 12, 99], labels=["≤ 8 tin", "9–11 tin", "12 tin", "> 12 tin"]).astype(str)

def by_context(column, title):
    rows = []
    for key, part in df.groupby(column):
        rows.append({
            title: key, "Số ca": len(part), "Đúng mức": (part.gold == part.pred).mean(),
            "Ca nguy hiểm": int(part.danger.sum()), "Bị bỏ sót": int(part.missed_danger.sum()),
            "Ca bình thường": int(part.benign.sum()), "Bị báo nhầm": int(part.false_alarm.sum()),
        })
    show(pd.DataFrame(rows).sort_values("Số ca", ascending=False), pct=["Đúng mức"])

df["group_name"] = df.group.map(GROUP_VI)
df["source_name"] = df.sourceType.map(SOURCE_VI)
by_context("group_name", "Nhóm kịch bản")
by_context("relation_group", "Quan hệ")
by_context("source_name", "Nguồn dữ liệu")
by_context("length_group", "Độ dài")
danger = df[df.danger].groupby("group").agg(n=("id", "size"), miss=("missed_danger", "sum")).sort_values("miss")
barh([GROUP_VI[g] for g in danger.index], danger.miss.tolist(), "Ca nguy hiểm bị bỏ sót theo nhóm (tune)", [f"{m}/{n}" for m, n in zip(danger.miss, danger.n)])
""")

md("""
Quan hệ được rút gọn từ cột `quan_he` bằng quy tắc từ khóa, nên chỉ là nhóm gần đúng.

### 7.3. Theo cấp đoạn và cấp tin: tin nào làm mức tăng?

Từ các mốc, mỗi tin đối phương được gán **mức đúng tại thời điểm đó**. **Vùng kích hoạt** là các tin nằm giữa 2 mốc mà mức tăng lên. Đây là chỗ dấu hiệu thực sự xuất hiện, và là dữ liệu quý nhất để tìm luật.
""")

code("""
def build_messages():
    rows = []
    zones = []
    for _, c in df.iterrows():
        cps = sorted(c.checkpoints, key=lambda x: x["dpTurn"])
        dp = [m for m in c.messages if m["sender"] != "self"]
        prev_turn, prev_level = 0, "low"
        for cp in cps:
            if RANK[cp["level"]] > RANK[prev_level]:
                msgs = [m for m in dp if prev_turn < m["dpTurn"] <= cp["dpTurn"]]
                zones.append({
                    "id": c.id, "group": c.group, "from": prev_level, "to": cp["level"], "kind": c.kind, "size": len(msgs),
                    "covered": any(m["rules"] for m in msgs), "rules": sorted({r for m in msgs for r in m["rules"]}),
                    "text": " / ".join(m["text"] for m in msgs), "normalized": " / ".join(m["normalized"] for m in msgs), "turns": [m["dpTurn"] for m in msgs],
                    "pred_case": c.pred, "gold_case": c.gold,
                })
            prev_turn, prev_level = cp["dpTurn"], cp["level"]
        for m in dp:
            level = "low"
            for cp in cps:
                if cp["dpTurn"] <= m["dpTurn"]:
                    level = cp["level"]
            rows.append({"id": c.id, "group": c.group, "kind": c.kind, "benign": c.benign, "turn": m["dpTurn"], "level_at": level, "text": m["text"], "normalized": m["normalized"], "rules": m["rules"]})
    return pd.DataFrame(rows), pd.DataFrame(zones)

msg, zones = build_messages()
show(zones.groupby("to").agg(so_vung=("id", "size"), tin_trung_binh=("size", "mean")).reset_index().assign(to=lambda d: d.to.map(LEVEL_VI)).rename(columns={"to": "Mức tăng lên", "so_vung": "Số vùng kích hoạt", "tin_trung_binh": "Tin trung bình mỗi vùng"}), dec=["Tin trung bình mỗi vùng"])
first_danger = []
for _, c in df[df.danger].iterrows():
    turns = [cp["dpTurn"] for cp in c.checkpoints if RANK[cp["level"]] >= 2]
    if turns:
        first_danger.append(min(turns))
counts = Counter(first_danger)
keys = sorted(counts, reverse=True)
barh([f"Tin {k}" for k in keys], [counts[k] for k in keys], "Tin đối phương đầu tiên đạt mức nguy hiểm (nhãn, tune)", width=6)
""")

md("""
**Ý nghĩa:** nếu mức nguy hiểm xuất hiện trong vài tin đầu, luật theo từng tin là đủ. Nếu xuất hiện muộn, cần theo dõi diễn biến. Giới hạn: mốc không có ở mọi tin, nên vùng kích hoạt có thể gồm nhiều tin.

### 7.4. Theo cấp giai đoạn và theo dõi diễn biến
""")

code("""
stats = pd.json_normalize(df.stats)
total = stats.checkpointsTotal.sum()
show(pd.DataFrame([
    {"Chỉ số": "Đúng tại mốc", "Giá trị": f"{stats.checkpointsCorrect.sum()}/{total} ({stats.checkpointsCorrect.sum() / total:.1%})"},
    {"Chỉ số": "Mốc chấm thấp hơn nhãn", "Giá trị": str(int(stats.checkpointsUnder.sum()))},
    {"Chỉ số": "Mốc chấm cao hơn nhãn", "Giá trị": str(int(stats.checkpointsOver.sum()))},
    {"Chỉ số": "Ca nguy hiểm không bao giờ lên Cao", "Giá trị": str(int(stats.neverDetected.sum()))},
    {"Chỉ số": "Độ trễ phát hiện trung vị (tin)", "Giá trị": f"{stats.detectionDelay.dropna().median():.1f}"},
    {"Chỉ số": "Lượt báo động quá sớm", "Giá trị": str(int(stats.prematureAlarmTurns.sum()))},
    {"Chỉ số": "Số lần đổi chiều", "Giá trị": str(int(stats.directionChanges.sum()))},
    {"Chỉ số": "Hạ mức vô cớ", "Giá trị": str(int(stats.unwarrantedDrops.sum()))},
]))
stage_rows = []
for stage, part in df[df.kind == "scam"].groupby("stage"):
    stage_rows.append({"Giai đoạn cuối theo nhãn": stage, "Số ca": len(part), "Đúng mức": (part.gold == part.pred).mean(), "Bị bỏ sót": int(part.missed_danger.sum())})
show(pd.DataFrame(stage_rows), pct=["Đúng mức"])
""")

md("""
## Bước 8. Tìm mẫu ngôn ngữ từ dữ liệu

So sánh tin trong **vùng kích hoạt nguy hiểm** của ca lừa đảo với **tin đối phương trong ca bình thường**, dùng **log-odds có làm trơn** trên cụm 2–3 từ đã chuẩn hóa. Điểm càng cao thì cụm từ càng đặc trưng cho tin nguy hiểm.

Đây chỉ là gợi ý để người đọc: dữ liệu ít, nên phải đọc lại ngữ cảnh trước khi biến thành luật. **Không viết luật trực tiếp từ bảng này.**
""")

code("""
STOP = set("a anh ban cho chi co con cua da day de di do duoc em ma khi la lam minh mot nay nha nhe nhung nen ra roi se thi va vao voi a ha oi sao khong".split())

def ngrams(text):
    tokens = re.findall(r"[a-z0-9]+", text)
    grams = set()
    for size in (2, 3):
        for i in range(len(tokens) - size + 1):
            window = tokens[i:i + size]
            # Bỏ cụm toàn hư từ hoặc mở đầu, kết thúc bằng hư từ để bảng đỡ nhiễu
            if window[0] in STOP or window[-1] in STOP:
                continue
            grams.add(" ".join(window))
    return grams

danger_zone = zones[(zones.kind == "scam") & (zones.to.map(RANK) >= 2)]
benign_messages = msg[msg.benign]
pos = Counter(g for text in danger_zone.normalized for g in ngrams(text))
neg = Counter(g for text in benign_messages.normalized for g in ngrams(text))
n_pos, n_neg = len(danger_zone), len(benign_messages)

rows = []
for gram, count in pos.items():
    if count < 2:
        continue
    other = neg.get(gram, 0)
    score = math.log((count + 0.5) / (n_pos - count + 0.5)) - math.log((other + 0.5) / (n_neg - other + 0.5))
    rows.append({"Cụm từ": gram, "Vùng nguy hiểm": count, "Tin bình thường": other, "Điểm": score})
terms = pd.DataFrame(rows).sort_values(["Điểm", "Vùng nguy hiểm"], ascending=False)
show(terms.head(30), dec=["Điểm"])
print(f"Dữ liệu: {n_pos} vùng nguy hiểm, {n_neg} tin bình thường.")
""")

md("""
**Đọc bảng:** các cụm về `kich hoat`, `rut duoc`, `hoa hong`, `vao nhom`, `uy tin` và `thu tuc` xuất hiện trong vùng nguy hiểm nhưng không có trong tin bình thường của tune. Chúng gợi ý nhóm kịch bản CTV và thủ tục giả. Nhiều cụm chỉ có 2–3 lần nên chỉ để gợi ý, phải đọc bước 9–10 trước khi kết luận.

## Bước 9. Vùng phủ của bộ luật

### 9.1. Danh mục luật và tần suất

`Tune BT` là số ca bình thường trên tune có luật này. `SMS BT` là số tin bình thường thật trong SMS dev có luật này. Ngoài các luật này còn có tín hiệu từ thực thể (như link lạ) và từ sổ đối chiếu phát biểu (mâu thuẫn trước sau).
""")

code("""
tune_scam, tune_benign = Counter(), Counter()
for _, c in df.iterrows():
    target = tune_benign if c.benign else tune_scam
    target.update(c.signal_types)
sms_benign, sms_scam = Counter(), Counter()
for _, s in sms.iterrows():
    (sms_benign if s.kind == "benign" else sms_scam).update(set(s.rules))
inv = pd.DataFrame(summary["inventory"])
inv["Tune LĐ"] = inv.type.map(lambda t: tune_scam.get(t, 0))
inv["Tune BT"] = inv.type.map(lambda t: tune_benign.get(t, 0))
inv["SMS LĐ"] = inv.type.map(lambda t: sms_scam.get(t, 0))
inv["SMS BT"] = inv.type.map(lambda t: sms_benign.get(t, 0))
inv["Mức"] = inv.severity
inv = inv.sort_values(["Tune BT", "Tune LĐ"], ascending=False)
show(inv[["type", "ref", "category", "Mức", "mode", "Tune LĐ", "Tune BT", "SMS LĐ", "SMS BT"]].rename(columns={"type": "Luật", "ref": "Mã", "category": "Nhóm", "mode": "Kiểu"}))
print(f"Tổng {len(inv)} luật. Chưa từng bắn trên tune: {int(((inv['Tune LĐ'] + inv['Tune BT']) == 0).sum())}.")
print(f"SMS dev: {len(sms)} tin, {(sms.kind == 'benign').sum()} bình thường, {(sms.kind == 'scam').sum()} nhãn lừa đảo hoặc rác.")
""")

md("### 9.2. Vùng kích hoạt nguy hiểm mà luật chưa chạm tới\n\nMỗi dòng là một nơi nhãn nói mức tăng lên Cao hoặc Nghiêm trọng nhưng **không có luật nào bắn** trên các tin trong vùng. Đây là nguồn chính để tìm luật mới.")

code("""
cov = danger_zone.groupby("to").agg(so_vung=("id", "size"), co_luat=("covered", "sum")).reset_index()
cov["ty_le"] = cov.co_luat / cov.so_vung
show(cov.assign(to=cov.to.map(LEVEL_VI)).rename(columns={"to": "Mức", "so_vung": "Số vùng", "co_luat": "Có luật bắn", "ty_le": "Tỷ lệ phủ"}), pct=["Tỷ lệ phủ"])
uncovered = danger_zone[~danger_zone.covered]
pd.set_option("display.max_colwidth", None)
show(uncovered[["id", "group", "to", "turns", "text"]].rename(columns={"id": "Ca", "group": "Nhóm", "to": "Mức", "turns": "Tin", "text": "Nội dung vùng"}))
""")

md("""
## Bước 10. Phân tích lỗi

Mỗi lỗi được đọc thủ công trên tune và xếp vào một nguyên nhân gốc. Bảng này là **đánh giá của người phân tích**, cần nhóm xem lại.

### 10.1. Bỏ sót ca nguy hiểm
""")

code("""
MISS_CAUSE = {
    "V2_S08": ("Tống tiền", "Đe dọa phát tán ảnh, đòi tiền bằng USDT, không có từ khóa quen", "A"),
    "V2_S20": ("Đòi nợ, đe dọa", "Đe dọa gửi ảnh và gọi người thân; biến thể chưa có trong luật đòi nợ", "A"),
    "V2_S16": ("Xin mã", "Nói 'mã 6 số', 'đọc em mã đó' thay vì OTP", "B"),
    "V2_S10": ("Nạp tiền nhiệm vụ", "'Nạp tối thiểu', 'kích hoạt ví nhận lương' chưa khớp luật nạp tiền", "C"),
    "TT_CTV_007": ("Nạp tiền nhiệm vụ", "Giống S10", "C"),
    "V2_S19": ("Nạp tiền nhiệm vụ", "'Sản phẩm cao cấp', 'combo', 'hoàn 40%' không có chữ nạp tiền", "C"),
    "V2_S31": ("Người thân cần tiền gấp", "Chỉ bắt được chuyển tiền; chưa nhận ra kịch bản cấp cứu kèm tài khoản bị khóa", "D"),
    "V2_S32": ("Đặt cọc giữ chỗ", "'Chuyển khoản để giữ ghế' kèm hạn 30 phút không có tín hiệu nào", "D"),
    "V2_S33": ("Cài phần mềm", "Không có chữ .apk: 'tải phần mềm dịch vụ công', 'bật hết các quyền'", "D"),
    "V2_S29": ("Dụ đi nước ngoài", "Hộ chiếu, đi theo đoàn, đừng nói với thầy; ngôn ngữ nhẹ, không có từ khóa quen", "E"),
    "TT_CTV_008": ("Nghi nhãn", "Chỉ mời CTV và rủ qua Zalo nhưng nhãn Nghiêm trọng. Cần nhóm xem lại nhãn", "F"),
}
FIX_VI = {"A": "Đe dọa phát tán", "B": "Xin mã trá hình", "C": "Nạp tiền nhiệm vụ", "D": "Tiền gấp, giữ chỗ, cài phần mềm", "E": "Dụ đi xa, giữ bí mật", "F": "Xem lại nhãn"}
missed = df[df.missed_danger]
rows = []
for _, c in missed.iterrows():
    theme, cause, fix = MISS_CAUSE.get(c.id, ("Chưa xếp", "Chưa phân tích", "?"))
    rows.append({"Ca": c.id, "Nhãn": LEVEL_VI[c.gold], "Luật": LEVEL_VI[c.pred], "Kịch bản": theme, "Nguyên nhân": cause, "Nhóm sửa": FIX_VI.get(fix, fix), "Luật đã bắn": ", ".join(c.signal_types)})
show(pd.DataFrame(rows).sort_values(["Nhóm sửa", "Ca"]))
print(f"Bỏ sót {len(missed)}/{int(df.danger.sum())} ca nguy hiểm.")
""")

md("### 10.2. Chấm thấp một bậc: nhãn Nghiêm trọng, luật chấm Cao\n\nNhóm này không tính là bỏ sót, vì vẫn cảnh báo mạnh. Nhưng ở mức Nghiêm trọng sản phẩm mới bật hướng dẫn an toàn, nên vẫn cần xem.")

code("""
under = df[(df.gold == "critical") & (df.pred == "high")]
rows = []
for _, c in under.iterrows():
    dz = zones[(zones.id == c.id) & (zones.to == "critical")]
    rows.append({"Ca": c.id, "Nhóm": GROUP_VI.get(c.group), "Luật đã bắn": ", ".join(c.signal_types), "Đoạn lên Nghiêm trọng": " / ".join(dz.text)[:320]})
show(pd.DataFrame(rows))
""")

md("### 10.3. Báo nhầm ca bình thường")

code("""
FA_CAUSE = {
    "V2_BT_31": ("Tin đang cảnh báo về lừa đảo", "Người thân dặn nhau về chiêu giả công an, .apk", "G"),
    "V2_BT_36": ("Tin đang cảnh báo về lừa đảo", "Bàn về bài cảnh báo CTV, kẹt lệnh, thu hồi tiền", "G"),
    "V2_BT_35": ("Tin đang dặn không làm", "Hướng dẫn về mã OTP kèm lời dặn không chụp mã", "G"),
    "V2_BT_03": ("Phủ định", "'Không bao giờ giữ bản gốc' vẫn bắt thành giữ giấy tờ gốc", "H"),
    "V2_C07": ("Phủ định", "'Không mất bất kỳ khoản phí nào' vẫn bắt thành thu phí", "H"),
    "V2_BT_07": ("Mượn tiền thật", "Bạn thân mượn 1,5 triệu, có chi tiết riêng của hai người. Luật nghi tài khoản bị chiếm", "I"),
    "V2_BT_11": ("Mượn tiền thật", "Người quen mượn 2 triệu. Luật mượn tiền chỉ ở mức Cần chú ý", "I"),
    "V2_C11": ("Thu tiền hợp lệ", "Giáo viên nhắc đóng quỹ qua tài khoản phụ huynh", "I"),
    "V2_BT_10": ("Từ khóa trùng", "Luật tuyển CTV bắt nhầm chuyện chuyển tiền trọ", "J"),
    "V2_BT_28": ("Từ khóa trùng", "Shop hoàn tiền và nói 'ngay lập tức'", "J"),
    "V2_BT_32": ("Ngữ cảnh kỹ thuật", "Lập trình viên nói về màn hình OTP, eKYC", "K"),
}
FA_FIX = {"G": "Nhận ra tin cảnh báo", "H": "Sửa phủ định", "I": "Giao dịch quen biết, chấp nhận mức Cần chú ý", "J": "Siết luật cụ thể", "K": "Không sửa, tránh làm lỏng luật"}
fa = df[df.false_alarm]
rows = []
for _, c in fa.iterrows():
    theme, cause, fix = FA_CAUSE.get(c.id, ("Chưa xếp", "Chưa phân tích", "?"))
    rows.append({"Ca": c.id, "Luật chấm": LEVEL_VI[c.pred], "Kiểu": theme, "Nguyên nhân": cause, "Hướng xử lý": FA_FIX.get(fix, fix), "Luật đã bắn": ", ".join(c.signal_types)})
show(pd.DataFrame(rows).sort_values(["Hướng xử lý", "Ca"]))
print(f"Báo nhầm {len(fa)}/{int(df.benign.sum())} ca bình thường. Mức Cao trở lên: {int((fa.pred_rank >= 2).sum())} ca.")
""")

md("""
## Bước 11. Ứng viên luật và kiểm tra nhanh

Từ bước 8–10, mỗi nhóm lỗi được viết thành **mẫu thử** trên văn bản đã chuẩn hóa. Mẫu ở đây **chưa nằm trong sản phẩm**. Mỗi ứng viên được đo trên:

- **Tune lừa đảo:** số ca chứa mẫu, và bao nhiêu ca thuộc nhóm đang bị bỏ sót.
- **Tune bình thường:** số ca bình thường bị khớp. Càng thấp càng tốt.
- **SMS dev bình thường:** tin thật để kiểm tra báo nhầm, quan trọng vì ca tune ít.
""")

code("""
CANDIDATES = {
    "A. Đe dọa phát tán": [
        r"\\b(gui(?! tang)|phat tan|tung|dang|lan truyen)\\b.{0,30}\\b(anh|clip|video|hinh)\\b.{0,50}(lanh dao|co quan|nguoi than|gia dinh|dong nghiep|vo |chong |len mang|mang xa hoi)",
        r"(anh|clip|video|hinh)\\b.{0,50}(se duoc gui|gui thang|gui di|len mang)",
        r"(goi|bao|nhan tin)\\b.{0,12}cho\\b.{0,12}(nguoi than|dong nghiep|gia dinh|lanh dao)",
        r"tien doi lay im lang|het han.{0,30}(gui|dang|phat tan)",
    ],
    "B. Xin mã trá hình": [
        r"doc\\b.{0,20}\\b(ma|so)\\b.{0,20}(xac nhan|xac thuc|vua nhan|6 so|do)",
        r"(gui|cho|nhan)\\b.{0,12}\\bma\\b.{0,8}\\d\\s*so",
        r"\\bma\\s*\\d\\s*so\\b.{0,30}(doc|gui|cho em|cho minh|nhan)",
    ],
    "C. Nạp tiền nhiệm vụ": [
        r"nap\\b.{0,12}(toi thieu|it nhat)",
        r"(kich hoat|mo khoa)\\b.{0,12}\\b(vi|tai khoan)\\b.{0,25}(luong|hoa hong|nap|rut)",
        r"(don|san pham)\\b.{0,8}(cao cap|combo)\\b.{0,50}(hoan|thanh toan|lam du)",
        r"(nhom|don|san pham|nhiem vu)\\b.{0,50}\\bhoan\\b.{0,12}\\d+\\s*%",
        r"lam du\\b.{0,20}(combo|don|nhiem vu)",
    ],
    "C2. Nạp tiền leo thang": [
        r"\\b(nap|dong)\\b.{0,15}\\d+[.,]?\\d*\\s*(nghin|trieu).{0,40}\\b(hoan|thuong|hoa hong|rut)\\b",
        r"nap\\s+cang\\s+nhieu|don cang to",
        r"(gom tien|muon ban be|muon them|vay them)\\b.{0,50}\\bnap\\b",
    ],
    "D1. Người thân cần tiền gấp": [
        r"(chuyen khoan|gui tien|mo)\\b.{0,30}(so tai khoan|tai khoan)\\b.{0,15}(ban|nguoi|nay)\\b.{0,40}",
        r"(tai khoan|tk|ung dung)\\b.{0,15}(con|em|anh|chi)?\\b.{0,12}bi khoa\\b",
        r"(dong tien vien|vien phi|phong mo|cap cuu|tai nan)\\b.{0,80}(chuyen khoan|chuyen tien|gui tien)",
        r"(chuyen khoan|chuyen tien)\\b.{0,80}(dong tien vien|vien phi|phong mo|cap cuu|tai nan)",
    ],
    "D2. Đặt cọc giữ chỗ": [
        r"(chuyen khoan|chuyen tien|coc|dat coc)\\b.{0,40}giu\\b.{0,8}(ghe|cho|phong|ve|suat|hang)",
        r"giu\\b.{0,8}(ghe|cho|suat)\\b.{0,30}(chuyen khoan|coc)",
        r"qua\\s+\\d+\\s*phut\\b.{0,30}(ban|huy|mat)",
    ],
    "D3. Cài phần mềm, cấp quyền": [
        r"\\b(tai|cai|cai dat)\\s+(lai\\s+)?(phan mem|ung dung|app)\\b.{0,50}(cap nhat|dich vu cong|vneid|thue|bao hiem)",
        r"\\bbat\\s+(het|tat ca|toan bo)\\s+(cac\\s+)?quyen",
        r"(link|duong dan)\\b.{0,20}\\btai\\s+(phan mem|ung dung|app)",
    ],
    "E. Dụ đi xa, giữ bí mật": [
        r"chuan bi\\b.{0,12}ho chieu",
        r"di theo doan|bay cung doan|xuat canh",
        r"(dung|khong)\\b.{0,8}(noi|bao|ke)\\b.{0,10}(voi|cho)\\b.{0,8}(thay|co|bo me|gia dinh|nguoi nha|ai)",
        r"(luong|thu nhap)\\b.{0,25}\\d+\\s*trieu.{0,40}(bao an|nuoc ngoai|khong can ngoai ngu)",
    ],
}

def compile_candidate(patterns):
    return [re.compile(p) for p in patterns]

COMPILED = {k: compile_candidate(v) for k, v in CANDIDATES.items()}
def hits(name, text):
    return any(p.search(text) for p in COMPILED[name])

rows = []
for name in CANDIDATES:
    case_hits = msg[msg.normalized.map(lambda t: hits(name, t))]
    scam_ids = set(case_hits[~case_hits.benign].id)
    benign_ids = set(case_hits[case_hits.benign].id)
    miss_ids = sorted(scam_ids & set(missed.id))
    under_ids = sorted(scam_ids & set(under.id))
    sms_hit = sms[sms.normalized.map(lambda t: hits(name, t))]
    rows.append({
        "Ứng viên": name, "Ca lừa đảo": len(scam_ids), "Ca bỏ sót bắt được": len(miss_ids), "Danh sách ca bỏ sót": ", ".join(miss_ids), "Ca chấm thấp một bậc": len(under_ids),
        "Ca bình thường bị khớp": len(benign_ids), "Danh sách ca bình thường": ", ".join(sorted(benign_ids)), "SMS BT bị khớp": int((sms_hit.kind == "benign").sum()), "SMS LĐ khớp": int((sms_hit.kind == "scam").sum()),
    })
candidate_table = pd.DataFrame(rows)
show(candidate_table)
any_new = set().union(*[set(msg[(~msg.benign) & msg.normalized.map(lambda t: hits(n, t))].id) for n in CANDIDATES])
caught = sorted(any_new & set(missed.id))
remain = sorted(set(missed.id) - any_new)
benign_any = set().union(*[set(msg[msg.benign & msg.normalized.map(lambda t: hits(n, t))].id) for n in CANDIDATES])
display(Markdown(f"Tất cả ứng viên chạm tới **{len(caught)}/{len(missed)}** ca bỏ sót trên tune. Còn lại: {', '.join(remain) or 'không'}. Có **{len(benign_any)}/{int(df.benign.sum())}** ca bình thường bị khớp ít nhất một mẫu."))
""")

md("### Nội dung bị khớp nhầm, cần đọc trước khi đưa vào luật")

code("""
rows = []
for name in CANDIDATES:
    for _, m in msg[msg.benign & msg.normalized.map(lambda t: hits(name, t))].iterrows():
        rows.append({"Ứng viên": name, "Nguồn": m.id, "Nội dung": m.text[:190]})
    for _, s in sms[(sms.kind == "benign") & sms.normalized.map(lambda t: hits(name, t))].head(5).iterrows():
        rows.append({"Ứng viên": name, "Nguồn": "SMS dev", "Nội dung": s.text[:190]})
if rows:
    show(pd.DataFrame(rows))
else:
    print("Không có.")
""")

md("""
### Giảm báo nhầm: nhận ra tin cảnh báo và câu phủ định

Khác với luật mới, đây là **mẫu loại trừ**: tin khớp mẫu thì không dùng làm bằng chứng cho luật. Rủi ro là kẻ gian có thể chèn câu cảnh báo để né luật, nên cần đo xem mẫu có đụng vào bằng chứng của ca lừa đảo không.
""")

code("""
EXCLUDE = {
    "G. Tin cảnh báo về lừa đảo": [
        r"(canh giac|canh bao|chieu lua dao|thu doan|chieu tro|tinh trang lua dao|bai canh bao)",
        r"\\b(gia danh|lua dao|ke gian|chung no)\\b.{0,80}(dung|dan|nhac|canh)",
        r"(khong bao gio|tuyet doi khong)\\b.{0,50}(lam viec qua|doi chuyen|yeu cau chuyen|chup anh|doc ma|cung cap)",
    ],
    "H. Phủ định mở rộng": [
        r"(khong|chang|mien)\\s+(mat|thu|can|phai|co)\\s+(bat ky|bat cu|mot|khoan|dong)?\\s*(khoan\\s+)?(phi|tien|chi phi|le phi)",
        r"(khong bao gio|tuyet doi khong|khong)\\s+(giu|thu|lay)\\b.{0,15}(ban goc|giay to|can cuoc|cccd)",
    ],
}
COMPILED_EX = {k: [re.compile(p) for p in v] for k, v in EXCLUDE.items()}
rows = []
evidence = msg[msg.rules.map(len) > 0]
for name, patterns in COMPILED_EX.items():
    matched = evidence[evidence.normalized.map(lambda t: any(p.search(t) for p in patterns))]
    fa_ids = sorted(set(matched[matched.id.isin(fa.id)].id))
    scam_ids = sorted(set(matched[~matched.benign].id))
    rows.append({"Mẫu loại trừ": name, "Tin bằng chứng bị loại": len(matched), "Ca báo nhầm được hỗ trợ": ", ".join(fa_ids), "Ca lừa đảo bị ảnh hưởng (phải bằng 0 hoặc đọc kỹ)": ", ".join(scam_ids)})
show(pd.DataFrame(rows))
risky = evidence[(~evidence.benign) & evidence.normalized.map(lambda t: any(p.search(t) for ps in COMPILED_EX.values() for p in ps))]
if len(risky):
    show(risky[["id", "turn", "text", "rules"]].assign(text=lambda d: d.text.str[:200]))
""")

md("""
### Kết quả bước 11: danh sách đề xuất để nhóm duyệt

| # | Luật đề xuất | Mức | Cách làm | Kịch bản nhắm tới | Điều cần cẩn thận |
|---:|---|---|---|---|---|
| 1 | Đe dọa phát tán ảnh, thông tin | Nghiêm trọng | Luật mới. Đe dọa gửi ảnh cho người thân, cơ quan; có đòi tiền thì chắc chắn hơn | Tống tiền, đòi nợ | Dùng đúng định nghĩa mức Nghiêm trọng |
| 2 | Xin mã trá hình | Cao | Mở rộng `otp_password_request` | Đọc mã 6 số, đăng nhập xác thực | Tin ngân hàng dặn "không chia sẻ mã" |
| 3 | Nạp tiền nhiệm vụ | Cao | Mở rộng `task_deposit` | Nạp tối thiểu, kích hoạt ví, combo, hoàn % | Khuyến mãi nạp thẻ của nhà mạng |
| 4 | Nạp tiền leo thang | Nghiêm trọng khi đã có nạp trước đó | Mở rộng `task_freeze_extortion` | Đóng 3 triệu thưởng 4,5 triệu, gom tiền nạp thêm | Khuyến mãi hoàn tiền thật |
| 5 | Người thân cần tiền gấp | Cao | Mở rộng `account_takeover_borrow` | Cấp cứu, tài khoản bị khóa, chuyển vào tài khoản người khác | Người quen mượn thật đã xác minh |
| 6 | Đặt cọc giữ chỗ có hạn giờ | Cao | Luật mới, cần 2 khía cạnh | Giữ ghế, giữ phòng, quá 30 phút sẽ bán | Shop thật có COD |
| 7 | Cài phần mềm và cấp quyền | Nghiêm trọng | Mở rộng `malware_apk` khi không có chữ `.apk` | Tải phần mềm dịch vụ công, bật hết các quyền | Tin cảnh báo của cơ quan |
| 8 | Dụ đi xa | Cao, lên Nghiêm trọng khi kèm giữ bí mật | Mở rộng `urgent_relocation`, `secrecy_general` | Hộ chiếu, đi theo đoàn, đừng nói với thầy | HR thật yêu cầu hộ chiếu khi đi công tác |
| 9 | Nhận ra tin cảnh báo | Giảm báo nhầm | Loại trừ trong các luật liên quan, chỉ khi tin không yêu cầu người nhận làm gì | Người thân dặn nhau về chiêu lừa đảo | Kẻ gian chèn câu cảnh báo để né luật, phải có tình huống thử |
| 10 | Mở rộng phủ định | Giảm báo nhầm | Sửa `NEGATION` trong `rule.ts` | Không mất bất kỳ khoản phí nào, không giữ bản gốc | Câu vừa phủ định vừa đòi tiền, ví dụ "không mất phí, chỉ cần cọc" |

**Không đề xuất sửa:** `V2_BT_32` (lập trình viên nói về OTP) và ca người quen mượn tiền số nhỏ. Sửa theo các ca này dễ làm luật lỏng đi. **Cần nhóm xem lại nhãn:** `TT_CTV_008`.

## Bước 12. Quy trình cải tiến và tiêu chí nghiệm thu
""")

md("""
Phần dưới đây là cách thực hiện các đề xuất trên.

**Thứ tự làm với mỗi ứng viên:**

1. Viết tình huống thử theo cặp trong `fixtures/scenarios.json`: một ca lừa đảo cần bắt, một ca bình thường dễ nhầm.
2. Viết luật trong `packages/core/src/rules/`, ưu tiên mẫu theo ý nghĩa, dùng `negatable` và `exclude` khi cần.
3. Chạy `npm run check`: tình huống mới đạt, không ca cũ nào trượt.
4. Chạy `npm run bench:analyze-rules` rồi đọc lại notebook này.
5. Xem số tổng trên check. Không đọc nội dung ca check.
6. Commit từng nhóm sửa để biết nhóm nào có tác dụng.

**Tiêu chí nghiệm thu một luật mới:**

| Tiêu chí | Điều kiện |
|---|---|
| Có tác dụng | Bắt thêm ít nhất 1 ca bỏ sót hoặc ca chấm thấp trên tune |
| Không báo nhầm thêm | Không tăng ca bình thường bị báo nhầm trên tune, fixtures |
| An toàn trên tin thật | SMS dev bình thường không tăng quá 3 tin. Nếu tăng thì đọc từng tin |
| Giải thích được | Có tiêu đề, giải thích, việc nên làm bằng tiếng Việt |
| Mức đúng định nghĩa | `critical` chỉ dùng cho đe dọa, cưỡng ép, kiểm soát, mã độc |

**Dừng khi:** đã sửa đủ các nhóm đã duyệt, hoặc check không còn tăng thêm ít nhất 3 ca, hoặc đến giờ đóng băng.

**Thước đo chung** (số dev, đo lại sau mỗi đợt):
""")

code("""
m = summary["final"]
base = pd.DataFrame([
    {"Chỉ số": "Đúng mức", "Tune": m["tune"]["accuracy"], "Check": m["check"]["accuracy"]},
    {"Chỉ số": "Bỏ sót nguy hiểm", "Tune": m["tune"]["dangerMiss"], "Check": m["check"]["dangerMiss"]},
    {"Chỉ số": "Bắt đúng Nghiêm trọng", "Tune": m["tune"]["criticalRecall"], "Check": m["check"]["criticalRecall"]},
    {"Chỉ số": "Báo nhầm", "Tune": m["tune"]["falseAlarm"], "Check": m["check"]["falseAlarm"]},
])
show(base, pct=["Tune", "Check"])
print(f"Phiên bản luật: {summary['rulesCommit']}")
""")

md("""
## Bước 13. Kết quả sau khi làm 10 đề xuất

Đo cùng bộ đề, cùng tập đã khóa. **Check chỉ xem số tổng, không đọc nội dung ca.**
""")

code("""
rows = []
for part in ("tune", "check"):
    b, a = summary["final"][part], summary_after["final"][part]
    for label, key in (("Đúng mức", "accuracy"), ("Bỏ sót nguy hiểm", "dangerMiss"), ("Bắt đúng Nghiêm trọng", "criticalRecall"), ("Báo nhầm", "falseAlarm")):
        rows.append({"Tập": part, "Chỉ số": label, "Trước": b[key], "Sau": a[key]})
compare = pd.DataFrame(rows)
compare["Thay đổi (điểm %)"] = (compare["Sau"] - compare["Trước"]) * 100
show(compare, pct=["Trước", "Sau"], dec=["Thay đổi (điểm %)"])

def sms_stats(frame, kind):
    part = frame[frame.kind == kind]
    return int((part.pred != "low").sum()), len(part)

show(pd.DataFrame([
    {"SMS dev (tin thật)": "Tin bình thường bị cảnh báo", "Trước": f"{sms_stats(sms, 'benign')[0]}/{sms_stats(sms, 'benign')[1]}", "Sau": f"{sms_stats(sms_after, 'benign')[0]}/{sms_stats(sms_after, 'benign')[1]}"},
    {"SMS dev (tin thật)": "Tin lừa đảo, rác có cảnh báo", "Trước": f"{sms_stats(sms, 'scam')[0]}/{sms_stats(sms, 'scam')[1]}", "Sau": f"{sms_stats(sms_after, 'scam')[0]}/{sms_stats(sms_after, 'scam')[1]}"},
]))

before_by_id = {c["id"]: c for c in cases}
rows = []
for c in cases_after:
    old = before_by_id[c["id"]]
    if old["pred"] != c["pred"]:
        rows.append({"Ca": c["id"], "Loại": "Lừa đảo" if c["kind"] == "scam" else "Bình thường", "Nhãn": LEVEL_VI[c["gold"]], "Trước": LEVEL_VI[old["pred"]], "Sau": LEVEL_VI[c["pred"]]})
show(pd.DataFrame(rows))
remain_miss = [c["id"] for c in cases_after if RANK[c["gold"]] >= 2 and RANK[c["pred"]] < 2]
remain_fa = [c["id"] for c in cases_after if c["kind"] != "scam" and RANK[c["pred"]] >= 1]
display(Markdown(f"**Tune còn bỏ sót:** {', '.join(remain_miss) or 'không'}. **Tune còn báo nhầm:** {', '.join(remain_fa) or 'không'}."))
""")

md("""
### Đọc kết quả: luật mới chưa tổng quát

- **Trên tune cải thiện rất mạnh, trên check bỏ sót gần như không đổi.** Đây là dấu hiệu rõ của việc luật khớp với những ca đã đọc. Con số tune **không được dùng làm thành tích**.
- **Báo nhầm giảm trên cả tune lẫn check**, và SMS thật không tăng báo nhầm. Các sửa về phủ định và tin cảnh báo có vẻ tổng quát hơn.
- **SMS dev bắt thêm được một ít** tin lừa đảo, rác mà không tăng báo nhầm.
- **Kết luận cho kế hoạch:** theo điều kiện dừng ở bước 12, không tiếp tục thêm luật theo từng ca. Viết thêm mẫu câu rất khó đuổi kịp cách nói mới, nên phần bỏ sót còn lại là chỗ cần đo tác dụng của AI. Vẫn phải đo, không mặc định AI tốt hơn.

## Bước 14. Thử các hướng suy luận khác, có ghi sổ

Sau khi thấy check không đổi, nhóm thử 3 hướng. Mỗi hướng là một thí nghiệm có giả thuyết viết trước, lưu ở `research/experiments/`. Hướng nào không có lý do chọn trên tune thì **không xem check**, để giữ check cho lần xác nhận thật.
""")

code("""
rows = []
looks = 0
for path in sorted((ROOT / "experiments").glob("EXP-*/metrics.json")):
    r = json.loads(path.read_text(encoding="utf-8"))
    looks += 1 if r.get("checkViewed") else 0
    t, c, s = r.get("tune") or {}, r.get("check") or {}, r.get("sms") or {}
    rows.append({
        "Mã": r["id"], "Nội dung": r["title"], "Tune bỏ sót": t.get("dangerMissCount", "–"), "Tune báo nhầm Cao+": t.get("falseAlarmHighCount", "–"),
        "Check bỏ sót": c.get("dangerMissCount", "chưa xem"), "SMS BT Cao+": f"{s['benignHigh']:.1%}" if s else "–", "SMS LĐ Cao+": f"{s['scamHigh']:.1%}" if s else "–", "Lần xem check": looks,
    })
show(pd.DataFrame(rows))
leak = json.loads((ROOT / "experiments" / "EXP-006" / "metrics.json").read_text(encoding="utf-8"))
loso = json.loads((ROOT / "experiments" / "EXP-004" / "metrics.json").read_text(encoding="utf-8"))["leaveOneScenarioOut"]
caught = sum(v["caught"] for v in loso.values())
total = sum(v["n"] for v in loso.values())
audit = json.loads((ROOT / "experiments" / "label_audit.json").read_text(encoding="utf-8"))
display(Markdown(
    f"**Kiểm tra rò rỉ:** nhãn nguy hiểm trùng với nguồn chuyển thể ở **{leak['dangerEqualsAdaptedSource']:.1%}** ca. Mô hình đoán đúng nguồn **{leak['sourcePredictionAccuracy']:.1%}** chỉ từ chữ. "
    f"Bỏ ca AI sinh khi huấn luyện thì báo nhầm **{leak['aiGeneratedBenignFalseAlarm']}** ca đó. Với kịch bản chưa thấy, mô hình bắt được **{caught}/{total}**.\\n\\n"
    f"**Đồng thuận nhãn theo nguồn:** toàn bộ κ = {audit['all']['kappa']:.3f}, riêng phần chuyển thể κ = {audit['bySource']['chuyen_the']['kappa']:.3f}. Hai phần còn lại κ không có ý nghĩa vì gần như cùng một nhãn."
))
""")

md("""
**Kết luận:**

| Hướng | Kết quả | Quyết định |
|---|---|---|
| Thêm mẫu câu | Tune tốt, check không đổi | Dừng thêm theo từng ca. Giữ phần giảm báo nhầm |
| Khung ý định (yêu cầu + cớ + sức ép) | Tệ hơn luật trên tune, báo nhầm cao trên SMS thật | Bỏ |
| Mô hình học từ dữ liệu | Số đẹp nhưng chủ yếu học văn phong nguồn | Bỏ trên dữ liệu hiện tại |
| Mô hình ngôn ngữ kèm gợi ý từ luật | Chưa đo. Không cần huấn luyện trên bộ này nên ít bị lỗi học văn phong hơn, nhưng vẫn phải đo | **Hướng tiếp theo**, sau khi có Bedrock |

**Phát hiện quan trọng nhất của cả quy trình:** bộ đề cần **cặp đối chứng cùng văn phong** trước khi kết luận về bất kỳ mô hình nào. Check có cùng lỗi với tune nên không phát hiện được việc này. Cách giảm từng hạn chế ở `research/experiments/GIAM_HAN_CHE.md`.

## Hạn chế cần nói rõ khi báo cáo

1. **Nhãn trùng với nguồn dữ liệu:** ca nguy hiểm gần như đều chuyển thể, ca bình thường gần như đều tự viết hoặc AI sinh. Số của mô hình trên bộ này chưa đáng tin.
2. **Bộ v2 chưa độc lập:** phần lớn ca do người viết luật chuyển thể. Mọi số ở đây là số dev.
3. **Nhãn:** mức chốt luôn theo người A, mốc thực chất do một người gán, 12 ca đối chứng do AI sinh, 36 ca bình thường nghi có khuôn sinh tự động. Riêng phần chuyển thể κ = 0,788.
4. **Mẫu nhỏ:** nhiều nhóm chỉ vài ca, nên số theo nhóm chỉ để định hướng.
5. **Đo trên dữ liệu đã đọc:** luật viết từ chính tune nên số tune đẹp hơn thực tế, đúng như check đã cho thấy. Check cũng đã xem nhiều lần, số lần được ghi trong sổ thí nghiệm.
6. **Không suy rộng:** dữ liệu chủ yếu là kịch bản đã được công khai, có thể khác lừa đảo chưa được ghi nhận.
7. **Phân tích nguyên nhân là đánh giá của người phân tích**, không phải đo tự động.

## Xem một ca

Trong bản notebook có thể gọi `xem('V2_S08')` để đọc toàn bộ hội thoại của một ca thuộc tune. Dấu `*` là tin luật dùng làm bằng chứng.
""")

code("""
def xem(case_id):
    c = df[df.id == case_id].iloc[0]
    print(f"{c.id} | {GROUP_VI.get(c.group)} | {c.kind} | nhãn {c.gold} | luật {c.pred} | {c.signal_types}")
    print(f"Bối cảnh: {c.context}")
    print(f"Mốc: {c.checkpoints}")
    for m in c.messages:
        who = {"self": "TOI", "other": "DP ", "unknown": "?  "}[m["sender"]]
        print(f"{'*' if m['rules'] else ' '} {who} {m['text']}")
""")

out = Path(__file__).parent / "phan_tich_luat.ipynb"
nbf.write(nb, out)
print(f"Đã ghi {out}")
