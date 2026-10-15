"""`make build-data` (Prompt 3): raw Sensor Tower exports -> long table -> monthly table + US snapshot
-> data/processed/*.parquet and web/public/data/*.json.

Rules (see CLAUDE.md):
- Revenue is Sensor Tower NET. Gross is only ever an estimated range: net/0.85 (low) .. net/0.70 (high).
- Per app+month exactly one granularity is used: monthly > weekly > daily. Never summed together.
- Weekly values are split across months by days (1/7 per day), so every month holds exactly its own
  days and 4-vs-5-week months don't create fake spikes. The week of Mon 2025-12-29 puts 3/7 into
  December (dropped there: December has monthly data) and 4/7 into January.
- US daily files for a short window (13-30.09.2026) are kept apart as `us_snapshot`, not mixed into monthly.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .inputs import load_inputs
from .paths import Paths
from .regions import in_region, load_regions
from .st_io import granularity_runs

PRIORITY = {"monthly": 0, "weekly": 1, "daily": 2}
GROSS_LOW_DIVISOR, GROSS_HIGH_DIVISOR = 0.85, 0.70  # store fee 15% .. 30%
PLATFORMS = {"App Store": "ios", "Google Play": "android"}
ROW_KEY = ["app_id", "country", "device", "date", "granularity"]


class DataRuleError(ValueError):
    pass


def load_catalog(paths: Paths) -> pd.DataFrame:
    if not paths.apps_catalog_json.exists():
        raise SystemExit("data/catalog/apps_catalog.json missing — run `make catalog` first")
    apps = json.loads(paths.apps_catalog_json.read_text(encoding="utf-8"))["apps"]
    return pd.DataFrame(apps)


# --- 1. long table --------------------------------------------------------------------------------

def label_granularity(df: pd.DataFrame) -> pd.Series:
    """Per (file, unified app) series: each row gets the granularity of the run its date falls in."""
    out = pd.Series(index=df.index, dtype=object)
    for _, g in df.groupby("unified_id"):
        for label, start, end in granularity_runs(g["date"]):
            out[g.index[(g["date"] >= start) & (g["date"] <= end)]] = label
    return out


def long_table(paths: Paths, catalog: pd.DataFrame) -> pd.DataFrame:
    slug_by_unified = dict(zip(catalog["unified_id"].dropna(), catalog.loc[catalog["unified_id"].notna(), "slug"]))
    frames = []
    for f, raw in load_inputs(paths):
        df = pd.DataFrame({
            "unified_id": raw["Unified ID"],
            "app_id": raw["App ID"],
            "platform": raw["Platform"].map(PLATFORMS).fillna(raw["Platform"]),
            "device": raw["Device"],
            "country": raw["Country / Region"].astype(str),
            "date": raw["Date"],
            "downloads": raw["Downloads"].fillna(0),
            "revenue_net": raw["Revenue ($)"].fillna(0),
            "source_file": f.rel(paths.root),
            "file_md5": f.md5,
        }).dropna(subset=["date"])
        df["granularity"] = label_granularity(df)
        if (df["granularity"] == "monthly?").any():  # a single date on the 1st: treat as monthly, but say so
            print(f"  note: {f.path.name} has a single date on the 1st of a month; treated as monthly")
            df["granularity"] = df["granularity"].replace("monthly?", "monthly")
        countries = set(df["country"].unique())
        df["us_snapshot"] = (df["granularity"] == "daily") & (countries == {"US"})
        frames.append(df)
    long = pd.concat(frames, ignore_index=True)
    missing = sorted(set(long["unified_id"]) - set(slug_by_unified))
    if missing:
        raise SystemExit(f"Unified IDs not in the catalog: {missing} — re-run `make catalog`")
    long["app_slug"] = long["unified_id"].map(slug_by_unified)
    long["month"] = long["date"].dt.to_period("M").dt.to_timestamp()  # weekly rows: month of week start
    return long


def drop_duplicate_rows(long: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Same app_id/country/device/date/granularity in several files: keep one; differing values = error."""
    deduped = long.drop_duplicates(subset=[*ROW_KEY, "downloads", "revenue_net"])
    conflict = deduped.duplicated(subset=ROW_KEY, keep=False)
    if conflict.any():
        sample = deduped[conflict].sort_values(ROW_KEY).head(10)
        raise DataRuleError(f"{int(conflict.sum())} rows share a key but differ in value across files:\n{sample}")
    return deduped, len(long) - len(deduped)


