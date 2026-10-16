"""`make check-deploy` (Prompt 6): nothing raw goes into git, and web/public/data stays small.

Checks every file git would commit (tracked + untracked-but-not-ignored).
"""
from __future__ import annotations

import subprocess

from .paths import Paths

DATA_EXTS = {".csv", ".tsv", ".xlsx", ".xls", ".parquet", ".duckdb"}
ALLOWED = {"data/catalog/registry.csv", "data/catalog/extra_apps.csv",  # derived / hand-made, no raw data
           "data/audit_report.csv", "data/audit_overlaps.csv"}
MAX_PUBLIC_DATA_MB = 20
MAX_CREATIVES_MB = 40  # downloaded ad creatives / screenshots (resized by `make intel`)


def run(paths: Paths) -> bool:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=paths.root, capture_output=True, text=True, check=True).stdout.splitlines()
    bad = [f for f in out if "." in f and "." + f.rsplit(".", 1)[-1].lower() in DATA_EXTS and f not in ALLOWED]
    raw = [f for f in out if f.startswith("data/raw/") and not f.endswith(".gitkeep")]
    public = [p for d in ("web/public/data", "web/public/icons") for p in (paths.root / d).rglob("*") if p.is_file()]
    data_mb = sum(p.stat().st_size for p in (paths.root / "web/public/data").rglob("*") if p.is_file()) / 1e6
    total_mb = sum(p.stat().st_size for p in public) / 1e6
    creatives_mb = sum(p.stat().st_size for p in (paths.root / "web/public/creatives").rglob("*") if p.is_file()) / 1e6

    ok = not bad and not raw and data_mb < MAX_PUBLIC_DATA_MB and creatives_mb < MAX_CREATIVES_MB
    print(f"files git would commit: {len(out)}")
    print(f"raw files under data/raw: {raw or 'none'}")
    print(f"data files (csv/xlsx/parquet/duckdb) outside the allow-list: {bad or 'none'}")
    print(f"web/public/data: {data_mb:.2f} MB (limit {MAX_PUBLIC_DATA_MB} MB); with icons: {total_mb:.2f} MB")
    print(f"web/public/creatives: {creatives_mb:.2f} MB (limit {MAX_CREATIVES_MB} MB)")
    print("OK — safe to deploy" if ok else "FAIL — fix the above before committing/deploying")
    return ok
