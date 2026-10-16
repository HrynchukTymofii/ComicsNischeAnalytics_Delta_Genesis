"""AppKittie exports (data/raw/genesis/02_AppKittie): app search, app cards (.docx), Meta/Google ads,
App Store keywords, creators and onboarding/paywall screenshots (.docx).

Revenue / downloads are AppKittie *estimates* for the last ~30 days, per store. Basis comes from
source_config.json ("appkittie": net, user decision 2026-10-16). They are shown next to Sensor
Tower, never added to it.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from .common import AppMatcher, clean, docx_blocks, num

SOURCE = "AppKittie"
STORE = {"App Store": "ios", "Google Play": "android", "iOS": "ios", "GooglePlay": "android"}
PERIOD = {"разово": "once", "тиждень": "week", "місяць": "month", "рік": "year"}


def file_date(path: Path) -> str:
    """'…_14.10.csv' -> '2026-10-14' (year taken from the file's modification time)."""
    m = re.search(r"_(\d{1,2})\.(\d{1,2})\.\w+$", path.name)
    year = datetime.fromtimestamp(path.stat().st_mtime).year
    return date(year, int(m.group(2)), int(m.group(1))).isoformat() if m else ""


def _as_of(df: pd.DataFrame, path: Path) -> str:
    if "Дані станом на" in df and df["Дані станом на"].notna().any():
        return str(df["Дані станом на"].dropna().max())[:10]
    return file_date(path)


def _read(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding="utf-8-sig", dtype=str)


def ak_store_ids(ak_slug: str) -> tuple[str | None, str | None]:
    """AppKittie slugs: 'app-…-id594237344' (iOS) or 'google-play-comvizwsjandroid' (package without dots)."""
    m = re.search(r"-id(\d+)$", ak_slug)
    if m:
        return m.group(1), None
    if ak_slug.startswith("google-play-"):
        return None, ak_slug.removeprefix("google-play-")
    return None, None


# --- 2.1 search -----------------------------------------------------------------------------------

def read_search(path: Path, match: AppMatcher) -> list[dict]:
    df = _read(path)
    query = re.search(r"AK_пошук_([^_]+)_", path.name)
    out = []
    for _, r in df.iterrows():
        ios, pkg = ak_store_ids(r["slug"])
        out.append({
            "source": SOURCE, "as_of": str(r.get("Дані станом на") or "")[:10] or file_date(path),
            "query": query.group(1) if query else None, "region": "world", "period_days": 30,
            "slug": match.resolve(name=r["Застосунок"], ios_id=ios, package=pkg),
            "app_name": r["Застосунок"], "store": STORE.get(r["Стор"], r["Стор"]), "ak_slug": r["slug"],
            "category": clean(r["Категорія"]), "rating": num(r["Рейтинг"]), "rating_count": num(r["Відгуки"]),
            "downloads": num(r["Завантажень/міс"]), "revenue": num(r["Дохід/міс"]),
            "meta_spend_30d": num(r["Meta, $ за 30 дн."]),
            "release_date": clean(r["Реліз"]), "updated": clean(r["Оновлення"]),
        })
    return out


def dedupe_search(rows: list[dict]) -> list[dict]:
    """The comics and manga searches overlap (WEBTOON, Shonen Jump, …): one row per AppKittie app, queries merged."""
    by: dict[str, dict] = {}
    for r in sorted(rows, key=lambda r: r["as_of"]):
        prev = by.get(r["ak_slug"])
        queries = sorted({*(prev["queries"] if prev else []), r["query"]} - {None})
        by[r["ak_slug"]] = {**{k: v for k, v in r.items() if k != "query"}, "queries": queries}
    return list(by.values())


# --- 2.2 app cards (.docx) ------------------------------------------------------------------------

def uk_amount(text: str | None) -> float | None:
    """'$219.6 тис.' -> 219600, '$2 млн' -> 2e6, '76.6 тис.' -> 76600, '+431.6%' -> 4.316."""
    if not text:
        return None
    s = text.replace("−", "-").replace(",", ".")
    m = re.search(r"(-?)\+?\$?\s*(\d+(?:\.\d+)?)\s*(тис|млн|млрд|%)?", s)
    if not m:
        return None
    v = float(m.group(2)) * {"тис": 1e3, "млн": 1e6, "млрд": 1e9, "%": 0.01, None: 1}[m.group(3)]
    return -v if m.group(1) else v


IAP_RE = re.compile(r"^(?P<name>.+?),\s*(?P<period>разово|тиждень|місяць|рік)\s*(?P<price>\$.*)$")


def parse_iap(line: str) -> dict | None:
    """'SVIP(weekly), тиждень$14.99–$29.99 (3 ціни)' -> name, period, price_min/max, n_prices."""
    m = IAP_RE.match(line.strip())
    if not m:
        return None
    prices = [float(p) for p in re.findall(r"\$(\d+(?:\.\d+)?)", m.group("price"))]
    n = re.search(r"\((\d+) ціни?\)", m.group("price"))
    return {"name": m.group("name").strip(), "period": PERIOD[m.group("period")],
            "price_min": min(prices) if prices else None, "price_max": max(prices) if prices else None,
            "n_prices": int(n.group(1)) if n else 1, "raw": line.strip()}


CARD_FIELDS = {
    "Стор": "store", "Дохід, оцінка за місяць": "revenue", "Завантажень, оцінка за місяць": "downloads",
    "Рейтинг": "rating", "Категорія": "category", "Реліз": "release_date", "Оновлення": "updated",
    "Ріст доходу за 30 днів": "revenue_growth_30d", "Ріст завантажень за 30 днів": "downloads_growth_30d",
}


def _ddmmyyyy(s: str | None) -> str | None:
    m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", (s or "").strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else s


def read_card(path: Path, match: AppMatcher) -> dict:
    blocks, _ = docx_blocks(path)
    texts = [b.text for b in blocks if b.text]
    name_hint = re.match(r"AK_картка_(.+?)_(iOS|GooglePlay)_", path.name)
    card: dict = {"source": SOURCE, "as_of": file_date(path), "region": "world", "period_days": 30,
                  "file": path.name, "iap": [], "trend_notes": [], "description": None}
    i, section = 0, None
    while i < len(texts):
        t = texts[i]
        if t in CARD_FIELDS and i + 1 < len(texts):
            card[CARD_FIELDS[t]] = texts[i + 1]
            i += 2
            continue
        if t.startswith("Вбудовані покупки"):
            section = "iap"
        elif t.startswith("Опис зі стору"):
            section = "desc"
        elif t.startswith("Динаміка за"):
            section = "trend"
        elif section == "iap" and (iap := parse_iap(t)):
            card["iap"].append(iap)
        elif section == "desc" and card["description"] is None:
            card["description"] = t
        elif section == "trend" and re.match(r"^(Дохід|Завантаження):", t):
            card["trend_notes"].append(t)
        i += 1
    # first non-URL line is the app name
    card["app_name"] = next((t for t in texts if not t.startswith("http") and t not in ("Сторінка в сторі",)), None)
    card["store"] = STORE.get(card.get("store", ""), STORE.get(name_hint.group(2)) if name_hint else None)
    rating = re.match(r"([\d.]+)\s*\(([\d.]+)\s*(тис\.|млн)?", card.get("rating") or "")
    card["rating"], card["rating_count"] = (float(rating.group(1)), uk_amount(f"{rating.group(2)} {rating.group(3) or ''}")) if rating else (None, None)
    for k in ("revenue", "downloads", "revenue_growth_30d", "downloads_growth_30d"):
        card[k] = uk_amount(card.get(k))
    card["release_date"], card["updated"] = _ddmmyyyy(card.get("release_date")), _ddmmyyyy(card.get("updated"))
    card["slug"] = match.resolve(name=card["app_name"] or "") or (name_hint and match.resolve(name=name_hint.group(1)))
    return card


# --- 2.3 ads --------------------------------------------------------------------------------------

def read_ads(path: Path, match: AppMatcher) -> list[dict]:
    df = _read(path)
    as_of = _as_of(df, path)
    out = []
    for _, r in df.iterrows():
        out.append({
            "source": SOURCE, "as_of": str(r.get("Дані станом на") or "")[:10] or as_of,
            "slug": match.resolve(name=r["Застосунок"]), "app_name": r["Застосунок"],
            "page": clean(r["Сторінка, що розмістила"]), "network": clean(r["Мережа"]), "format": clean(r["Формат"]),
            "headline": clean(r["Заголовок"]), "text": clean(r["Текст"]), "cta": clean(r["CTA"]),
            "start": clean(r["Старт"]), "days_live": num(r["Днів у показі"]),
            "active": str(r["Активне"]).strip().lower() in ("так", "yes", "true"),
            "spend_30d": num(r["Оцінка витрат за 30 днів, $"]), "countries": clean(r["Країни"]),
            "landing_url": clean(r["Куди веде"]), "media_url": clean(r["Медіа"]),
        })
    return out


# --- 2.4 keywords, 2.5 creators -------------------------------------------------------------------

def read_keywords(path: Path, match: AppMatcher) -> list[dict]:
    df = _read(path)
    store_region = re.search(r"_(AppStore|GooglePlay)-([^_]+)_", path.name)
    return [{
        "source": SOURCE, "as_of": str(r.get("Дані станом на") or "")[:10] or file_date(path),
        "store": "App Store" if not store_region or store_region.group(1) == "AppStore" else "Google Play",
        "region": {"США": "US"}.get(store_region.group(2), store_region.group(2)) if store_region else None,
        "keyword": r["Ключове слово"], "popularity": num(r["Популярність 0–100"]),
        "difficulty": num(r["Складність 0–100"]), "opportunity": num(r["Можливість 0–100"]),
        "apps_in_results": num(r["Застосунків у видачі"]),
    } for _, r in df.iterrows()]


def read_creators(path: Path, match: AppMatcher) -> list[dict]:
    df = _read(path)
    return [{
        "source": SOURCE, "as_of": str(r.get("Дані станом на") or "")[:10] or file_date(path),
        "slug": match.resolve(name=r["Застосунок"]), "creator": str(r["Креатор"]).lstrip("'"),
        "platform": clean(r["Платформа"]), "subscribers": num(r["Підписників"]), "country": clean(r["Країна"]),
    } for _, r in df.iterrows()]


# --- 2.6 paywalls (.docx screenshots) -------------------------------------------------------------

def read_paywalls(path: Path, match: AppMatcher) -> list[dict]:
    """[{app_name, slug, images: [(zip member, bytes)]}] — one entry per app section in the document."""
    blocks, z = docx_blocks(path)
    out: list[dict] = []
    for b in blocks:
        m = re.match(r"^(.+?)\s*,\s*екранів:\s*(\d+)$", b.text)
        if m:
            out.append({"source": SOURCE, "as_of": file_date(path), "app_name": m.group(1).strip(),
                        "slug": match.resolve(name=m.group(1).strip()), "images": []})
        elif out:
            out[-1]["images"] += [(n, z.read(f"word/media/{n}")) for n in b.images]
    return out
