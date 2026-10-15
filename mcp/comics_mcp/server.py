"""MCP server (official `mcp` SDK, FastMCP) over the comics-market data.

Reads data/processed/{monthly,us_snapshot}.parquet and data/catalog/apps_catalog.json via duckdb.
Run: `make mcp` (stdio). Every result carries `period`, `region` and `revenue_basis` (CLAUDE.md rule 3).
Revenue is Sensor Tower NET (after Apple/Google fees); with basis="gross" an estimated range
net/0.85 .. net/0.70 is added — it is an estimate, not data.
"""
from __future__ import annotations

import json
import os
import re
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path

import duckdb
from mcp.server.fastmcp import FastMCP

try:
    # duckdb imports pandas/numpy lazily on the first parameterised query. Under the stdio server that
    # happens on a worker thread, and on Windows the numpy import deadlocks there — so import it now,
    # on the main thread. (Optional: without pandas installed, duckdb never tries.)
    import pandas  # noqa: F401
except ImportError:
    pass

ROOT = Path(os.environ.get("COMICS_REPO_ROOT", Path(__file__).resolve().parents[2]))
PROCESSED = ROOT / "data" / "processed"
CATALOG = ROOT / "data" / "catalog" / "apps_catalog.json"
SITE_ICONS = "web/public"  # icon_path values are relative to this folder

GROSS_LOW, GROSS_HIGH = 0.85, 0.70
BASIS = {
    "net": "net — Sensor Tower estimate, after Apple/Google store fees, USD",
    "gross": "net (Sensor Tower, USD) + estimated gross range net/0.85 … net/0.70 — an estimate, not data",
}
def _load_regions() -> dict[str, dict]:
    f = ROOT / "data" / "catalog" / "regions.json"
    if not f.exists():
        return {"world": {"label": "World", "countries": None}, "us": {"label": "United States", "countries": ["US"]}}
    return {k: v for k, v in json.loads(f.read_text(encoding="utf-8")).items() if not k.startswith("_")}


REGION_DEFS = _load_regions()  # world | us | tier1 (data/catalog/regions.json)
REGIONS = {k: v["label"] for k, v in REGION_DEFS.items()}
METRICS = ("revenue", "downloads", "rpd")
VIDEO_SEGMENTS = ["short_drama", "ai_comic_drama"]  # video formats, not image comics: excluded from totals by default
NOTE = ("One granularity per app+month (monthly > weekly > daily), never summed; weekly values are split "
        "across months by days. Sources are never merged.")

mcp = FastMCP("comics-market")


# --- data access ----------------------------------------------------------------------------------

def _pq(name: str) -> str:
    p = PROCESSED / f"{name}.parquet"
    if not p.exists():
        raise FileNotFoundError(f"{p.name} not found — run `make build-data` first")
    return p.as_posix()


@lru_cache(maxsize=1)
def catalog() -> list[dict]:
    if not CATALOG.exists():
        raise FileNotFoundError("apps_catalog.json not found — run `make catalog` first")
    return json.loads(CATALOG.read_text(encoding="utf-8"))["apps"]


def con() -> duckdb.DuckDBPyConnection:
    c = duckdb.connect()
    c.execute(f"CREATE VIEW monthly AS SELECT * FROM read_parquet('{_pq('monthly')}')")
    c.execute("CREATE TABLE apps(slug VARCHAR, name VARCHAR, segment VARCHAR, status VARCHAR)")
    c.executemany("INSERT INTO apps VALUES (?, ?, ?, ?)",
                  [(a["slug"], a["display_name"], a["segment"], a["status"]) for a in catalog()])
    return c


def rows(sql: str, params: list | None = None) -> list[dict]:
    with con() as c:
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def data_end() -> str:
    return rows("SELECT strftime(max(month), '%Y-%m') AS m FROM monthly")[0]["m"]


