import json
import math
from pathlib import Path

import pandas as pd
import pytest
from openpyxl import Workbook

from comics_pipeline import audit, intel
from comics_pipeline.audit import md5
from comics_pipeline.paths import Paths
from comics_pipeline.sources import appkittie, free_services, gp_reviews
from comics_pipeline.sources.common import AppMatcher, json_safe, num
from comics_pipeline.st_io import is_st_export

from .test_audit import st_row, write_st

APPS = [
    {"slug": "shonen-jump", "display_name": "Shonen Jump", "unified_name": "Shonen Jump Manga & Comics",
     "ios_ids": ["594237344"], "android_packages": ["com.viz.wsj.android"], "website": "https://www.viz.com"},
    {"slug": "tapas", "display_name": "Tapas – Comics and Novels", "unified_name": None,
     "ios_ids": ["578836126"], "android_packages": ["com.tapastic"], "website": "https://tapas.io"},
    {"slug": "manta", "display_name": "Manta – Manga, Manhwa, Novels", "unified_name": None,
     "ios_ids": [], "android_packages": ["net.manta.comic"], "website": None},
]

REVIEW_HEADER = "app,package,n,date,stars,helpful_votes,review_text,developer_reply,collected_on,source"
SEARCH_HEADER = "Застосунок,Стор,Категорія,Рейтинг,Відгуки,Завантажень/міс,Дохід/міс,\"Meta, $ за 30 дн.\",Реліз,Оновлення,slug,Дані станом на"


def write_catalog(repo: Paths, aliases: dict | None = None) -> None:
    repo.apps_catalog_json.write_text(json.dumps({"apps": APPS}), encoding="utf-8")
    (repo.catalog / "aliases.json").write_text(json.dumps(aliases or {"ShonenJump": "shonen-jump"}), encoding="utf-8")


@pytest.fixture
def matcher(repo: Paths) -> AppMatcher:
    write_catalog(repo)
    return AppMatcher.load(repo)


# --- Sensor Tower vs other files ------------------------------------------------------------------

def test_non_sensor_tower_files_are_kept_out_of_the_st_pipeline(repo: Paths):
    g = repo.raw_sources["genesis"]
    write_st(g / "st.csv", [st_row("2026-01-01")])
    (g / "AK_пошук_comics_світ_14.10.csv").write_text(SEARCH_HEADER + "\n", encoding="utf-8")
    (g / "GP_відгуки_X_14.10.csv").write_text(REVIEW_HEADER + "\n", encoding="utf-8")
    assert is_st_export(g / "st.csv") and not is_st_export(g / "GP_відгуки_X_14.10.csv")
    assert [p.name for _, p in audit.raw_files(repo)] == ["st.csv"]
    assert {p.name for p in audit.other_raw_files(repo)} == {"AK_пошук_comics_світ_14.10.csv", "GP_відгуки_X_14.10.csv"}
    report = audit.run(repo)  # must not choke on the non-ST files
    assert report["error"].isna().all()


# --- parsing helpers ------------------------------------------------------------------------------

@pytest.mark.parametrize("raw, expected", [
    ("$1,348.5M", 1348.5e6), ("−$152.9M", -152.9e6), ("25.0%", 0.25), ("100%", 1.0), ("2 884 000", 2884000),
    ("#1 863", 1863), ("≥ $500 000", 500000), ("10M+", 10e6), (0.2504, 0.2504), (float("nan"), None), ("—", None),
])
def test_num(raw, expected):
    assert num(raw) == (pytest.approx(expected) if expected is not None else None)


def test_iap_lines_and_amounts():
    assert appkittie.parse_iap("SVIP(weekly), тиждень$14.99–$29.99 (3 ціни)") == {
        "name": "SVIP(weekly)", "period": "week", "price_min": 14.99, "price_max": 29.99, "n_prices": 3,
        "raw": "SVIP(weekly), тиждень$14.99–$29.99 (3 ціни)"}
    assert appkittie.parse_iap("In-App Purchases, разово$1.99 - $99.99 per item")["price_max"] == 99.99
    assert appkittie.parse_iap("Однакові назви зведено: ціни різняться") is None
    assert appkittie.uk_amount("$219.6 тис.") == pytest.approx(219600)
    assert appkittie.uk_amount("$2 млн") == 2e6
    assert appkittie.uk_amount("−33.9%") == pytest.approx(-0.339)
    assert appkittie.ak_store_ids("app-shonen-jump-manga-comics-id594237344") == ("594237344", None)
    assert appkittie.ak_store_ids("google-play-comvizwsjandroid") == (None, "comvizwsjandroid")


def test_matcher_ids_packages_aliases_domains(matcher: AppMatcher):
    assert matcher.resolve(ios_id="594237344") == "shonen-jump"
    assert matcher.resolve(package="comvizwsjandroid") == "shonen-jump"  # AppKittie strips the dots
    assert matcher.resolve(name="ShonenJump") == "shonen-jump"  # alias
    assert matcher.resolve(name="tapas.io") == "tapas"  # catalog website domain
    assert matcher.resolve(name="Manta - Manga, Manhwa, Novels") == "manta"  # fuzzy name
    assert matcher.resolve(name="Robbery Bob 2") is None and "Robbery Bob 2" in matcher.unmatched


