"""`make metrics` (Prompt 4): data/processed/monthly.parquet -> web/public/data/metrics.json.

All revenue is Sensor Tower NET USD. Per app and region (world, us) plus dataset totals.
"Core" market = webtoon_platform + manga + western_comics (excludes adjacent/substitute segments).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .paths import Paths
from .regions import in_region, load_regions

CORE_SEGMENTS = ("webtoon_platform", "manga", "western_comics")
ARR_TARGET = 10_000_000
ARR_WINDOW_MONTHS = 36
STATUS_BAND = 0.05


def _r(v, nd=0):
    if v is None or (isinstance(v, float) and not np.isfinite(v)) or pd.isna(v):
        return None
    return round(float(v), nd)


def _pct(a, b):
    return _r(a / b - 1, 4) if b else None


def months_between(a: pd.Timestamp, b: pd.Timestamp) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def growth_status(yoy: float | None) -> str | None:
    if yoy is None:
        return None
    return "growing" if yoy > STATUS_BAND else "declining" if yoy < -STATUS_BAND else "stable"


def region_monthly(monthly: pd.DataFrame, regions: dict[str, dict]) -> dict[str, pd.DataFrame]:
    agg = dict(revenue_net=("revenue_net", "sum"), downloads=("downloads", "sum"), partial=("partial", "max"))
    return {r: in_region(monthly, cfg["countries"]).groupby(["app_slug", "month"], as_index=False).agg(**agg)
            for r, cfg in regions.items()}


def arr_milestone(s: pd.Series, launch: pd.Timestamp | None, launch_basis: str) -> dict:
    """Did monthly net revenue × 12 reach $10M within 36 months of launch?"""
    out = {"target_arr": ARR_TARGET, "window_months": ARR_WINDOW_MONTHS, "launch_month": None,
           "launch_basis": launch_basis, "reached": None, "month_reached": None, "months_to_reach": None, "note": None}
    if launch is None or s.empty:
        out["note"] = "дата запуску невідома"
        return out
    out["launch_month"] = f"{launch:%Y-%m}"
    window_end = launch + pd.DateOffset(months=ARR_WINDOW_MONTHS - 1)
    hits = s[(s * 12 >= ARR_TARGET)]
    if len(hits):
        first = hits.index.min()
        out["month_reached"] = f"{first:%Y-%m}"
        out["months_to_reach"] = months_between(launch, first) + 1
    in_window = s[(s.index >= launch) & (s.index <= window_end)]
    revenue_from = s[s > 0].index.min() if (s > 0).any() else None
    if (in_window * 12 >= ARR_TARGET).any():
        out["reached"] = True
    elif revenue_from is None or revenue_from > launch + pd.DateOffset(months=2):
        out["note"] = (f"дані про виручку є лише з {revenue_from:%Y-%m}" if revenue_from is not None else "немає даних про виручку")             + " — пізніше за запуск, тож перші 36 міс. не видно повністю"
    elif s.index.max() < window_end:
        out["note"] = f"поки видно лише {months_between(launch, s.index.max()) + 1} з 36 міс."
    else:
        out["reached"] = False
    return out


def app_region_metrics(df: pd.DataFrame, cutoff: pd.Timestamp, launch: pd.Timestamp | None, launch_basis: str,
                       totals_l12m: dict[str, float], seg_total_l12m: float | None, is_core: bool) -> dict:
    s = df.set_index("month").sort_index()
    rev, dl = s["revenue_net"], s["downloads"]
    l12_start = cutoff - pd.DateOffset(months=11)
    p12_start, p12_end = cutoff - pd.DateOffset(months=23), cutoff - pd.DateOffset(months=12)
    l12_rev, l12_dl = rev[l12_start:cutoff].sum(), dl[l12_start:cutoff].sum()
    p12_rev = rev[p12_start:p12_end].sum()
    has_prev = rev[p12_start:p12_end].count() == 12 and rev[l12_start:cutoff].count() == 12
    revenue_from = rev[rev > 0].index.min() if (rev > 0).any() else None

    years = []
    for y, g in rev.groupby(rev.index.year):
        months = g.index.month.tolist()
        partial = len(g) < 12
        prev = rev[rev.index.year == y - 1]
        like = prev[prev.index.month.isin(months)]  # like-for-like months for partial years
        comparable = len(like) == len(g) and like.sum() > 0
        years.append({
            "year": int(y), "revenue_net": _r(g.sum()), "downloads": _r(dl[dl.index.year == y].sum()),
            "months": len(g), "partial_year": partial,
            "period": f"{g.index.min():%Y-%m}..{g.index.max():%Y-%m}",
            "yoy": _pct(g.sum(), like.sum()) if comparable else None,
            "yoy_basis": ("same months of previous year" if partial else "full year") if comparable else None,
            "rpd": _r(g.sum() / dl[dl.index.year == y].sum(), 3) if dl[dl.index.year == y].sum() else None,
        })
    full = [y for y in years if not y["partial_year"] and revenue_from is not None
            and y["year"] > revenue_from.year - (1 if revenue_from.month == 1 else 0) and y["revenue_net"]]
    cagr = None
    if len(full) >= 2:
        a, b = full[0], full[-1]
        cagr = {"from": a["year"], "to": b["year"],
                "value": _r((b["revenue_net"] / a["revenue_net"]) ** (1 / (b["year"] - a["year"])) - 1, 4)}

    last = rev.index.max()
    peak_m = rev.idxmax() if len(rev) else None
    yoy_l12m = _pct(l12_rev, p12_rev) if has_prev else None
    return {
        "data_start": f"{rev.index.min():%Y-%m}", "data_end": f"{last:%Y-%m}",
        "revenue_from": f"{revenue_from:%Y-%m}" if revenue_from is not None else None,
        "l12m": {"period": f"{l12_start:%Y-%m}..{cutoff:%Y-%m}", "revenue_net": _r(l12_rev), "downloads": _r(l12_dl),
                 "rpd": _r(l12_rev / l12_dl, 3) if l12_dl else None,
                 "complete": bool(rev[l12_start:cutoff].count() == 12),
                 "prev_period": f"{p12_start:%Y-%m}..{p12_end:%Y-%m}", "prev_revenue_net": _r(p12_rev) if has_prev else None,
                 "yoy": yoy_l12m},
        "status": growth_status(yoy_l12m),
        "mom": {"month": f"{last:%Y-%m}", "revenue_net": _r(rev.iloc[-1]),
                "prev_revenue_net": _r(rev.iloc[-2]) if len(rev) > 1 else None,
                "change": _pct(rev.iloc[-1], rev.iloc[-2]) if len(rev) > 1 else None},
        "years": years,
        "cagr": cagr,
        "share_l12m": {
            "of_dataset": _r(l12_rev / totals_l12m["all"], 4) if totals_l12m["all"] else None,
            "of_core": _r(l12_rev / totals_l12m["core"], 4) if is_core and totals_l12m["core"] else None,
            "of_segment": _r(l12_rev / seg_total_l12m, 4) if seg_total_l12m else None,
        },
        "peak": {"month": f"{peak_m:%Y-%m}" if peak_m is not None else None, "revenue_net": _r(rev.max()),
                 "drawdown_from_peak": _pct(rev.iloc[-1], rev.max()) if len(rev) and rev.max() else None},
        "months_since_launch": months_between(launch, cutoff) if launch is not None else None,
        "launch_month": f"{launch:%Y-%m}" if launch is not None else None,
        "launch_basis": launch_basis,
        "arr_10m_within_36m": arr_milestone(rev, launch, launch_basis),
    }


def concentration(df: pd.DataFrame) -> dict:
    by_app = df.groupby("app_slug")["revenue_net"].sum().sort_values(ascending=False)
    total = by_app.sum()
    if not total:
        return {}
    return {
        "total_revenue_net": _r(total), "apps": int((by_app > 0).sum()),
        "leader": by_app.index[0], "top1": _r(by_app.iloc[:1].sum() / total, 4),
        "top2": _r(by_app.iloc[:2].sum() / total, 4), "top5": _r(by_app.iloc[:5].sum() / total, 4),
        "ranking": [{"app_slug": k, "revenue_net": _r(v), "share": _r(v / total, 4)} for k, v in by_app.items()],
    }


def run(paths: Paths) -> dict:
    monthly = pd.read_parquet(paths.processed / "monthly.parquet")
    catalog = pd.DataFrame(json.loads(paths.apps_catalog_json.read_text(encoding="utf-8"))["apps"]).set_index("slug")
    cutoff = monthly["month"].max()
    l12_start = cutoff - pd.DateOffset(months=11)
    segment = catalog["segment"].to_dict()
    regions = region_monthly(monthly, load_regions(paths))

    out = {"meta": {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Sensor Tower", "currency": "USD", "revenue_basis": "net",
        "period_end": f"{cutoff:%Y-%m}", "l12m": f"{l12_start:%Y-%m}..{cutoff:%Y-%m}",
        "core_segments": list(CORE_SEGMENTS),
        "definitions": {
            "status": "growing > +5% YoY (L12M vs previous 12 months), stable −5..+5%, declining < −5%",
            "arr": "monthly net revenue × 12; milestone = $10M ARR within 36 months of launch",
            "launch": "iOS release date (App Store) when known, else first month with revenue",
            "cagr": "first → last full calendar year with revenue data",
            "yoy_partial_year": "partial years compare the same months of the previous year",
        },
    }, "apps": {}, "totals": {}}

    for region, df in regions.items():
        df = df.assign(segment=df["app_slug"].map(segment))
        l12 = df[(df["month"] >= l12_start) & (df["month"] <= cutoff)]
        totals_l12m = {"all": l12["revenue_net"].sum(), "core": l12[l12["segment"].isin(CORE_SEGMENTS)]["revenue_net"].sum()}
        seg_l12m = l12.groupby("segment")["revenue_net"].sum().to_dict()
        for slug, g in df.groupby("app_slug"):
            app = catalog.loc[slug]
            rel = app.get("release_date")
            rev_from = g.loc[g["revenue_net"] > 0, "month"].min()
            if isinstance(rel, str) and rel:
                launch, basis = pd.Timestamp(rel).to_period("M").to_timestamp(), "ios_release_date"
            elif pd.notna(rev_from):
                launch, basis = rev_from, "first_revenue_month"
            else:
                launch, basis = None, None
            seg = segment.get(slug)
            out["apps"].setdefault(slug, {"segment": seg})[region] = app_region_metrics(
                g[["month", "revenue_net", "downloads"]], cutoff, launch, basis, totals_l12m,
                seg_l12m.get(seg), seg in CORE_SEGMENTS)

        by_year = df.assign(year=df["month"].dt.year)
        out["totals"][region] = {
            "by_year": [{
                "year": int(y), "revenue_net": _r(g["revenue_net"].sum()), "apps": int(g["app_slug"].nunique()),
                "partial_year": bool(g["month"].nunique() < 12),
                "core_revenue_net": _r(g[g["segment"].isin(CORE_SEGMENTS)]["revenue_net"].sum()),
                "by_segment": {s: _r(v) for s, v in g.groupby("segment")["revenue_net"].sum().items()},
                "concentration": {k: v for k, v in concentration(g).items() if k != "ranking"},
            } for y, g in by_year.groupby("year")],
            "l12m": {
                "period": f"{l12_start:%Y-%m}..{cutoff:%Y-%m}",
                "all": concentration(l12),
                "core": concentration(l12[l12["segment"].isin(CORE_SEGMENTS)]),
                "by_segment": {s: _r(v) for s, v in seg_l12m.items()},
            },
        }

    target = paths.web_data / "metrics.json"
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    w = out["totals"]["world"]["l12m"]
    print(f"metrics.json: {len(out['apps'])} apps · L12M {w['period']} world: "
          f"${w['all']['total_revenue_net'] / 1e6:,.1f}M net (core ${w['core']['total_revenue_net'] / 1e6:,.1f}M), "
          f"leader {w['all']['leader']}, top-5 share {w['all']['top5']:.0%}")
    return out