# --- 2. monthly table -----------------------------------------------------------------------------

def split_weeks(rows: pd.DataFrame) -> pd.DataFrame:
    """Give every row the month(s) it covers and `days` covered there.

    Monthly rows cover their whole month, daily rows one day. A weekly row whose 7 days straddle a
    month boundary becomes two parts, with revenue/downloads split pro rata by days.
    """
    weekly = rows["granularity"] == "weekly"
    other = rows[~weekly].copy()
    other["days"] = np.where(other["granularity"] == "monthly", other["date"].dt.days_in_month, 1)
    wk = rows[weekly]
    to_month_end = (wk["date"] + pd.offsets.MonthEnd(0) - wk["date"]).dt.days + 1
    first = wk.assign(days=to_month_end.clip(upper=7))
    rest = wk[to_month_end < 7].assign(days=7 - to_month_end[to_month_end < 7],
                                       month=lambda d: d["month"] + pd.DateOffset(months=1))
    parts = pd.concat([first, rest])
    for col in ("revenue_net", "downloads"):
        parts[col] = parts[col] * parts["days"] / 7
    return pd.concat([other, parts], ignore_index=True)


def monthly_table(long: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """One granularity per app+month (monthly > weekly > daily), then aggregate. Returns (monthly, dropped)."""
    rows = split_weeks(long[~long["us_snapshot"]])
    rows["_p"] = rows["granularity"].map(PRIORITY)
    if rows["_p"].isna().any():
        raise DataRuleError(f"unknown granularity: {sorted(rows.loc[rows['_p'].isna(), 'granularity'].unique())}")
    best = rows.groupby(["app_slug", "month"])["_p"].transform("min")
    kept, dropped = rows[rows["_p"] == best], rows[rows["_p"] != best]
    assert_single_granularity(kept)

    m = (kept.groupby(["app_slug", "month", "platform", "country"], as_index=False)
         .agg(revenue_net=("revenue_net", "sum"), downloads=("downloads", "sum"),
              granularity=("granularity", "first")))
    coverage = (kept.drop_duplicates(["app_slug", "month", "date"])
                .groupby(["app_slug", "month"], as_index=False)
                .agg(periods=("date", "nunique"), days_covered=("days", "sum")))
    m = m.merge(coverage, on=["app_slug", "month"])
    m["from_weekly"] = m["granularity"] == "weekly"
    m["from_daily"] = m["granularity"] == "daily"
    m["partial"] = m["days_covered"] < m["month"].dt.days_in_month
    return add_gross(m), dropped


def assert_single_granularity(df: pd.DataFrame) -> None:
    n = df.groupby(["app_slug", "month"])["granularity"].nunique()
    if (n > 1).any():
        raise DataRuleError(f"app+months mixing granularities: {n[n > 1].index[:5].tolist()}")


def add_gross(df: pd.DataFrame) -> pd.DataFrame:
    df["revenue_gross_low"] = df["revenue_net"] / GROSS_LOW_DIVISOR
    df["revenue_gross_high"] = df["revenue_net"] / GROSS_HIGH_DIVISOR
    return df


# --- 3. US snapshot -------------------------------------------------------------------------------

def us_snapshot(long: pd.DataFrame) -> pd.DataFrame:
    s = long[long["us_snapshot"]]
    if s.empty:
        return pd.DataFrame()
    out = (s.groupby(["app_slug", "platform"], as_index=False)
           .agg(revenue_net=("revenue_net", "sum"), downloads=("downloads", "sum"),
                start=("date", "min"), end=("date", "max"), days=("date", "nunique")))
    out["run_rate_revenue_net"] = out["revenue_net"] * 365 / out["days"]
    out["run_rate_downloads"] = out["downloads"] * 365 / out["days"]
    return add_gross(out)


# --- 4. JSON exports ------------------------------------------------------------------------------

def _round(v: float, nd: int = 0):
    return None if pd.isna(v) else round(float(v), nd)


def _series(df: pd.DataFrame) -> dict:
    df = df.sort_values("month")
    return {
        "months": df["month"].dt.strftime("%Y-%m").tolist(),
        "revenue_net": [_round(v) for v in df["revenue_net"]],
        "downloads": [_round(v) for v in df["downloads"]],
        "granularity": df["granularity"].tolist(),
        "partial": [bool(v) for v in df["partial"]],
    }


def region_frames(monthly: pd.DataFrame, regions: dict[str, dict]) -> dict[str, pd.DataFrame]:
    keys = ["app_slug", "month"]
    agg = dict(revenue_net=("revenue_net", "sum"), downloads=("downloads", "sum"),
               granularity=("granularity", "first"), partial=("partial", "max"))
    return {r: in_region(monthly, cfg["countries"]).groupby(keys, as_index=False).agg(**agg) for r, cfg in regions.items()}


def l12m_months(cutoff: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp]:
    return cutoff - pd.DateOffset(months=11), cutoff


def export_json(paths: Paths, monthly: pd.DataFrame, snap: pd.DataFrame, catalog: pd.DataFrame, cutoff: pd.Timestamp) -> list[str]:
    regions = load_regions(paths)
    out_dir = paths.web_data
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("by_country_*.json"):
        old.unlink()  # generated files only; regenerated below
    segment = dict(zip(catalog["slug"], catalog["segment"]))
    l12_start, l12_end = l12m_months(cutoff)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Sensor Tower",
        "currency": "USD",
        "revenue_basis": "net",
        "gross_estimate": f"gross range = net/{GROSS_LOW_DIVISOR} .. net/{GROSS_HIGH_DIVISOR} (15–30% store fee); an estimate, not data",
        "period_end": f"{cutoff:%Y-%m}",
        "l12m": f"{l12_start:%Y-%m}..{l12_end:%Y-%m}",
        "regions": {r: cfg["label"] for r, cfg in regions.items()},
        "region_countries": {r: cfg["countries"] for r, cfg in regions.items()},
        "notes": [
            "One granularity per app+month (monthly > weekly > daily); never summed together.",
            "Weekly data is assigned to the month containing the week's Thursday.",
            "partial = month built from incomplete weekly/daily data.",
        ],
    }
    written = []

    def write(name: str, payload: dict) -> None:
        (out_dir / name).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        written.append(name)

    frames = region_frames(monthly, regions)
    write("monthly_by_app.json", {"meta": meta, "apps": {
        slug: {r: _series(frames[r][frames[r]["app_slug"] == slug]) for r in frames}
        for slug in sorted(monthly["app_slug"].unique())}})

    totals, yearly = {}, {}
    for r, df in frames.items():
        df = df.assign(segment=df["app_slug"].map(segment).fillna("unknown"))
        by_month = df.groupby("month").agg(revenue_net=("revenue_net", "sum"), downloads=("downloads", "sum"),
                                          apps=("app_slug", "nunique"), partial=("partial", "max")).reset_index()
        seg = df.pivot_table(index="month", columns="segment", values="revenue_net", aggfunc="sum").fillna(0)
        totals[r] = {
            "months": by_month["month"].dt.strftime("%Y-%m").tolist(),
            "revenue_net": [_round(v) for v in by_month["revenue_net"]],
            "downloads": [_round(v) for v in by_month["downloads"]],
            "apps": by_month["apps"].tolist(),
            "partial": by_month["partial"].astype(bool).tolist(),
            "by_segment": {s: [_round(v) for v in seg[s].reindex(by_month["month"]).fillna(0)] for s in seg.columns},
        }
        df["year"] = df["month"].dt.year
        y = df.groupby("year").agg(revenue_net=("revenue_net", "sum"), downloads=("downloads", "sum"),
                                   months=("month", "nunique")).reset_index()
        yseg = df.pivot_table(index="year", columns="segment", values="revenue_net", aggfunc="sum").fillna(0)
        yearly[r] = [{
            "year": int(row.year), "revenue_net": _round(row.revenue_net), "downloads": _round(row.downloads),
            "partial_year": bool(row.months < 12),
            "months": f"{row.year}-01..{cutoff:%Y-%m}" if row.year == cutoff.year else f"{row.year}-01..{row.year}-12",
            "by_segment": {s: _round(yseg.loc[row.year, s]) for s in yseg.columns},
        } for row in y.itertuples()]
    write("totals_monthly.json", {"meta": meta, **totals})
    write("totals_yearly.json", {"meta": {**meta, "note": "Apps enter the dataset at different dates; early years cover fewer apps."}, **yearly})

    l12 = monthly[(monthly["month"] >= l12_start) & (monthly["month"] <= l12_end)]
    for slug in sorted(monthly["app_slug"].unique()):
        payload = {"meta": {**meta, "app": slug}}
        for label, df in (("all_time", monthly), ("l12m", l12)):
            c = df[df["app_slug"] == slug].groupby("country").agg(revenue_net=("revenue_net", "sum"),
                                                                   downloads=("downloads", "sum"))
            total = c["revenue_net"].sum()
            top = c.sort_values("revenue_net", ascending=False).head(20)
            payload[label] = {
                "period": f"{df['month'].min():%Y-%m}..{df['month'].max():%Y-%m}" if label == "all_time" else meta["l12m"],
                "total_revenue_net": _round(total),
                "countries": [{"country": k, "revenue_net": _round(v.revenue_net), "downloads": _round(v.downloads),
                               "share": _round(v.revenue_net / total, 4) if total else None} for k, v in top.iterrows()],
            }
        write(f"by_country_{slug}.json", payload)

    # every country per app (not truncated), so the UI can sum countries over any set of apps
    p12_start, p12_end = l12_start - pd.DateOffset(months=12), l12_start - pd.DateOffset(months=1)
    by_c = monthly.assign(
        l12=monthly["revenue_net"].where(monthly["month"].between(l12_start, l12_end), 0),
        prev12=monthly["revenue_net"].where(monthly["month"].between(p12_start, p12_end), 0),
        dl12=monthly["downloads"].where(monthly["month"].between(l12_start, l12_end), 0),
    ).groupby(["app_slug", "country"]).agg(l12=("l12", "sum"), prev12=("prev12", "sum"),
                                           all_time=("revenue_net", "sum"), dl12=("dl12", "sum"))
    write("country_by_app.json", {
        "meta": {**meta, "prev12": f"{p12_start:%Y-%m}..{p12_end:%Y-%m}",
                 "columns": ["revenue_net_l12m", "revenue_net_prev_12m", "revenue_net_all_time", "downloads_l12m"]},
        "apps": {slug: {c: [_round(r.l12), _round(r.prev12), _round(r.all_time), _round(r.dl12)]
                        for c, r in g.droplevel(0).iterrows() if r.all_time or r.dl12}
                 for slug, g in by_c.groupby(level=0)},
    })

    split = {}
    for slug, df in monthly.groupby("app_slug"):
        df = df.assign(year=df["month"].dt.year)
        entry = {}
        for region, cfg in regions.items():
            sub = in_region(df, cfg["countries"])
            p = sub.pivot_table(index="year", columns="platform", values="revenue_net", aggfunc="sum").fillna(0)
            l = sub[(sub["month"] >= l12_start) & (sub["month"] <= l12_end)].groupby("platform")["revenue_net"].sum()
            entry[region] = {
                "yearly": [{"year": int(y), **{pl: _round(p.loc[y, pl]) for pl in p.columns}} for y in p.index],
                "l12m": {pl: _round(v) for pl, v in l.items()},
            }
        split[slug] = entry
    write("platform_split.json", {"meta": meta, "apps": split})

    if len(snap):
        apps = (snap.groupby("app_slug").agg(revenue_net=("revenue_net", "sum"), downloads=("downloads", "sum"),
                                             days=("days", "max"), start=("start", "min"), end=("end", "max"))
                .reset_index())
        apps["run_rate"] = apps["revenue_net"] * 365 / apps["days"]
        apps = apps.sort_values("run_rate", ascending=False)
        write("us_snapshot.json", {
            "meta": {**meta, "region": "US", "period": f"{apps['start'].min():%Y-%m-%d}..{apps['end'].max():%Y-%m-%d}",
                     "run_rate": "annualised: sum × 365 / days (days = 18)"},
            "apps": [{
                "app_slug": r.app_slug, "segment": segment.get(r.app_slug), "days": int(r.days),
                "revenue_net": _round(r.revenue_net), "downloads": _round(r.downloads),
                "run_rate_revenue_net": _round(r.run_rate),
                "run_rate_revenue_gross_low": _round(r.run_rate / GROSS_LOW_DIVISOR),
                "run_rate_revenue_gross_high": _round(r.run_rate / GROSS_HIGH_DIVISOR),
                "by_platform": {p.platform: _round(p.revenue_net) for p in snap[snap["app_slug"] == r.app_slug].itertuples()},
            } for r in apps.itertuples()],
        })
    return written


