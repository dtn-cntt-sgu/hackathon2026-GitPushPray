"""Thử nghiệm: mô hình học trên SMS thật (dev) có dùng được cho hội thoại không.

Lý do thử: EXP-006 cho thấy huấn luyện trên bộ v2 chủ yếu học văn phong nguồn. Học trên SMS không dính lỗi đó,
vì tin lừa đảo và tin bình thường cùng từ một nguồn. Chỉ dùng SMS dev, không đụng test SMS, không xem check.
Chỉ ghi số tổng, không in nội dung tin.
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedKFold

sys.path.insert(0, str(Path(__file__).parent))
from ml_baseline import ROOT, SEED, commit, is_danger, model, scores, strip  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
ID = "EXP-007"


def text_of(case):
    return strip(" ".join(m["text"] for m in case["messages"]))


def main():
    out = ROOT / "experiments" / ID
    if (out / "metrics.json").exists():
        raise SystemExit(f"{ID} đã có, không ghi đè")

    sms_all = json.loads((ROOT / "data" / "external" / "sms" / "cases.json").read_text(encoding="utf-8"))
    dev_ids = set(json.loads((ROOT / "data" / "external" / "sms" / "split.json").read_text(encoding="utf-8"))["dev"])
    sms = [c for c in sms_all if c["id"] in dev_ids]
    docs = np.array([text_of(c) for c in sms], dtype=object)
    y = np.array([int(c["kind"] == "scam") for c in sms])

    # Kiểm định chéo trong SMS: mức tốt nhất của cách này trên đúng miền dữ liệu
    preds = np.zeros(len(sms), dtype=int)
    for train, test in StratifiedKFold(5, shuffle=True, random_state=SEED).split(docs, y):
        preds[test] = model().fit(docs[train], y[train]).predict(docs[test])
    sms_recall = float(preds[y == 1].mean())
    sms_false_alarm = float(preds[y == 0].mean())

    # Áp sang hội thoại v2 (tune): chấm từng tin của đối phương, lấy tin cao nhất
    clf = model().fit(docs, y)
    split = json.loads((ROOT / "splits" / "set_v2_tune_check.json").read_text(encoding="utf-8"))
    cases = json.loads((ROOT / "data" / "sets" / "v2" / "cases.json").read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in cases}
    tune = [by_id[i] for i in split["tune"]]

    def max_prob(case):
        msgs = [strip(m["text"]) for m in case["messages"] if m["sender"] != "self"]
        return float(clf.predict_proba(msgs)[:, 1].max()) if msgs else 0.0

    probs = [max_prob(c) for c in tune]
    by_threshold = {}
    for thr in (0.5, 0.6, 0.7, 0.8, 0.9):
        by_threshold[str(thr)] = scores(tune, [int(p >= thr) for p in probs])
    danger = [p for c, p in zip(tune, probs) if is_danger(c)]
    benign = [p for c, p in zip(tune, probs) if c["kind"] != "scam"]

    record = {
        "id": ID,
        "date": date.today().isoformat(),
        "title": "Mô hình học trên SMS thật, áp sang hội thoại",
        "hypothesis": "SMS không có lỗi nhãn trùng nguồn như bộ v2, nên mô hình học trên SMS có thể phát hiện dấu hiệu thật. Rủi ro: SMS là tin lẻ, nhãn gộp cả quảng cáo, khác miền hội thoại.",
        "method": "ML ký tự TF-IDF + hồi quy logistic, học trên SMS dev",
        "rulesCommit": commit(),
        "dataset": "ext:sms/dev để học, set:v2 tune để thử",
        "splitSha256": split["sha256"],
        "checkViewed": False,
        "tune": by_threshold["0.5"],
        "tuneByThreshold": by_threshold,
        "probabilityMean": {"danger": float(np.mean(danger)), "benign": float(np.mean(benign))},
        "check": None,
        "smsCrossValidation": {"recall": sms_recall, "falseAlarm": sms_false_alarm, "n": len(sms)},
        "sms": {"benignHigh": sms_false_alarm, "scamHigh": sms_recall, "n": len(sms), "note": "Kiểm định chéo trong SMS dev"},
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "metrics.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: record[k] for k in ("smsCrossValidation", "probabilityMean", "tuneByThreshold")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
