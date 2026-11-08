"""Kiểm tra rò rỉ: mô hình đang học dấu hiệu lừa đảo, hay học văn phong của từng nguồn dữ liệu?

Chỉ dùng tập tune, không xem check. Chỉ in số tổng và đặc trưng ký tự, không in hội thoại.
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold

sys.path.insert(0, str(Path(__file__).parent))
from ml_baseline import ROOT, SEED, commit, doc, is_danger, model, scores, source_group  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
ID = "EXP-006"


def source_type(c):
    return c["source"].split(":")[0]


def cv_predict(cases, labels, seed=SEED):
    docs = np.array([doc(c) for c in cases], dtype=object)
    y = np.array(labels)
    groups = np.array([source_group(c) for c in cases])
    preds = np.zeros(len(cases), dtype=int)
    for train, test in StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed).split(docs, y, groups):
        preds[test] = model().fit(docs[train], y[train]).predict(docs[test])
    return preds


def main():
    split = json.loads((ROOT / "splits" / "set_v2_tune_check.json").read_text(encoding="utf-8"))
    cases = json.loads((ROOT / "data" / "sets" / "v2" / "cases.json").read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in cases}
    tune = [by_id[i] for i in split["tune"]]

    # 1. Dự đoán nguồn dữ liệu chính xác đến đâu, chỉ từ chữ?
    is_adapted = [int(source_type(c) == "chuyen_the") for c in tune]
    pred_source = cv_predict(tune, is_adapted)
    source_acc = float(np.mean(pred_source == np.array(is_adapted)))

    # 2. Nhãn nguy hiểm trùng với nguồn đến mức nào?
    danger = [is_danger(c) for c in tune]
    overlap = float(np.mean(np.array(danger) == np.array(is_adapted)))

    # 3. Đổi kiểu văn: huấn luyện không có ca AI sinh, chấm báo nhầm trên chính ca AI sinh
    ai = [c for c in tune if source_type(c) == "ai_sinh_da_sua"]
    no_ai = [c for c in tune if source_type(c) != "ai_sinh_da_sua"]
    clf = model().fit([doc(c) for c in no_ai], [is_danger(c) for c in no_ai])
    ai_alarm = int(clf.predict([doc(c) for c in ai]).sum())

    # 4. Đặc trưng nặng nhất của mô hình phát hiện nguy hiểm
    clf_all = model().fit([doc(c) for c in tune], danger)
    vec, lr = clf_all.steps[0][1], clf_all.steps[1][1]
    names = np.array(vec.get_feature_names_out())
    order = np.argsort(lr.coef_[0])
    top_danger = [n.strip() for n in names[order[-30:]][::-1]]
    top_benign = [n.strip() for n in names[order[:30]]]

    # 5. So với đặc trưng: lời người dùng bị bỏ, nên chênh độ dài và dấu câu cũng là tín hiệu văn phong
    length = {
        s: float(np.mean([len(doc(c)) for c in tune if source_type(c) == s]))
        for s in sorted({source_type(c) for c in tune})
    }

    record = {
        "id": ID,
        "date": date.today().isoformat(),
        "title": "Kiểm tra mô hình học văn phong hay học dấu hiệu",
        "hypothesis": "Nếu mô hình đoán được nguồn dữ liệu gần như tuyệt đối và nhãn trùng với nguồn, số kiểm định chéo cao chỉ phản ánh khác biệt văn phong.",
        "method": "Kiểm tra rò rỉ trên tune",
        "rulesCommit": commit(),
        "dataset": "set:v2",
        "splitSha256": split["sha256"],
        "checkViewed": False,
        "tune": None,
        "check": None,
        "sms": None,
        "sourcePredictionAccuracy": source_acc,
        "dangerEqualsAdaptedSource": overlap,
        "aiGeneratedBenignFalseAlarm": f"{ai_alarm}/{len(ai)}",
        "avgCharsBySource": length,
        "topFeaturesDanger": top_danger,
        "topFeaturesBenign": top_benign,
    }
    out = ROOT / "experiments" / ID
    out.mkdir(parents=True, exist_ok=True)
    (out / "metrics.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False, indent=0))


if __name__ == "__main__":
    main()