def write_data_sources(paths: Paths, long: pd.DataFrame, catalog: pd.DataFrame) -> None:
    """Audit summary for the «Про дані» page: which files feed the dashboard and what was set aside."""
    from .inputs import load_source_config  # local: avoids a cycle at import time

    names = dict(zip(catalog["slug"], catalog["display_name"]))
    files = []
    for src, g in long.groupby("source_file"):
        runs = g.groupby("granularity")["date"].agg(["min", "max"])
        files.append({
            "file": src.split("/")[-1], "apps": sorted({names.get(s, s) for s in g["app_slug"]}),
            "countries": int(g["country"].nunique()), "us_snapshot": bool(g["us_snapshot"].all()),
            "granularity": [{"granularity": k, "start": f"{v['min']:%Y-%m-%d}", "end": f"{v['max']:%Y-%m-%d}"}
                            for k, v in runs.iterrows()],
            "rows": int(len(g)),
        })
    audit_csv = paths.data / "audit_report.csv"
    audit = pd.read_csv(audit_csv) if audit_csv.exists() else pd.DataFrame()
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "raw_files_scanned": int(len(audit)) if len(audit) else None,
        "byte_identical_duplicates": int(audit["duplicate_of"].notna().sum()) if len(audit) else None,
        "excluded": [{"file": e.get("original_name"), "reason": e.get("reason")}
                     for e in load_source_config(paths.source_config).get("exclude_files", [])],
        "files_used": sorted(files, key=lambda f: f["file"]),
    }
    (paths.web_data / "data_sources.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


# --- run ------------------------------------------------------------------------------------------

def run(paths: Paths) -> dict:
    paths.processed.mkdir(parents=True, exist_ok=True)
    catalog = load_catalog(paths)
    long = long_table(paths, catalog)
    long, n_dup = drop_duplicate_rows(long)
    monthly, dropped = monthly_table(long)
    snap = us_snapshot(long)

    # cutoff: the last month that has complete data for at least one app (later months hold only spill-over weeks)
    complete = monthly[~monthly["partial"]]
    cutoff = complete["month"].max()
    after = monthly[monthly["month"] > cutoff]
    monthly = monthly[monthly["month"] <= cutoff]

    long.drop(columns=["file_md5"]).to_parquet(paths.processed / "long.parquet", index=False)
    monthly.to_parquet(paths.processed / "monthly.parquet", index=False)
    if len(snap):
        snap.to_parquet(paths.processed / "us_snapshot.parquet", index=False)
    written = export_json(paths, monthly, snap, catalog, cutoff)
    write_data_sources(paths, long, catalog)
    written.append("data_sources.json")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "long_rows": int(len(long)), "duplicate_rows_dropped": int(n_dup),
        "lower_priority_rows_dropped": {k: int(v) for k, v in dropped["granularity"].value_counts().items()},
        "cutoff": f"{cutoff:%Y-%m}",
        "rows_after_cutoff_dropped": int(len(after)),
        "partial_months": monthly[monthly["partial"]].groupby("app_slug")["month"].agg(
            lambda s: [f"{m:%Y-%m}" for m in sorted(s.unique())]).to_dict(),
        "us_snapshot_rows": int(long["us_snapshot"].sum()),
        "json": written,
    }
    (paths.processed / "build_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"long table: {len(long):,} rows ({n_dup:,} duplicate rows across files dropped)")
    print(f"monthly: {len(monthly):,} rows, {monthly['app_slug'].nunique()} apps, up to {cutoff:%Y-%m}; "
          f"lower-priority granularity rows dropped: {report['lower_priority_rows_dropped'] or 0}; "
          f"{len(after)} spill-over rows after cutoff dropped")
    print(f"US snapshot: {snap['app_slug'].nunique() if len(snap) else 0} apps")
    print(f"wrote data/processed/{{long,monthly,us_snapshot}}.parquet and {len(written)} JSON files in web/public/data/")
    return report
