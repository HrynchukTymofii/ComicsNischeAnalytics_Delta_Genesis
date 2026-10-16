"""`make intel` (Prompt 8): sources other than Sensor Tower -> per-app "intel" + market signals.

Reads the non-Sensor-Tower files in data/raw/genesis (AppKittie, Google Play reviews, the free-services
workbook), routed by file name, and writes:
  web/public/data/intel/{slug}.json     one bundle per app (app page sections)
  web/public/data/intel_index.json      which sections each app has
  web/public/data/market_signals.json   market-level tables (trends, keywords, web traffic, deals…);
                                        paywall screenshots go to the app pages only
  web/public/creatives/                 downloaded ad creatives / screenshots (resized)
  data/processed/intel.json             everything, for the MCP server
  data/processed/intel_report.json      files used / ignored / unmatched names

Rules: values are snapshots tagged with source + as_of; money carries `revenue_basis` and `bound`
(AppMagic gives lower bounds only). Nothing here is added to Sensor Tower numbers (CLAUDE.md rule 5).
"""
from __future__ import annotations

import fnmatch
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .audit import md5, other_raw_files
from .inputs import load_source_config
from .paths import Paths
from .sources import appkittie, free_services, gp_reviews
from .sources.common import AppMatcher, json_safe
from .sources.media import Media

# file-name pattern -> adapter key; first match wins. None = known file, deliberately not read.
ROUTES: list[tuple[str, str | None, str]] = [
    ("AK_пошук_*.csv", "ak_search", "AppKittie: пошук застосунків"),
    ("AK_картка_*.docx", "ak_card", "AppKittie: картка застосунку"),
    ("AK_реклама_*скріни*.docx", None, "скріни тих самих оголошень, що й у CSV (медіа беремо з CSV)"),
    ("AK_реклама_*.csv", "ak_ads", "AppKittie: реклама (Meta / Google)"),
    ("AK_ключові-слова_*.csv", "ak_keywords", "AppKittie: ключові слова"),
    ("AK_креатори_*.csv", "ak_creators", "AppKittie: креатори"),
    ("AK_пейволи_*.docx", "ak_paywalls", "AppKittie: онбординги й пейволи (скріни)"),
    ("AK_інтерфейс_*.docx", None, "інструкція до інтерфейсу AppKittie, не дані"),
    ("GP_відгуки_*.csv", "gp_reviews", "Google Play: відгуки"),
    ("FREE_*.xlsx", "free", "Безкоштовні сервіси: Similarweb, AppMagic, сторі, Meta Ad Library, Trends, SEC"),
]


def route(name: str) -> tuple[str | None, str] | None:
    return next(((key, label) for pat, key, label in ROUTES if fnmatch.fnmatch(name, pat)), None)


def _basis(cfg: dict, source: str) -> str | None:
    return (cfg.get(source) or {}).get("revenue_basis")


def collect(paths: Paths) -> dict:
    cfg = load_source_config(paths.source_config)
    excluded = {e["md5"]: e.get("reason") for e in cfg.get("exclude_files", [])}
    match = AppMatcher.load(paths)
    files: dict[str, list[Path]] = defaultdict(list)
    report = {"used": [], "ignored": [], "excluded": [], "unknown": []}
    for p in other_raw_files(paths):
        rel = p.relative_to(paths.root).as_posix()
        h = md5(p)
        if h in excluded:
            report["excluded"].append({"file": rel, "reason": excluded[h]})
            continue
        r = route(p.name)
        if r is None:
            report["unknown"].append(rel)
        elif r[0] is None:
            report["ignored"].append({"file": rel, "reason": r[1]})
        else:
            files[r[0]].append(p)
            report["used"].append({"file": rel, "kind": r[1], "md5": h})

    data: dict = {"cfg": cfg, "report": report, "match": match}
    data["ak_search"] = appkittie.dedupe_search([row for f in files["ak_search"] for row in appkittie.read_search(f, match)])
    data["ak_cards"] = [appkittie.read_card(f, match) for f in files["ak_card"]]
    data["ak_ads"] = [row for f in files["ak_ads"] for row in appkittie.read_ads(f, match)]
    data["ak_keywords"] = [row for f in files["ak_keywords"] for row in appkittie.read_keywords(f, match)]
    data["ak_creators"] = [row for f in files["ak_creators"] for row in appkittie.read_creators(f, match)]
    data["ak_paywalls"] = [row for f in files["ak_paywalls"] for row in appkittie.read_paywalls(f, match)]
    if files["gp_reviews"]:
        reviews, dropped = gp_reviews.dedupe(pd.concat([gp_reviews.read(f, match) for f in files["gp_reviews"]], ignore_index=True))
        report["review_duplicates_dropped"] = dropped
        data["reviews"] = reviews
    else:
        data["reviews"] = pd.DataFrame()
    data["free"] = [free_services.read(f, match) for f in files["free"]]
    report["unmatched_names"] = sorted(match.unmatched)
    return data


