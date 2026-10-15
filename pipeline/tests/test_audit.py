from pathlib import Path

import pandas as pd
import pytest

from comics_pipeline import audit
from comics_pipeline.paths import Paths, get_paths
from comics_pipeline.st_io import ST_COLUMNS, detect_granularity, granularity_runs

REAL = get_paths()


def write_st(path: Path, rows: list[list]) -> Path:
    """Sensor Tower style export: UTF-16 LE, TAB-separated."""
    lines = ["\t".join(ST_COLUMNS), *("\t".join(map(str, r)) for r in rows)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-16")
    return path


def st_row(date: str, app_id="111", country="US", rev=10.0):
    return ["Foo", "u1", "Pub", "p1", "Dev", "d1", "Foo", app_id, date, country, "App Store", "iPhone", 5, rev, 2.0]


def test_identical_revenue_and_downloads_exports_are_flagged_and_not_moved(repo: Paths):
    st = repo.raw_sources["sensortower"]
    rows = [st_row("2026-01-01"), st_row("2026-02-01")]
    write_st(st / "Unified_Revenue_x.csv", rows)
    write_st(st / "Unified_Downloads_x.csv", rows)

    report = audit.run(repo)
    assert report["duplicate_of"].notna().sum() == 1
    assert (st / "Unified_Revenue_x.csv").exists() and (st / "Unified_Downloads_x.csv").exists()
    assert (repo.data / "audit_report.csv").exists() and (repo.data / "audit_report.md").exists()

    audit.run(repo, move=True, confirmed=False)
    assert len(list(st.glob("*.csv"))) == 2  # still nothing moved without --confirmed


def test_report_row_contents(repo: Paths):
    write_st(repo.raw_sources["genesis"] / "sub" / "g.csv" if (repo.raw_sources["genesis"] / "sub").mkdir() is None else None,
             [st_row("2026-09-13", rev=1.5), st_row("2026-09-14", rev=2.5)])
    r = audit.run(repo).iloc[0]
    assert r["source"] == "genesis"
    assert r["granularity"] == "daily" and r["region"] == "US"
    assert r["revenue_total_usd"] == 4.0 and r["downloads_total"] == 10


def test_utf8_comma_fallback(repo: Paths):
    p = repo.raw_sources["sensortower"] / "utf8.csv"
    pd.DataFrame([st_row("2026-01-05"), st_row("2026-01-12")], columns=ST_COLUMNS).to_csv(p, index=False)
    r = audit.run(repo).iloc[0]
    assert r["format"] == "utf-8/comma" and r["granularity"] == "weekly"


def test_granularity_switch_monthly_then_weekly():
    dates = pd.Series(pd.to_datetime(["2025-10-01", "2025-11-01", "2025-12-01", "2025-12-29", "2026-01-05", "2026-01-12"]))
    assert detect_granularity(dates) == "monthly+weekly"
    runs = granularity_runs(dates)
    assert [(g, str(a.date()), str(b.date())) for g, a, b in runs] == [
        ("monthly", "2025-10-01", "2025-12-01"), ("weekly", "2025-12-29", "2026-01-12")]


@pytest.mark.parametrize("dates,expected", [
    (["2026-09-13", "2026-09-14", "2026-09-16"], "daily"),
    (["2026-01-05", "2026-01-19"], "weekly"),  # a missing week is still weekly
    (["2026-01-01", "2026-03-01"], "monthly"),
])
def test_detect_granularity(dates, expected):
    assert detect_granularity(pd.Series(pd.to_datetime(dates))) == expected


# --- checks against the real raw data (skipped when it isn't present) ---------------------------

def _current_path(original_name: str) -> Path:
    """Raw files may have been moved/renamed by `audit --apply-plan`; follow data/raw/_rename_log.csv."""
    p = REAL.raw / "sensortower" / original_name
    log = REAL.raw / "_rename_log.csv"
    if not p.exists() and log.exists():
        for _, r in pd.read_csv(log).iterrows():
            if r["from"].endswith("/" + original_name):
                return REAL.root / r["to"]
    return p


KMANGA = [_current_path(f"Unified_{m}_May_2023_September_2026,_All_112_Countries_Regions.csv")
          for m in ("Revenue", "Downloads")]


@pytest.mark.skipif(not all(p.exists() for p in KMANGA), reason="real K MANGA exports not present")
def test_real_kmanga_revenue_and_downloads_files_are_identical():
    groups = audit.find_duplicate_groups([("sensortower", p) for p in KMANGA])
    assert len(groups) == 1 and set(groups[0]) == set(KMANGA)


def test_apply_plan_moves_duplicates_renames_and_logs(repo: Paths):
    st = repo.raw_sources["sensortower"]
    rows = [st_row("2026-01-01"), st_row("2026-02-01")]
    write_st(st / "Unified_Revenue_x.csv", rows)
    write_st(st / "Unified_Downloads_x.csv", rows)
    audit.run(repo, apply=True, confirmed=True)
    assert sorted(p.name for p in st.iterdir()) == ["Foo_monthly_US_2026-01-01_2026-02-01.csv"]
    assert len(list((repo.raw_duplicates / "sensortower").iterdir())) == 1
    log = pd.read_csv(repo.raw / "_rename_log.csv")
    assert list(log["action"]) == ["move_duplicate", "rename"] and log["md5"].notna().all()
