"""`make catalog` (Prompt 2): apps from the raw Sensor Tower files + registry.csv + Apple iTunes Lookup
-> data/catalog/apps_catalog.json and web/public/data/apps.json, icons in web/public/icons/.

iTunes responses are cached in data/catalog/cache/ (delete a file there to refresh it).
Google Play links are built from the package name; nothing is scraped.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from difflib import SequenceMatcher

import pandas as pd
import requests

from .inputs import load_inputs
from .paths import Paths
from .st_io import granularity_runs

ITUNES_URL = "https://itunes.apple.com/lookup"
ITUNES_COUNTRIES = ("us", "jp", "kr", "fr")  # us first (as specified); others only for apps missing in the US store
SEGMENTS = ("webtoon_platform", "manga", "western_comics", "webnovel", "short_drama", "ai_comic_drama", "piracy")
STATUSES = ("active", "declining", "closing", "closed", "newcomer")


def is_ios_id(app_id: str) -> bool:
    return str(app_id).isdigit()


def norm_name(name: str) -> str:
    base = re.split(r":| - | – ", str(name))[0]
    return re.sub(r"[^a-z0-9]+", "", base.lower())


def name_score(a: str, b: str) -> float:
    a, b = norm_name(a), norm_name(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if min(len(a), len(b)) >= 5 and (a.startswith(b) or b.startswith(a)):
        return 0.95
    return SequenceMatcher(None, a, b).ratio()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", re.split(r":| - | – |\(", str(name))[0].lower()).strip("-") or "app"


# --- raw files -> one record per Sensor Tower unified app -------------------------------------------

def collect_apps(paths: Paths) -> pd.DataFrame:
    rows, coverage = [], []
    for f, df in load_inputs(paths):
        rel = f.rel(paths.root)
        g_ids = df.groupby(["Unified ID", "Unified Name", "App ID", "App Name", "Platform"], dropna=False).agg(
            revenue=("Revenue ($)", "sum"), developer=("Developer Name", "first"), publisher=("Publisher Name", "first"))
        rows.append(g_ids.reset_index())
        for uid, g in df.groupby("Unified ID"):
            countries = sorted(g["Country / Region"].dropna().astype(str).unique())
            region = countries[0] if len(countries) == 1 else f"WW ({len(countries)} countries)"
            for label, start, end in granularity_runs(g["Date"]):
                coverage.append({"unified_id": uid, "granularity": label, "start": f"{start:%Y-%m-%d}",
                                 "end": f"{end:%Y-%m-%d}", "regions": region, "file": rel})
    ids = pd.concat(rows, ignore_index=True)
    ids = ids.groupby(["Unified ID", "App ID"], as_index=False).agg(
        unified_name=("Unified Name", "first"), app_name=("App Name", "first"), platform=("Platform", "first"),
        revenue=("revenue", "sum"), developer=("developer", "first"), publisher=("publisher", "first"))
    cov = pd.DataFrame(coverage).drop_duplicates(["unified_id", "granularity", "start", "end", "regions"])

    apps = []
    for uid, g in ids.groupby("Unified ID"):
        g = g.sort_values("revenue", ascending=False)
        apps.append({
            "unified_id": uid,
            "unified_name": g["unified_name"].iloc[0],
            "app_names": list(dict.fromkeys(g["app_name"])),
            "ios_ids": [a for a in g["App ID"] if is_ios_id(a)],  # sorted by revenue, main app first
            "android_packages": [a for a in g["App ID"] if not is_ios_id(a)],
            "developer": g["developer"].iloc[0],
            "publisher": g["publisher"].iloc[0],
            "data_coverage": cov[cov["unified_id"] == uid].drop(columns="unified_id").to_dict("records"),
        })
    return pd.DataFrame(apps)


# --- registry matching ----------------------------------------------------------------------------

def match_registry(apps: pd.DataFrame, registry: pd.DataFrame) -> dict[str, int]:
    """unified_id -> registry row index. Store IDs first, then fuzzy name (unified + per-store names)."""
    by_id = {}
    for i, r in registry.iterrows():
        for col in ("ios_id", "android_package"):
            if r[col]:
                by_id[r[col]] = i
    out: dict[str, int] = {}
    for _, a in apps.iterrows():
        hit = next((by_id[x] for x in [*a["ios_ids"], *a["android_packages"]] if x in by_id), None)
        if hit is None:
            best = max(
                ((name_score(n, r["app_name"]), i) for i, r in registry.iterrows()
                 for n in [a["unified_name"], *a["app_names"]]),
                default=(0, None),
            )
            hit = best[1] if best[0] >= 0.85 else None
        if hit is not None:
            if hit in out.values():
                print(f"  ! registry row '{registry.loc[hit, 'app_name']}' matched more than one unified app")
            out[a["unified_id"]] = hit
    return out


# --- Apple iTunes Lookup --------------------------------------------------------------------------

def itunes_lookup(paths: Paths, ios_ids: list[str]) -> dict[str, dict]:
    cache_dir = paths.catalog / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, dict] = {}
    missing = []
    for i in ios_ids:
        f = cache_dir / f"itunes_{i}.json"
        if f.exists():
            out[i] = json.loads(f.read_text(encoding="utf-8"))
        else:
            missing.append(i)
    for country in ITUNES_COUNTRIES:
        if not missing:
            break
        found = {}
        for chunk in (missing[k:k + 100] for k in range(0, len(missing), 100)):
            r = requests.get(ITUNES_URL, params={"id": ",".join(chunk), "country": country}, timeout=30)
            r.raise_for_status()
            for res in r.json().get("results", []):
                found[str(res.get("trackId"))] = {**res, "_lookup_country": country}
            time.sleep(0.5)
        for i in list(missing):
            if i in found:
                out[i] = found[i]
                missing.remove(i)
    for i in missing:  # not in any store we tried: delisted or region-locked
        out[i] = {"_not_found": True}
    for i, res in out.items():
        (cache_dir / f"itunes_{i}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def download_icon(paths: Paths, slug: str, url: str | None) -> str | None:
    if not url:
        return None
    icons = paths.root / "web" / "public" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    dst = icons / f"{slug}.png"
    if not dst.exists():
        try:
            r = requests.get(url.replace("512x512bb.jpg", "512x512bb.png"), timeout=30)
            r.raise_for_status()
            dst.write_bytes(r.content)
        except requests.RequestException as e:
            print(f"  icon for {slug} failed: {e}")
            return None
    return f"/icons/{dst.name}"


# --- assemble -------------------------------------------------------------------------------------

def _reg(r: pd.Series | None, col: str):
    if r is None:
        return None
    v = r.get(col, "")
    return v if v not in ("", None) else None


def load_registry(paths: Paths) -> pd.DataFrame:
    """registry.csv (from the Google Sheet) + data/catalog/extra_apps.csv (maintained by hand).

    An extra row whose slug is already in the registry only fills that row's empty fields;
    other extra rows are new apps (e.g. found in AppKittie / the free-services workbook).
    """
    registry = pd.read_csv(paths.registry_csv, dtype=str).fillna("")
    extra_csv = paths.catalog / "extra_apps.csv"
    if not extra_csv.exists():
        return registry
    extra = pd.read_csv(extra_csv, dtype=str).fillna("")
    for _, e in extra.iterrows():
        hit = registry.index[registry["slug"] == e["slug"]]
        if len(hit):
            for col in registry.columns:
                if col in e and e[col] and not registry.at[hit[0], col]:
                    registry.at[hit[0], col] = e[col]
        else:
            registry = pd.concat([registry, e.to_frame().T], ignore_index=True)
    return registry.fillna("")


def build_catalog(paths: Paths) -> tuple[list[dict], list[str], list[str]]:
    apps = collect_apps(paths)
    registry = load_registry(paths)
    matches = match_registry(apps, registry)

    records = []
    for _, a in apps.iterrows():
        idx = matches.get(a["unified_id"])
        records.append({"st": a, "reg": registry.loc[idx] if idx is not None else None})
    matched_idx = set(matches.values())
    for i, r in registry.iterrows():  # registry apps with no Sensor Tower data yet
        if i not in matched_idx:
            records.append({"st": None, "reg": r})

    all_ios = sorted({i for rec in records for i in (
        list(rec["st"]["ios_ids"]) if rec["st"] is not None else ([rec["reg"]["ios_id"]] if rec["reg"]["ios_id"] else []))})
    print(f"  iTunes lookup for {len(all_ios)} iOS IDs (cached in data/catalog/cache/)")
    itunes = itunes_lookup(paths, all_ios)

    out, unmatched_st = [], []
    for rec in records:
        a, r = rec["st"], rec["reg"]
        ios_ids = list(a["ios_ids"]) if a is not None else ([r["ios_id"]] if r["ios_id"] else [])
        android = list(a["android_packages"]) if a is not None else ([r["android_package"]] if r["android_package"] else [])
        if a is not None and r is not None:
            ios_ids += [x for x in [r["ios_id"]] if x and x not in ios_ids]
            android += [x for x in [r["android_package"]] if x and x not in android]
        main = next((itunes[i] for i in ios_ids if not itunes.get(i, {}).get("_not_found")), {})
        name = _reg(r, "app_name") or a["unified_name"]
        slug = _reg(r, "slug") or slugify(main.get("trackName") or (a["app_names"][-1] if a is not None else name))
        if a is not None and r is None:
            unmatched_st.append(f"{a['unified_name']} (unified {a['unified_id']}, ids {ios_ids + android})")
        out.append({
            "slug": slug,
            "display_name": name,
            "unified_id": a["unified_id"] if a is not None else None,
            "unified_name": a["unified_name"] if a is not None else None,
            "ios_ids": ios_ids,
            "android_packages": android,
            "developer": (a["developer"] if a is not None else None) or main.get("sellerName"),
            "publisher": a["publisher"] if a is not None else None,
            "company": _reg(r, "company"),
            "parent": _reg(r, "parent"),
            "segment": _reg(r, "segment"),
            "ios_category": main.get("primaryGenreName"),
            "status": _reg(r, "status"),
            "status_note": _reg(r, "status_note"),
            "shortlist": _reg(r, "shortlist") == "True",
            "markets": _reg(r, "markets"),
            "monetization": _reg(r, "monetization"),
            "website": _reg(r, "website"),
            "app_store_url": (main.get("trackViewUrl") or "").split("?")[0] or (f"https://apps.apple.com/app/id{ios_ids[0]}" if ios_ids else None),
            "google_play_url": f"https://play.google.com/store/apps/details?id={android[0]}" if android else None,
            "icon_path": download_icon(paths, slug, main.get("artworkUrl512")),
            "rating": round(main["averageUserRating"], 2) if main.get("averageUserRating") is not None else None,
            "rating_count": main.get("userRatingCount"),
            "rating_store": main.get("_lookup_country"),
            "release_date": (main.get("releaseDate") or "")[:10] or None,
            "in_registry": r is not None,
            "has_data": a is not None,
            "data_coverage": list(a["data_coverage"]) if a is not None else [],
        })
    slugs = pd.Series([o["slug"] for o in out])
    if slugs.duplicated().any():
        raise ValueError(f"duplicate slugs: {slugs[slugs.duplicated()].tolist()}")
    no_data = [o["display_name"] for o in out if not o["has_data"]]
    return sorted(out, key=lambda o: (not o["has_data"], o["display_name"].lower())), unmatched_st, no_data


def run(paths: Paths) -> list[dict]:
    apps, unmatched, no_data = build_catalog(paths)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "segments": list(SEGMENTS), "statuses": list(STATUSES),
        "apps": apps,
    }
    text = json.dumps(payload, indent=1, ensure_ascii=False)
    paths.apps_catalog_json.write_text(text, encoding="utf-8")
    paths.web_data.mkdir(parents=True, exist_ok=True)
    (paths.web_data / "apps.json").write_text(text, encoding="utf-8")
    print(f"Catalog: {len(apps)} apps ({sum(a['has_data'] for a in apps)} with Sensor Tower data) "
          f"-> data/catalog/apps_catalog.json, web/public/data/apps.json")
    if unmatched:
        print("Sensor Tower apps NOT matched to registry.csv (fix names/IDs in the Sheet):")
        for u in unmatched:
            print(f"  - {u}")
    print(f"Registry apps without Sensor Tower data ({len(no_data)}): {', '.join(no_data)}")
    return apps