def test_json_safe_removes_nan():
    assert json.dumps(json_safe({"a": [float("nan"), 1.0], "b": math.inf})) == '{"a": [null, 1.0], "b": null}'


# --- reviews ---------------------------------------------------------------------------------------

def test_reviews_dedupe_keeps_identical_texts_from_different_users(repo: Paths, matcher: AppMatcher):
    f = repo.raw_sources["genesis"] / "GP_відгуки_Manta_14.10.csv"
    rows = ['Manta,net.manta.comic,1,2026-10-12,5,0,nice app,,2026-10-14,GP US',
            'Manta,net.manta.comic,2,2026-10-12,5,0,nice app,,2026-10-14,GP US',
            'Manta,net.manta.comic,3,2026-10-11,1,3,too expensive and the gems are a scam,"Dev, reply",2026-10-14,GP US']
    f.write_text("\n".join([REVIEW_HEADER, *rows, rows[2]]) + "\n", encoding="utf-8")
    df, dropped = gp_reviews.dedupe(gp_reviews.read(f, matcher))
    assert dropped == 1 and len(df) == 3 and set(df["slug"]) == {"manta"}
    r = gp_reviews.app_reviews(df)
    assert r["n"] == 3 and r["stars"]["5"] == 2 and r["reply_rate"] == pytest.approx(1 / 3, abs=1e-4)
    assert r["period"] == {"from": "2026-10-11", "to": "2026-10-12"}
    assert next(t for t in r["topics"] if t["key"] == "price")["n"] == 1


def test_topics():
    assert "shutdown" in gp_reviews.topics("Why are you shutting down??")
    assert gp_reviews.topics("Too many ads, crashes on load") == ["ads", "bugs"]


# --- workbook layout --------------------------------------------------------------------------------

def test_table_located_by_header_not_position_and_layout_errors_are_loud():
    wb = Workbook()
    ws = wb.active
    ws.title = "Similarweb трафік"
    ws.append(["Similarweb трафік"])
    ws.append(["note"])
    ws.append([])
    ws.append(["Домен", "Візити / міс"])
    ws.append(["tapas.io", 2884000])
    ws.append([])
    ws.append(["footnote that is not data"])
    assert free_services.table(ws, "Домен") == [{"Домен": "tapas.io", "Візити / міс": 2884000}]
    with pytest.raises(free_services.LayoutError):
        free_services.table(ws, "Бренд")


# --- end to end -----------------------------------------------------------------------------------

def test_intel_run_end_to_end(repo: Paths):
    write_catalog(repo)
    g = repo.raw_sources["genesis"]
    write_st(g / "st.csv", [st_row("2026-01-01")])
    (g / "AK_пошук_manga_світ_14.10.csv").write_text("\n".join([
        SEARCH_HEADER,
        "Shonen Jump Manga & Comics,App Store,Book,4.9,260952,40070,2003447.15,10111.09,2013-03-21,2026-09-08,app-shonen-jump-manga-comics-id594237344,2026-10-14 09:29",
        "Shonen Jump Manga & Comics,Google Play,Comics,4.8,5616,100000,410688.40,,2013-08-21,2026-09-08,google-play-comvizwsjandroid,2026-10-14 09:29",
    ]) + "\n", encoding="utf-8")
    reviews = g / "GP_відгуки_Tapas_14.10.csv"
    reviews.write_text(REVIEW_HEADER + "\nTapas,com.tapastic,1,2026-10-13,1,0,they are shutting down,,2026-10-14,GP US\n", encoding="utf-8")
    union = g / "GP_відгуки_усі_14.10.csv"
    union.write_text(reviews.read_text(encoding="utf-8").replace("2026-10-13", "2026-10-12"), encoding="utf-8")
    cfg = {"appkittie": {"revenue_basis": "net"}, "exclude_files": [{"md5": md5(union), "reason": "union"}]}
    repo.source_config.write_text(json.dumps(cfg), encoding="utf-8")

    report = intel.run(repo)
    assert [e["file"].split("/")[-1] for e in report["excluded"]] == [union.name]
    sj = json.loads((repo.web_data / "intel" / "shonen-jump.json").read_text(encoding="utf-8"))
    assert {(e["store"], e["revenue_basis"], e["bound"]) for e in sj["estimates"]} == {("ios", "net", "point"), ("android", "net", "point")}
    assert sj["estimates"][1]["meta_spend_30d"] is None  # empty cell -> null, not NaN
    tapas = json.loads((repo.web_data / "intel" / "tapas.json").read_text(encoding="utf-8"))
    assert tapas["reviews"]["n"] == 1  # the excluded union file is not counted
    index = json.loads((repo.web_data / "intel_index.json").read_text(encoding="utf-8"))
    assert index["apps"]["tapas"] == ["reviews"]
    assert (repo.processed / "intel.json").exists()
    # the Sensor Tower path never sees these files
    assert [p.name for _, p in audit.raw_files(repo)] == ["st.csv"]
