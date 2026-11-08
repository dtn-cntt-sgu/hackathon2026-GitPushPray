"""Mô hình học máy đơn giản để đo khả năng tổng quát của cách học từ dữ liệu.

Không dùng trong sản phẩm. Dự đoán nhị phân: ca có từ mức Cao trở lên hay không.
Đánh giá trên tune bằng kiểm định chéo theo nguồn, và thử KỊCH BẢN CHƯA THẤY bằng cách bỏ hẳn một nhóm khi huấn luyện.

Cách chạy:
  python research/ml_baseline.py --id EXP-004 --title "..." --hypothesis "..." [--check] [--with-rules EXP-001]
Script chỉ in và ghi số tổng, không in nội dung hội thoại.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).parent
SEED = 20261107


def strip(text):
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def doc(case):
    return strip(" . ".join(m["text"] for m in case["messages"] if m["sender"] != "self"))


def source_group(case):
    return case["source"] if re.match(r"chuyen_the:https?:", case["source"]) else case["id"]


def is_danger(case):
    return int(case["gold"] in ("high", "critical"))


def model():
    return make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=2, sublinear_tf=True),
        LogisticRegression(C=2.0, class_weight="balanced", max_iter=2000),
    )


def scores(cases, preds):
    danger = [p for c, p in zip(cases, preds) if is_danger(c)]
    benign = [p for c, p in zip(cases, preds) if c["kind"] != "scam"]
    miss = sum(1 for p in danger if not p)
    alarm = sum(1 for p in benign if p)
    return {
        "n": len(cases),
        "accuracy": None,
        "macroF1": None,
        "dangerMiss": miss / len(danger) if danger else 0,
        "dangerMissCount": f"{miss}/{len(danger)}",
        "criticalRecall": None,
        "falseAlarm": None,
        "falseAlarmHigh": alarm / len(benign) if benign else 0,
        "falseAlarmHighCount": f"{alarm}/{len(benign)}",
    }


def cross_validate(cases, repeats=5):
    """Kiểm định chéo theo nguồn, lặp với nhiều seed vì mẫu nhỏ. Trả về đa số phiếu và độ dao động."""
    y = np.array([is_danger(c) for c in cases])
    groups = np.array([source_group(c) for c in cases])
    docs = np.array([doc(c) for c in cases], dtype=object)
    votes = np.zeros(len(cases))
    misses, alarms = [], []
    for seed in range(repeats):
        fold_preds = np.zeros(len(cases), dtype=int)
        for train, test in StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED + seed).split(docs, y, groups):
            fold_preds[test] = model().fit(docs[train], y[train]).predict(docs[test])
        votes += fold_preds
        s = scores(cases, fold_preds.tolist())
        misses.append(s["dangerMiss"])
        alarms.append(s["falseAlarmHigh"])
    return (votes >= repeats / 2).astype(int).tolist(), {
        "repeats": repeats,
        "dangerMissMean": float(np.mean(misses)),
        "dangerMissMin": float(np.min(misses)),
        "dangerMissMax": float(np.max(misses)),
        "falseAlarmHighMean": float(np.mean(alarms)),
    }


def leave_one_scenario_out(cases):
    """Bỏ hẳn một nhóm kịch bản lừa đảo khi huấn luyện, đo tỷ lệ bắt được trên chính nhóm đó."""
    out = {}
    all_groups = sorted({c["group"] for c in cases if c["kind"] == "scam"})
    for g in all_groups:
        train = [c for c in cases if c["group"] != g]
        test = [c for c in cases if c["group"] == g and is_danger(c)]
        if not test:
            continue
        clf = model().fit([doc(c) for c in train], [is_danger(c) for c in train])
        preds = clf.predict([doc(c) for c in test])
        out[str(g)] = {"n": len(test), "caught": int(preds.sum())}
    return out


def load_rule_preds(exp):
    path = ROOT / "results" / "experiments" / exp / "preds.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    rank = {"low": 0, "attention": 1, "high": 2, "critical": 3}
    return {p["caseId"]: int(rank[p["pred"]] >= 2) for part in ("tune", "check") for p in data[part]}


def commit():
    try:
        out = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
        dirty = subprocess.check_output(["git", "status", "--porcelain", "research/ml_baseline.py"], text=True).strip()
        return out + ("+dirty" if dirty else "")
    except Exception:
        return "unknown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--hypothesis", required=True)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--with-rules", default=None, help="Kết hợp: cảnh báo khi luật của thí nghiệm này HOẶC mô hình báo Cao")
    args = ap.parse_args()

    exp_dir = ROOT / "experiments" / args.id
    if (exp_dir / "metrics.json").exists():
        raise SystemExit(f"{args.id} đã có, không ghi đè")

    split = json.loads((ROOT / "splits" / "set_v2_tune_check.json").read_text(encoding="utf-8"))
    cases = json.loads((ROOT / "data" / "sets" / "v2" / "cases.json").read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in cases}
    tune = [by_id[i] for i in split["tune"]]
    check = [by_id[i] for i in split["check"]]

    cv_preds, cv_info = cross_validate(tune)
    loso = leave_one_scenario_out(tune)
    final = model().fit([doc(c) for c in tune], [is_danger(c) for c in tune])

    rule = load_rule_preds(args.with_rules) if args.with_rules else None
    combine = (lambda c, p: int(p or rule.get(c["id"], 0))) if rule else (lambda c, p: int(p))

    tune_preds = [combine(c, p) for c, p in zip(tune, cv_preds)]
    check_part = None
    if args.check:
        check_preds = [combine(c, p) for c, p in zip(check, final.predict([doc(c) for c in check]).tolist())]
        check_part = scores(check, check_preds)

    sms_cases = json.loads((ROOT / "data" / "external" / "sms" / "cases.json").read_text(encoding="utf-8"))
    dev_ids = set(json.loads((ROOT / "data" / "external" / "sms" / "split.json").read_text(encoding="utf-8"))["dev"])
    sms_dev = [c for c in sms_cases if c["id"] in dev_ids]
    sms_pred = final.predict([doc(c) for c in sms_dev])
    sms_benign = [p for c, p in zip(sms_dev, sms_pred) if c["kind"] != "scam"]
    sms_scam = [p for c, p in zip(sms_dev, sms_pred) if c["kind"] == "scam"]

    method = "ML ký tự TF-IDF + hồi quy logistic" + (f" HOẶC luật {args.with_rules}" if rule else "")
    record = {
        "id": args.id,
        "date": date.today().isoformat(),
        "title": args.title,
        "hypothesis": args.hypothesis,
        "method": method,
        "rulesCommit": commit(),
        "dataset": "set:v2",
        "splitSha256": split["sha256"],
        "checkViewed": bool(args.check),
        "tune": scores(tune, tune_preds),
        "tuneNote": "Số tune là kiểm định chéo theo nguồn, mô hình không thấy ca đang chấm",
        "crossValidation": cv_info,
        "leaveOneScenarioOut": loso,
        "check": check_part,
        "sms": {"benignHigh": float(np.mean(sms_benign)), "scamHigh": float(np.mean(sms_scam)), "n": len(sms_dev), "note": "Chỉ mô hình, chưa kết hợp luật"},
    }
    exp_dir.mkdir(parents=True, exist_ok=True)
    (exp_dir / "metrics.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (exp_dir / "README.md").write_text(
        f"# {args.id}: {args.title}\n\n- **Ngày:** {record['date']}\n- **Cách suy luận:** {method}\n- **Commit:** `{record['rulesCommit']}`\n"
        f"- **Tập đã khóa:** `{split['sha256'][:12]}`\n- **Xem check:** {'có, chỉ số tổng' if args.check else 'không'}\n\n"
        f"## Giả thuyết\n\n{args.hypothesis}\n\n## Kết quả\n\nSố đầy đủ ở [metrics.json](metrics.json), bảng so sánh ở [sổ thí nghiệm](../LEDGER.md).\n\n"
        f"## Kết luận\n\n*Viết sau khi đọc kết quả.*\n\n## Tái lập\n\nChạy `research/ml_baseline.py` với cùng tham số, seed cố định {SEED}.\n",
        encoding="utf-8",
    )
    print(json.dumps({k: record[k] for k in ("id", "tune", "crossValidation", "leaveOneScenarioOut", "check", "sms")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
