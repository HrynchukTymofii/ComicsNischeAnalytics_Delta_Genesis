"""Copy the data the MCP server reads into mcp/data/ so `vercel deploy` (run from mcp/) uploads it.

mcp/data/ is gitignored, like data/processed/. Usage (repo root): .venv/Scripts/python mcp/scripts/stage_data.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "mcp" / "data"
FILES = ["processed/monthly.parquet", "processed/us_snapshot.parquet", "processed/intel.json",
         "catalog/apps_catalog.json", "catalog/regions.json"]


def main() -> int:
    missing = [f for f in FILES if not (REPO / "data" / f).exists()]
    if missing:
        print(f"missing {missing} — run `make catalog && make build-data` first", file=sys.stderr)
        return 1
    shutil.rmtree(OUT, ignore_errors=True)
    for f in FILES:
        (OUT / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / "data" / f, OUT / f)
        print(f"staged data/{f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
