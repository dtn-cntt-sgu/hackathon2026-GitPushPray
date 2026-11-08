"""Chạy notebook và lưu bản có kết quả vào research/results/, không sửa bản trên repo."""
import os
import sys
from pathlib import Path

import nbformat
from nbconvert import HTMLExporter
from nbconvert.preprocessors import ExecutePreprocessor

sys.stdout.reconfigure(encoding="utf-8")
here = Path(__file__).parent
research = here.parent
out = research / "results" / "rule_analysis"
os.environ["SAFECHAT_RESEARCH"] = str(research)

nb = nbformat.read(here / "phan_tich_luat.ipynb", as_version=4)
ExecutePreprocessor(timeout=180, kernel_name="python3").preprocess(nb, {"metadata": {"path": str(here)}})
nbformat.write(nb, out / "phan_tich_luat.executed.ipynb")
exporter = HTMLExporter(exclude_input=True)
exporter.exclude_input_prompt = True
exporter.exclude_output_prompt = True
html, _ = exporter.from_notebook_node(nb)
(out / "phan_tich_luat.html").write_text(html, encoding="utf-8")
print(f"Đã chạy xong: {out / 'phan_tich_luat.html'}")