def resolve_app(app: str) -> dict:
    """Accept a slug or (part of) a name; fuzzy-match as a last resort."""
    q = app.strip().lower()
    apps = catalog()
    for a in apps:
        if a["slug"] == q or a["display_name"].lower() == q:
            return a
    hits = [a for a in apps if q in a["display_name"].lower() or q in a["slug"]]
    if len(hits) == 1:
        return hits[0]
    best = max(apps, key=lambda a: SequenceMatcher(None, q, a["display_name"].lower()).ratio())
    if hits:
        raise ValueError(f"'{app}' is ambiguous: {[a['slug'] for a in hits]}")
    if SequenceMatcher(None, q, best["display_name"].lower()).ratio() > 0.6:
        return best
    raise ValueError(f"unknown app '{app}'; use list_apps to see slugs")


def add_months(ym: str, n: int) -> str:
    y, m = map(int, ym.split("-"))
    t = y * 12 + (m - 1) + n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def parse_period(period: str | None) -> tuple[str, str, str]:
    """'l12m' | 'all' | 'YYYY' | 'YYYY-MM' | 'YYYY-MM..YYYY-MM' -> (start, end, label)."""
    end = data_end()
    p = (period or "l12m").strip().lower()
    if p == "l12m":
        start = add_months(end, -11)
        return start, end, f"L12M {start}..{end}"
    if p == "all":
        start = rows("SELECT strftime(min(month), '%Y-%m') AS m FROM monthly")[0]["m"]
        return start, end, f"{start}..{end}"
    if re.fullmatch(r"\d{4}", p):
        e = min(f"{p}-12", end)
        return f"{p}-01", e, f"{p}-01..{e}" + (" (partial year)" if e != f"{p}-12" else "")
    if re.fullmatch(r"\d{4}-\d{2}", p):
        return p, p, p
    m = re.fullmatch(r"(\d{4}-\d{2})\.\.(\d{4}-\d{2})", p)
    if m:
        return m.group(1), m.group(2), p
    raise ValueError("period must be 'l12m', 'all', 'YYYY', 'YYYY-MM' or 'YYYY-MM..YYYY-MM'")


def check_region(region: str) -> str:
    if region not in REGIONS:
        raise ValueError(f"region must be one of {list(REGIONS)}")
    codes = REGION_DEFS[region]["countries"]
    if not codes:
        return ""
    if not all(c.isalnum() for c in codes):  # codes come from our config; keep the SQL literal safe anyway
        raise ValueError("bad country code in regions.json")
    return "AND country IN (" + ", ".join(f"'{c}'" for c in codes) + ")"


def money(net: float | None, basis: str) -> dict:
    if net is None:
        return {"revenue_net": None}
    out = {"revenue_net": round(net, 2)}
    if basis == "gross":
        out["revenue_gross_low_est"] = round(net / GROSS_LOW, 2)
        out["revenue_gross_high_est"] = round(net / GROSS_HIGH, 2)
    return out


def envelope(period: str, region: str, basis: str, **payload) -> dict:
    if basis not in BASIS:
        raise ValueError("basis must be 'net' or 'gross'")
    return {"period": period, "region": REGIONS[region], "revenue_basis": BASIS[basis],
            "source": "Sensor Tower", "currency": "USD", **payload, "note": NOTE}


def links(a: dict) -> dict:
    return {k: a.get(k) for k in ("app_store_url", "google_play_url", "website")} | {
        "icon": f"{SITE_ICONS}{a['icon_path']}" if a.get("icon_path") else None}