# --- assemble ---------------------------------------------------------------------------------------

def _estimates(data: dict) -> dict[str, list[dict]]:
    cfg = data["cfg"]
    out: dict[str, list[dict]] = defaultdict(list)
    ak_basis = _basis(cfg, "appkittie")
    for r in data["ak_search"]:
        if r["slug"]:
            out[r["slug"]].append({
                "source": "AppKittie", "kind": "search", "as_of": r["as_of"], "store": r["store"], "region": "world",
                "period_days": 30, "revenue": r["revenue"], "downloads": r["downloads"], "bound": "point",
                "revenue_basis": ak_basis, "meta_spend_30d": r["meta_spend_30d"], "queries": r["queries"],
            })
    for c in data["ak_cards"]:
        if c["slug"]:
            out[c["slug"]].append({
                "source": "AppKittie", "kind": "card", "as_of": c["as_of"], "store": c["store"], "region": "world",
                "period_days": 30, "revenue": c["revenue"], "downloads": c["downloads"], "bound": "point",
                "revenue_basis": ak_basis, "revenue_growth_30d": c["revenue_growth_30d"],
                "downloads_growth_30d": c["downloads_growth_30d"], "trend_notes": c["trend_notes"],
            })
    am_basis = _basis(cfg, "appmagic")
    for f in data["free"]:
        for r in f["appmagic"]:
            if r["slug"]:
                out[r["slug"]].append({
                    "source": "AppMagic", "kind": "demo", "as_of": r["as_of"], "store": "unknown", "region": "world",
                    "period_days": 30, "period_note": r["period_note"], "revenue": r["revenue"], "downloads": r["downloads"],
                    "bound": "lower", "revenue_basis": am_basis,
                    "revenue_by_country": r["revenue_by_country"], "downloads_by_country": r["downloads_by_country"],
                })
    return out


def _creative(ad: dict, media: Media, slug: str) -> dict:
    m = media.publish_url(ad["media_url"], slug)
    return {k: v for k, v in ad.items() if k not in ("media_url", "slug")} | {"media": m}


