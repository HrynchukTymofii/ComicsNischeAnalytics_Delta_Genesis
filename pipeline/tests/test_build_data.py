import json

import pandas as pd
import pytest

from comics_pipeline import build_data
from comics_pipeline.catalog import match_registry, name_score
from comics_pipeline.paths import Paths, get_paths

from .test_audit import write_st

REAL = get_paths()


def row(date, app_id="111", uid="u1", country="US", rev=10.0, dl=5, platform="App Store", device="iPhone", name="Foo"):
    return [name, uid, "Pub", "p1", "Dev", "d1", name, app_id, date, country, platform, device, dl, rev, 1.0]


def write_catalog(repo: Paths, apps: dict[str, str]) -> None:
    repo.apps_catalog_json.write_text(json.dumps({"apps": [
        {"slug": slug, "display_name": slug.title(), "unified_id": uid, "segment": "webtoon_platform"} for uid, slug in apps.items()]}))


@pytest.fixture
def built(repo: Paths):
    def _build(files: dict[str, list[list]]):
        for name, rows in files.items():
            write_st(repo.raw_sources["sensortower"] / name, rows)
        write_catalog(repo, {"u1": "foo", "u2": "bar"})
        build_data.run(repo)
        return pd.read_parquet(repo.processed / "monthly.parquet")
    return _build


def test_monthly_wins_over_weekly_for_same_app_month_never_summed(built):
    m = built({
        "monthly.csv": [row("2026-01-01", rev=1000, country=c) for c in ("US", "FR")],
        "weekly.csv": [row(d, rev=70, country=c) for d in ("2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26")
                       for c in ("US", "FR")],
    })
    jan = m[m["month"] == "2026-01-01"]
    assert jan["revenue_net"].sum() == 2000  # not 2000 + 560
    assert set(jan["granularity"]) == {"monthly"}


def test_webtoon_style_switch_weeks_split_by_days(built):
    # $7/week = $1/day. Week of Mon 2025-12-29: 3 days Dec (dropped: Dec is monthly), 4 days Jan.
    # Week of Mon 2026-01-26: 6 days Jan, 1 day Feb (Feb then partial -> after cutoff, dropped).
    m = built({"webtoon.csv": [
        row("2025-11-01", rev=100), row("2025-12-01", rev=100),
        row("2025-12-29", rev=7), row("2026-01-05", rev=7), row("2026-01-12", rev=7),
        row("2026-01-19", rev=7), row("2026-01-26", rev=7),
    ]}).set_index("month")
    assert m.loc["2025-12-01", "revenue_net"] == 100 and m.loc["2025-12-01", "granularity"] == "monthly"
    assert m.loc["2026-01-01", "revenue_net"] == pytest.approx(31) and m.loc["2026-01-01", "granularity"] == "weekly"
    assert m.loc["2026-01-01", "days_covered"] == 31 and not m.loc["2026-01-01", "partial"]
    assert "2026-02-01" not in m.index


def test_us_daily_snapshot_is_separate_with_run_rate(built, repo):
    m = built({
        "monthly.csv": [row("2026-08-01", rev=500, country=c) for c in ("US", "FR")]
                       + [row("2026-09-01", rev=500, country=c) for c in ("US", "FR")],
        "us_daily.xlsx.csv": [row(f"2026-09-{d}", rev=18) for d in range(13, 31)],
    })
    assert m["revenue_net"].sum() == 2000  # snapshot rows not in the monthly table
    snap = json.loads((repo.web_data / "us_snapshot.json").read_text())["apps"][0]
    assert snap["days"] == 18 and snap["revenue_net"] == 324
    assert snap["run_rate_revenue_net"] == pytest.approx(324 * 365 / 18, abs=1)


def test_gross_is_an_estimated_range(built):
    m = built({"m.csv": [row("2026-01-01", rev=85), row("2026-02-01", rev=85)]})
    r = m.iloc[0]
    assert r["revenue_gross_low"] == pytest.approx(100) and r["revenue_gross_high"] == pytest.approx(85 / 0.7)


def test_identical_rows_across_files_dropped_conflicts_raise(repo):
    rows = [row("2026-01-01"), row("2026-02-01")]
    write_st(repo.raw_sources["sensortower"] / "a.csv", rows)
    write_st(repo.raw_sources["sensortower"] / "b.csv", [*rows, row("2026-03-01")])  # overlapping, not identical file
    write_catalog(repo, {"u1": "foo"})
    assert build_data.run(repo)["duplicate_rows_dropped"] == 2

    write_st(repo.raw_sources["sensortower"] / "c.csv", [row("2026-01-01", rev=999), row("2026-02-01", rev=999)])
    with pytest.raises(build_data.DataRuleError):
        build_data.run(repo)


def test_catalog_name_matching():
    assert name_score("Shonen Jump", "Shonen Jump Manga & Comics") >= 0.85
    assert name_score("Tapas – Comics and Novels", "Tapas – Comics and Novels") == 1.0
    assert name_score("Manta", "Toomics") < 0.85
    apps = pd.DataFrame([{"unified_id": "u", "unified_name": "マンガＵＰ！", "app_names": ["Manga UP!"],
                          "ios_ids": ["1"], "android_packages": []}])
    registry = pd.DataFrame([{"app_name": "Manga UP!", "ios_id": "", "android_package": ""}])
    assert match_registry(apps, registry) == {"u": 0}


# --- the user's acceptance checks, on the real processed data (run `make build-data` first) ----------

MONTHLY = REAL.processed / "monthly.parquet"
real = pytest.mark.skipif(not MONTHLY.exists(), reason="real data/processed/monthly.parquet not built")


@real
def test_real_webtoon_total_2015_01_to_2026_09():
    m = pd.read_parquet(MONTHLY)
    w = m[(m["app_slug"] == "webtoon") & (m["month"] >= "2015-01-01") & (m["month"] <= "2026-09-01")]
    assert w["revenue_net"].sum() == pytest.approx(549.5e6, rel=0.01)


@real
def test_real_shonen_jump_2026_09_app_store():
    m = pd.read_parquet(MONTHLY)
    s = m[(m["app_slug"] == "shonen-jump") & (m["month"] == "2026-09-01") & (m["platform"] == "ios")]
    assert s["revenue_net"].sum() == pytest.approx(1.97e6, rel=0.01)


@real
def test_real_no_app_month_mixes_granularities():
    build_data.assert_single_granularity(pd.read_parquet(MONTHLY))