def l12m_kpis(slug: str, region: str) -> dict:
    end = data_end()
    s, ps, pe = add_months(end, -11), add_months(end, -23), add_months(end, -12)
    r = rows(f"""SELECT
          sum(revenue_net) FILTER (WHERE month BETWEEN ?::DATE AND ?::DATE) AS l12,
          sum(downloads)   FILTER (WHERE month BETWEEN ?::DATE AND ?::DATE) AS dl12,
          sum(revenue_net) FILTER (WHERE month BETWEEN ?::DATE AND ?::DATE) AS p12,
          count(DISTINCT month) FILTER (WHERE month BETWEEN ?::DATE AND ?::DATE) AS pm
        FROM monthly WHERE app_slug = ? {check_region(region)}""",
             [f"{s}-01", f"{end}-01", f"{s}-01", f"{end}-01", f"{ps}-01", f"{pe}-01", f"{ps}-01", f"{pe}-01", slug])[0]
    yoy = (r["l12"] / r["p12"] - 1) if r["p12"] and r["pm"] == 12 and r["l12"] is not None else None
    status = None if yoy is None else "growing" if yoy > 0.05 else "declining" if yoy < -0.05 else "stable"
    return {"l12m": f"{s}..{end}", "l12m_revenue_net": r["l12"], "l12m_downloads": r["dl12"],
            "prev_12m_revenue_net": r["p12"] if r["pm"] == 12 else None,
            "yoy": round(yoy, 4) if yoy is not None else None, "growth_status": status,
            "rpd": round(r["l12"] / r["dl12"], 3) if r["l12"] and r["dl12"] else None}


# --- tools ----------------------------------------------------------------------------------------

@mcp.tool()
def list_apps(segment: str | None = None, status: str | None = None) -> dict:
    """List apps in the catalog with links and icons.

    segment: webtoon_platform | manga | western_comics | webnovel | short_drama | ai_comic_drama | piracy
    status: active | declining | closing | closed | newcomer
    """
    apps = [a for a in catalog() if (not segment or a["segment"] == segment) and (not status or a["status"] == status)]
    return {"period": None, "region": None, "revenue_basis": "no revenue figures in this result",
            "count": len(apps), "apps": [{
                "slug": a["slug"], "name": a["display_name"], "segment": a["segment"], "status": a["status"],
                "shortlist": a.get("shortlist"), "developer": a.get("developer"), "parent": a.get("parent"),
                "has_sensor_tower_data": a["has_data"], **links(a)} for a in apps]}


@mcp.tool()
def app_profile(app: str, region: str = "world", basis: str = "net") -> dict:
    """Catalog entry for one app (slug or name) plus L12M KPIs: revenue, downloads, YoY, growth status, RPD."""
    a = resolve_app(app)
    k = l12m_kpis(a["slug"], region) if a["has_data"] else {}
    k_money = {**money(k.get("l12m_revenue_net"), basis)} if k else {}
    return envelope(k.get("l12m", "L12M"), region, basis, app={
        "slug": a["slug"], "name": a["display_name"], "segment": a["segment"], "status": a["status"],
        "status_note": a.get("status_note"), "company": a.get("company"), "parent": a.get("parent"),
        "developer": a.get("developer"), "ios_category": a.get("ios_category"), "rating": a.get("rating"),
        "rating_count": a.get("rating_count"), "release_date": a.get("release_date"),
        "ios_ids": a["ios_ids"], "android_packages": a["android_packages"],
        "data_coverage": a.get("data_coverage"), **links(a)},
        kpis={**k, **{f"l12m_{key}": v for key, v in k_money.items()}} if k else "no Sensor Tower monthly data")


@mcp.tool()
def timeseries(app: str, metric: str = "revenue", region: str = "world", start: str | None = None,
               end: str | None = None, granularity: str = "month", basis: str = "net") -> dict:
    """Monthly or yearly series for one app. metric: revenue | downloads | rpd. Months as YYYY-MM."""
    a = resolve_app(app)
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {METRICS}")
    if granularity not in ("month", "year"):
        raise ValueError("granularity must be 'month' or 'year'")
    s, e, _ = parse_period(f"{start or '2000-01'}..{end or data_end()}")
    bucket = "strftime(month, '%Y-%m')" if granularity == "month" else "strftime(month, '%Y')"
    data = rows(f"""SELECT {bucket} AS period, sum(revenue_net) AS revenue_net, sum(downloads) AS downloads,
                           bool_or(partial) AS partial, any_value(granularity) AS source_granularity,
                           count(DISTINCT month) AS months
                    FROM monthly WHERE app_slug = ? AND month BETWEEN ?::DATE AND ?::DATE {check_region(region)}
                    GROUP BY 1 ORDER BY 1""", [a["slug"], f"{s}-01", f"{e}-01"])
    out = []
    for r in data:
        v = {"period": r["period"], "partial": r["partial"] or (granularity == "year" and r["months"] < 12),
             "source_granularity": r["source_granularity"]}
        if metric == "revenue":
            v |= money(r["revenue_net"], basis)
        elif metric == "downloads":
            v["downloads"] = r["downloads"]
        else:
            v["rpd_net"] = round(r["revenue_net"] / r["downloads"], 4) if r["downloads"] else None
        out.append(v)
    label = f"{out[0]['period']}..{out[-1]['period']}" if out else f"{s}..{e}"
    return envelope(label, region, basis, app=a["slug"], metric=metric, granularity=granularity, series=out)