def assemble(paths: Paths, data: dict, media: Media) -> tuple[dict[str, dict], dict]:
    apps: dict[str, dict] = defaultdict(dict)
    for slug, rows in _estimates(data).items():
        apps[slug]["estimates"] = rows

    for r in data["ak_search"]:
        if r["slug"]:
            apps[r["slug"]].setdefault("store_listings", []).append({k: r[k] for k in (
                "source", "as_of", "store", "app_name", "category", "rating", "rating_count", "release_date", "updated")})

    # monetization: pricing model text (workbook), US store IAP text (workbook), IAP lists (AppKittie cards)
    for c in data["ak_cards"]:
        if c["slug"]:
            mon = apps[c["slug"]].setdefault("monetization", {"models": [], "iap": [], "store_iap_text": []})
            mon["iap"] += [{**i, "store": c["store"], "source": "AppKittie", "as_of": c["as_of"]} for i in c["iap"]]
            if c["description"]:
                apps[c["slug"]]["store_description"] = {"text": c["description"], "store": c["store"], "source": "AppKittie", "as_of": c["as_of"]}
            apps[c["slug"]].setdefault("store_listings", []).append({
                "source": "AppKittie (картка)", "as_of": c["as_of"], "store": c["store"], "app_name": c["app_name"],
                "category": c.get("category"), "rating": c["rating"], "rating_count": c["rating_count"],
                "release_date": c["release_date"], "updated": c["updated"]})
    for f in data["free"]:
        src = "Безкоштовні сервіси (ручний збір)"
        for b in f["brands"]:
            if not b["slug"]:
                continue
            a = apps[b["slug"]]
            a["profile"] = {"brand": b["brand"], "type": b["type"], "owner": b["owner"], "note": b["note"],
                            "deals_text": b["deals"], "source": src, "as_of": f["as_of"]}
            if b["monetization"]:
                a.setdefault("monetization", {"models": [], "iap": [], "store_iap_text": []})["models"].append(
                    {"text": b["monetization"], "source": src, "as_of": f["as_of"]})
            if b["ad_keyword"]:
                a.setdefault("ads", {})["ad_library"] = {"keyword": b["ad_keyword"], "active_ads": b["active_ads"],
                                                         "advertisers": b["advertisers"], "region": "US", "as_of": f["as_of"],
                                                         "source": "Meta Ad Library"}
        for s in f["stores_us"]:
            if s["slug"]:
                apps[s["slug"]]["store_us"] = s
                if s["ios_iap"]:
                    apps[s["slug"]].setdefault("monetization", {"models": [], "iap": [], "store_iap_text": []})["store_iap_text"].append(
                        {"text": s["ios_iap"], "store": "ios", "region": "US", "source": "App Store (US)", "as_of": s["as_of"]})
        for w in f["web"]:
            if w.get("slug"):
                apps[w["slug"]]["web"] = w
        # brand set («Набір 2: бренди») first; the category set only fills apps the brand set lacks (wattpad, reelshort)
        for t in sorted(f["google_trends"], key=lambda t: t.get("title") is None):
            for kw in t["keywords"]:
                slug = data["match"].by_name(kw)
                if slug and "trends" not in apps.get(slug, {}):
                    apps[slug]["trends"] = {"keyword": kw, "set": t.get("title"), "note": t.get("note"), "source": t["source"],
                                            "years": [{"year": y["year"], "value": y.get(kw)} for y in t["years"]],
                                            "compare": {k: [y.get(k) for y in t["years"]] for k in t["keywords"]}}
        hooks = f["ad_hooks"]
        if hooks.get("slug"):
            apps[hooks["slug"]].setdefault("ads", {})["hooks"] = hooks
        for o in f["appmagic_overlap"]:
            if o["app_slug"]:
                apps[o["app_slug"]].setdefault("overlap", []).append(o)
        for s in f["appmagic_similar"]:
            if s["app_slug"]:
                apps[s["app_slug"]]["similar_apps"] = s["similar"]
        for d in f["deals"]:
            for slug in d["slugs"]:
                apps[slug].setdefault("deals", []).append(d)
        if f["sec_webtoon"]["slug"]:
            apps[f["sec_webtoon"]["slug"]]["sec"] = f["sec_webtoon"]["rows"]

    for ad in data["ak_ads"]:
        if ad["slug"]:
            apps[ad["slug"]].setdefault("ads", {}).setdefault("creatives", []).append(_creative(ad, media, ad["slug"]))
    for c in data["ak_creators"]:
        if c["slug"]:
            apps[c["slug"]].setdefault("creators", []).append(c)
    for pw in data["ak_paywalls"]:
        shots = [m for name, blob in pw["images"] if (m := media.publish_bytes(blob, name, "paywalls"))]
        pw["shots"] = shots
        if pw["slug"]:
            apps[pw["slug"]].setdefault("paywalls", []).append({"app_name": pw["app_name"], "shots": shots,
                                                               "source": pw["source"], "as_of": pw["as_of"]})
    rv = data["reviews"]
    if len(rv):
        for slug, g in rv[rv["slug"].notna()].groupby("slug"):
            apps[slug]["reviews"] = gp_reviews.app_reviews(g)

    market = _market(data)
    rep = data["report"]
    market["sources"] = {"used": [{"file": u["file"].split("/")[-1], "kind": u["kind"]} for u in rep["used"]],
                         "ignored": [{**i, "file": i["file"].split("/")[-1]} for i in rep["ignored"]],
                         "excluded": [{**e, "file": e["file"].split("/")[-1]} for e in rep["excluded"]]}
    return dict(apps), market


