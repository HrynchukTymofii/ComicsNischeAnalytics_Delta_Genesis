import pandas as pd
import pytest

from comics_pipeline.metrics import app_region_metrics, arr_milestone, concentration, growth_status

CUTOFF = pd.Timestamp("2026-09-01")


def series(start: str, end: str, rev, dl=1000.0) -> pd.DataFrame:
    months = pd.date_range(start, end, freq="MS")
    revs = rev if isinstance(rev, list) else [rev] * len(months)
    return pd.DataFrame({"month": months, "revenue_net": revs, "downloads": dl})


def metrics(df, launch=None):
    return app_region_metrics(df, CUTOFF, launch, "test", {"all": 1e9, "core": 1e8}, 5e8, True)


@pytest.mark.parametrize("yoy,expected", [(0.06, "growing"), (0.05, "stable"), (-0.05, "stable"),
                                          (-0.051, "declining"), (None, None)])
def test_status_thresholds(yoy, expected):
    assert growth_status(yoy) == expected


def test_l12m_yoy_and_status():
    df = series("2024-10-01", "2026-09-01", [100.0] * 12 + [120.0] * 12)
    m = metrics(df)
    assert m["l12m"]["period"] == "2025-10..2026-09"
    assert m["l12m"]["revenue_net"] == 1440 and m["l12m"]["yoy"] == pytest.approx(0.2)
    assert m["status"] == "growing"
    assert m["l12m"]["rpd"] == pytest.approx(0.12)


def test_partial_year_yoy_is_like_for_like():
    df = series("2025-01-01", "2026-09-01", [100.0] * 12 + [110.0] * 9)
    y2026 = next(y for y in metrics(df)["years"] if y["year"] == 2026)
    assert y2026["partial_year"] and y2026["months"] == 9
    assert y2026["yoy"] == pytest.approx(0.10)  # Jan–Sep 2026 vs Jan–Sep 2025, not vs full 2025


def test_cagr_uses_full_years_only():
    df = series("2023-01-01", "2026-09-01", [100.0] * 12 + [150.0] * 12 + [225.0] * 12 + [1.0] * 9)
    assert metrics(df)["cagr"] == {"from": 2023, "to": 2025, "value": pytest.approx(0.5)}


def test_peak_and_drawdown():
    df = series("2026-01-01", "2026-09-01", [100, 200, 150, 150, 150, 150, 150, 150, 100.0])
    p = metrics(df)["peak"]
    assert p["month"] == "2026-02" and p["drawdown_from_peak"] == pytest.approx(-0.5)


def test_arr_milestone():
    s = series("2024-01-01", "2026-09-01", [500_000.0] * 20 + [900_000.0] * 13).set_index("month")["revenue_net"]
    m = arr_milestone(s, pd.Timestamp("2024-01-01"), "test")
    assert m["reached"] is True and m["month_reached"] == "2025-09" and m["months_to_reach"] == 21

    never = arr_milestone(s.clip(upper=100_000), pd.Timestamp("2022-06-01"), "test")
    assert never["reached"] is None and "не видно повністю" in never["note"]  # data starts after launch

    too_early = arr_milestone(s.clip(upper=100_000)["2025-01-01":], pd.Timestamp("2025-01-01"), "test")
    assert too_early["reached"] is None and "21 з 36" in too_early["note"]


def test_concentration():
    df = pd.DataFrame({"app_slug": list("abcdefg"), "revenue_net": [50, 20, 10, 8, 7, 3, 2.0]})
    c = concentration(df)
    assert c["leader"] == "a" and c["top1"] == 0.5 and c["top2"] == 0.7 and c["top5"] == 0.95