@mcp.tool()
def total_market(region: str = "world", by: str = "app", period: str = "l12m", basis: str = "net",
                 segments: list[str] | None = None, include_video: bool = False) -> dict:
    """Total revenue of the dataset for a period, broken down by 'app' or 'segment'.

    period: 'l12m' | 'all' | 'YYYY' | 'YYYY-MM' | 'YYYY-MM..YYYY-MM'. Optional segment filter.
    Video formats (short_drama: ReelShort, DramaBox; ai_comic_drama: MoboDrama) are excluded unless
    include_video=True or they are named in `segments`.
    Note: the dataset covers the tracked apps only, and apps enter it at different dates.
    """
    if by not in ("app", "segment"):
        raise ValueError("by must be 'app' or 'segment'")
    if not segments and not include_video:
        segments = sorted({a["segment"] for a in catalog() if a["segment"]} - set(VIDEO_SEGMENTS))
    s, e, label = parse_period(period)
    seg_sql = "AND a.segment IN (SELECT unnest(?))" if segments else ""
    key = "m.app_slug, any_value(a.name) AS name, any_value(a.segment) AS segment" if by == "app" else "a.segment"
    group = "m.app_slug" if by == "app" else "a.segment"
    data = rows(f"""SELECT {key}, sum(m.revenue_net) AS revenue_net, sum(m.downloads) AS downloads
                    FROM monthly m JOIN apps a ON a.slug = m.app_slug
                    WHERE m.month BETWEEN ?::DATE AND ?::DATE {check_region(region).replace('country', 'm.country', 1)} {seg_sql}
                    GROUP BY {group} ORDER BY revenue_net DESC""",
                [f"{s}-01", f"{e}-01", *([segments] if segments else [])])
    total = sum(r["revenue_net"] or 0 for r in data)
    for r in data:
        r["share"] = round(r["revenue_net"] / total, 4) if total else None
        r |= money(r.pop("revenue_net"), basis)
    shares = [r["share"] or 0 for r in data]
    return envelope(label, region, basis, by=by, segments=segments or "all", total=money(total, basis),
                    concentration={"top1": round(sum(shares[:1]), 4), "top2": round(sum(shares[:2]), 4),
                                   "top5": round(sum(shares[:5]), 4)} if by == "app" else None,
                    breakdown=data)


@mcp.tool()
def compare_apps(apps: list[str], metric: str = "revenue", region: str = "world", period: str = "l12m",
                 basis: str = "net") -> dict:
    """Compare 2+ apps on one metric (revenue | downloads | rpd) over a period, with YoY for L12M."""
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {METRICS}")
    s, e, label = parse_period(period)
    out = []
    for name in apps:
        a = resolve_app(name)
        r = rows(f"""SELECT sum(revenue_net) AS rev, sum(downloads) AS dl FROM monthly
                     WHERE app_slug = ? AND month BETWEEN ?::DATE AND ?::DATE {check_region(region)}""",
                 [a["slug"], f"{s}-01", f"{e}-01"])[0]
        v = {"slug": a["slug"], "name": a["display_name"], "segment": a["segment"]}
        if metric == "revenue":
            v |= money(r["rev"], basis)
        elif metric == "downloads":
            v["downloads"] = r["dl"]
        else:
            v["rpd_net"] = round(r["rev"] / r["dl"], 4) if r["rev"] and r["dl"] else None
        if (period or "l12m").lower() == "l12m" and a["has_data"]:
            k = l12m_kpis(a["slug"], region)
            v |= {"yoy": k["yoy"], "growth_status": k["growth_status"]}
        out.append(v)
    return envelope(label, region, basis, metric=metric, apps=out)