def _market(data: dict) -> dict:
    f = data["free"][0] if data["free"] else {}
    return {
        "readme": f.get("readme", []), "how_to_read": f.get("how_to_read", []),
        "google_trends": f.get("google_trends", []),
        "keywords": data["ak_keywords"],
        "meta_ad_library": f.get("meta_ad_library", []),
        "web": f.get("web", []),
        "appmagic": f.get("appmagic", []), "appmagic_overlap": f.get("appmagic_overlap", []),
        "deals": f.get("deals", []), "sec_webtoon": (f.get("sec_webtoon") or {}).get("rows", []),
        "alternativeto": f.get("alternativeto", []), "alternativeto_for": f.get("alternativeto_for"),
        "gaps": f.get("gaps", []),
        "appkittie_search": data["ak_search"],
        "brands": f.get("brands", []),
        "as_of": {"free_services": f.get("as_of"), "appkittie": max((r["as_of"] for r in data["ak_search"]), default=None)},
        "revenue_basis": {"AppKittie": _basis(data["cfg"], "appkittie"), "AppMagic": _basis(data["cfg"], "appmagic")},
    }


SECTION_KEYS = ["estimates", "monetization", "reviews", "ads", "web", "trends", "deals", "sec", "store_us",
                "store_listings", "paywalls", "creators", "profile", "overlap"]


def run(paths: Paths) -> dict:
    data = collect(paths)
    media = Media(paths)
    apps, market = assemble(paths, data, media)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    out_dir = paths.web_data / "intel"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.json"):
        old.unlink()
    def dump(obj) -> str:
        return json.dumps(json_safe(obj), ensure_ascii=False, separators=(",", ":"), default=str, allow_nan=False)
    for slug, a in apps.items():
        (out_dir / f"{slug}.json").write_text(dump({"meta": {"generated_at": now, "slug": slug}, **a}), encoding="utf-8")
    index = {"generated_at": now, "apps": {slug: [k for k in SECTION_KEYS if k in a] for slug, a in sorted(apps.items())}}
    (paths.web_data / "intel_index.json").write_text(dump(index), encoding="utf-8")
    (paths.web_data / "market_signals.json").write_text(dump({"meta": {"generated_at": now}, **market}), encoding="utf-8")
    paths.processed.mkdir(parents=True, exist_ok=True)
    (paths.processed / "intel.json").write_text(dump({"generated_at": now, "apps": apps, "market": market}), encoding="utf-8")

    report = {**data["report"], "generated_at": now, "apps_with_intel": len(apps),
              "media_failed": media.failed, "media_removed": media.prune()}
    (paths.processed / "intel_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Intel: {len(report['used'])} files used, {len(report['ignored'])} ignored, {len(report['excluded'])} excluded, "
          f"{len(apps)} apps -> web/public/data/intel/, market_signals.json")
    for k in ("unknown", "media_failed"):
        if report[k]:
            print(f"  ! {k}: {report[k]}")
    if report["unmatched_names"]:
        print(f"  names not in the catalog (add to data/catalog/aliases.json or extra_apps.csv if they matter): "
              f"{', '.join(report['unmatched_names'])}")
    return report
