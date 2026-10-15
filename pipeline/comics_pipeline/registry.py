"""`make registry`: merge the Google Sheet exports (longlist + shortlist) into data/catalog/registry.csv.

Sheet exports have 2 title rows above the header and occasional shifted rows, so store links are
found by regex across the whole row rather than by column position.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

import pandas as pd

from .paths import Paths

# match on the tab-name suffix: both file names contain "лонгліст + шорт-лист", and Windows globs ignore case
LONGLIST_GLOB = "*) - Лонгліст.csv"
SHORTLIST_GLOB = "*) - Шорт-лист*.csv"

IOS_RE = re.compile(r"apps\.apple\.com/\S*?id(\d{6,})")
GP_RE = re.compile(r"play\.google\.com/store/apps/details\?id=([A-Za-z0-9_.]+)")
MISSING = {"", "—", "-", "перевірити"}

SEGMENTS = [  # first match wins; checked against the lower-cased «Сегмент» text
    ("піратськ", "piracy"),
    ("ai comic drama", "ai_comic_drama"),
    ("short drama", "short_drama"),
    ("вебновел", "webnovel"),
    ("проза", "webnovel"),
    ("західні комікси", "western_comics"),
    ("комікси, манга", "western_comics"),
    ("комікси + creator", "western_comics"),
    ("манга", "manga"),
    ("вебтун", "webtoon_platform"),
    ("манхва", "webtoon_platform"),
]
STATUSES = [("закрито", "closed"), ("закривається", "closing"), ("зливається", "closing"),
            ("спад", "declining"), ("новачок", "newcomer")]

COLUMNS = [
    "slug", "app_name", "shortlist", "segment", "status", "status_note", "company", "store_developer",
    "parent", "markets", "platforms", "monetization", "ios_id", "android_package", "app_store_url",
    "google_play_url", "website", "list_revenue_world_musd_yr", "list_revenue_us_musd_yr",
    "source_company", "source_numbers", "shortlist_reason", "notes",
]


def read_sheet_export(path: Path) -> list[dict]:
    """Rows as dicts keyed by the header (row starting with '№'); extra cells kept under '_extra'."""
    rows = list(csv.reader(path.open(encoding="utf-8-sig")))
    h = next(i for i, r in enumerate(rows) if r and r[0].strip() == "№")
    header = [c.strip() for c in rows[h]]
    width = max(i for i, c in enumerate(header) if c) + 1
    out = []
    for r in rows[h + 1:]:
        if not any(c.strip() for c in r):
            continue
        d = {header[i]: r[i].strip() for i in range(min(width, len(r)))}
        d["_extra"] = [c.strip() for c in r[width:] if c.strip()]
        d["_row"] = r
        out.append(d)
    return out


def slugify(name: str) -> str:
    base = re.split(r"[:–(]| - ", name)[0]
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-") or "app"


def clean(v: str | None) -> str:
    v = (v or "").strip()
    return "" if v.lower() in MISSING else v


def first_match(text: str, table: list[tuple[str, str]], default: str = "") -> str:
    t = text.lower()
    return next((code for needle, code in table if needle in t), default)


def links(row: list[str]) -> tuple[str, str]:
    text = " ".join(row)
    ios = IOS_RE.search(text)
    gp = GP_RE.search(text)
    return (ios.group(1) if ios else ""), (gp.group(1) if gp else "")


def build(paths: Paths) -> pd.DataFrame:
    long_path = next(paths.catalog.glob(LONGLIST_GLOB))
    short_path = next(paths.catalog.glob(SHORTLIST_GLOB))
    long_rows, short_rows = read_sheet_export(long_path), read_sheet_export(short_path)
    short_by_name = {r["Застосунок"]: r for r in short_rows}

    apps = []
    for r in long_rows:
        name = r["Застосунок"]
        s = short_by_name.pop(name, None)
        ios, gp = links(r["_row"])
        if s:
            s_ios, s_gp = links(s["_row"])
            ios, gp = ios or s_ios, gp or s_gp
        status_text = r.get("Статус (10.2026)", "")
        note = ""
        if r["_extra"]:
            note = "Sheet row is shifted: extra cells after «Сайт» column; links recovered by regex."
        apps.append({
            "slug": slugify(name),
            "app_name": name,
            "shortlist": bool(s) and s.get("№", "").isdigit(),
            "segment": first_match(r.get("Сегмент", ""), SEGMENTS),
            # classify on the text before ";" — e.g. Kindle is "Активний; застосунок ComiXology закрито"
            "status": first_match(status_text.split(";")[0], STATUSES, "active"),
            "status_note": clean(status_text),
            "company": clean(r.get("Компанія-оператор (юр. особа / розробник у сторі)")),
            "store_developer": clean(s.get("Розробник у сторах")) if s else "",
            "parent": clean(r.get("Материнська група")),
            "markets": clean(r.get("Ключові ринки")),
            "platforms": clean(r.get("Платформи")),
            "monetization": clean(r.get("Модель монетизації")),
            "ios_id": ios,
            "android_package": gp,
            "app_store_url": f"https://apps.apple.com/app/id{ios}" if ios else "",
            "google_play_url": f"https://play.google.com/store/apps/details?id={gp}" if gp else "",
            "website": next((c for c in [*r["_extra"], r.get("Сайт", "")] if c.startswith("http") and "apple.com" not in c and "google.com" not in c), ""),
            "list_revenue_world_musd_yr": clean(r.get("Виручка застосунку, світ, $M/рік")),
            "list_revenue_us_musd_yr": clean(r.get("США, $M/рік (ST run-rate)")),
            "source_company": clean(r.get("Джерело: компанія / статус")),
            "source_numbers": clean(r.get("Джерело: цифри")),
            "shortlist_reason": clean(s.get("Чому в шорт-листі")) if s else "",
            "notes": note,
        })
    if short_by_name:
        raise ValueError(f"shortlist apps not found in longlist: {list(short_by_name)}")

    df = pd.DataFrame(apps, columns=COLUMNS)
    dup = df["slug"][df["slug"].duplicated()].tolist()
    if dup:
        raise ValueError(f"duplicate slugs: {dup}")
    return df


def run(paths: Paths) -> pd.DataFrame:
    df = build(paths)
    df.to_csv(paths.registry_csv, index=False, encoding="utf-8")
    print(f"registry.csv: {len(df)} apps ({int(df['shortlist'].sum())} on the shortlist)")
    print(f"  with App Store ID: {(df['ios_id'] != '').sum()}, with Google Play package: {(df['android_package'] != '').sum()}")
    no_ids = df[(df["ios_id"] == "") & (df["android_package"] == "") & (df["status"] != "closed") & (df["segment"] != "piracy")]
    if len(no_ids):
        print(f"  active apps with no store ID ({len(no_ids)}): {', '.join(no_ids['app_name'])}")
    return df