@mcp.tool()
def top_countries(app: str, metric: str = "revenue", period: str = "l12m", limit: int = 10, basis: str = "net") -> dict:
    """Top countries for one app by revenue or downloads (world data only)."""
    a = resolve_app(app)
    if metric not in ("revenue", "downloads"):
        raise ValueError("metric must be 'revenue' or 'downloads'")
    s, e, label = parse_period(period)
    col = "revenue_net" if metric == "revenue" else "downloads"
    data = rows(f"""SELECT country, sum(revenue_net) AS revenue_net, sum(downloads) AS downloads,
                           sum({col}) / sum(sum({col})) OVER () AS share
                    FROM monthly WHERE app_slug = ? AND month BETWEEN ?::DATE AND ?::DATE
                    GROUP BY country ORDER BY sum({col}) DESC LIMIT ?""",
                [a["slug"], f"{s}-01", f"{e}-01", int(limit)])
    for r in data:
        r["share"] = round(r["share"], 4) if r["share"] is not None else None
        r |= money(r.pop("revenue_net"), basis)
    return envelope(label, "world", basis, app=a["slug"], metric=metric, countries=data)


@mcp.tool()
def growth_table(region: str = "world", basis: str = "net") -> dict:
    """Every app with L12M revenue, previous 12 months, YoY and growth status
    (growing > +5%, stable −5..+5%, declining < −5%), sorted by L12M revenue."""
    out = []
    for a in catalog():
        if not a["has_data"]:
            continue
        k = l12m_kpis(a["slug"], region)
        if k["l12m_revenue_net"] is None:
            continue
        out.append({"slug": a["slug"], "name": a["display_name"], "segment": a["segment"],
                    **{f"l12m_{key}": v for key, v in money(k["l12m_revenue_net"], basis).items()},
                    "prev_12m_revenue_net": k["prev_12m_revenue_net"], "yoy": k["yoy"],
                    "growth_status": k["growth_status"], "rpd": k["rpd"]})
    out.sort(key=lambda r: -(r["l12m_revenue_net"] or 0))
    end = data_end()
    return envelope(f"L12M {add_months(end, -11)}..{end} vs previous 12 months", region, basis, apps=out)


@mcp.tool()
def us_snapshot_ranking(basis: str = "net") -> dict:
    """US run-rate ranking from the daily Sensor Tower snapshot (13–30.09.2026): sum × 365 / days."""
    data = rows(f"""SELECT s.app_slug, any_value(a.name) AS name, any_value(a.segment) AS segment,
                           sum(s.revenue_net) AS revenue_net, sum(s.downloads) AS downloads, max(s.days) AS days,
                           strftime(min(s.start), '%Y-%m-%d') AS start, strftime(max(s."end"), '%Y-%m-%d') AS "end"
                    FROM read_parquet('{_pq('us_snapshot')}') s JOIN apps a ON a.slug = s.app_slug
                    GROUP BY s.app_slug ORDER BY revenue_net DESC""")
    for r in data:
        rr = r["revenue_net"] * 365 / r["days"]
        r |= {f"run_rate_{k}": v for k, v in money(rr, basis).items()}
        r |= {f"window_{k}": v for k, v in money(r.pop("revenue_net"), basis).items()}
    period = f"{data[0]['start']}..{data[0]['end']} (annualised ×365/{data[0]['days']})" if data else "n/a"
    return envelope(period, "us", basis, apps=data)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
