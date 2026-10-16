"""Google Play reviews (data/raw/genesis/03_Відгуки Google Play): newest-first samples per app.

Each file is a *sample* (the newest N reviews at collection time), so its date window differs per app
(WEBTOON: 8 days, Manta: ~11 months). Stats are therefore always shown with their window and
are not comparable to the store's overall rating. Topics are keyword tags (English reviews),
deliberately simple and transparent — not sentiment analysis.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from .common import AppMatcher, clean

SOURCE = "Google Play"
# `n` is the row number within an export: two users posting "nice app" on the same day are two reviews.
ROW_KEY = ["package", "n", "date", "stars", "review_text"]

# (key, Ukrainian label, regex over the lower-cased review text). A review can carry several topics.
TOPICS: list[tuple[str, str, str]] = [
    ("price", "Ціни, валюта (coins / gems / ink)", r"expens|pric|cost|\bcoins?\b|\bgems?\b|\bink\b|\bpoints?\b|money|pay(?!ing attention)|paid|\$\d|too much|cheap|refund"),
    ("subscription", "Підписка / Premium", r"subscri|premium|membership|\bvip\b|\bplan\b"),
    ("ads", "Реклама в застосунку", r"\bads?\b|advert|commercial"),
    ("free_wait", "Безкоштовне / очікування", r"\bfree\b|wait|daily pass|ticket|unlock"),
    ("content_missing", "Зникли / немає тайтлів", r"remov|missing|not there|taken down|disappear|can'?t find|no longer|isn'?t there|\bno [a-z]+ (?:story|series|comic)|where is|gone"),
    ("shutdown", "Закриття сервісу", r"shut ?down|shutting|closing|close down|discontinu|end of service|going away|leav(?:e|ing)|killed off|zombie"),
    ("bugs", "Баги, завантаження, вхід", r"\bbugs?\b|crash|glitch|won'?t load|not loading|loading|error|freez|\blag|log ?in|sign ?in|black screen|update"),
    ("translation", "Переклад / якість", r"translat|grammar|typo|censor"),
]
_TOPIC_RE = [(k, re.compile(rx)) for k, _, rx in TOPICS]
TOPIC_LABEL = {k: label for k, label, _ in TOPICS}


def topics(text: str | None) -> list[str]:
    t = (text or "").lower()
    return [k for k, rx in _TOPIC_RE if rx.search(t)]


def read(path: Path, match: AppMatcher) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"package": str, "review_text": str, "developer_reply": str})
    df["slug"] = [match.resolve(name=a, package=p) for a, p in zip(df["app"], df["package"])]
    df["file"] = path.name
    return df


def dedupe(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    out = df.drop_duplicates(subset=ROW_KEY)
    return out, len(df) - len(out)


def app_reviews(g: pd.DataFrame) -> dict:
    """Stats + items for one app. `g`: deduped review rows of that app."""
    g = g.sort_values(["date", "n"], ascending=[False, True]).copy()
    g["topics"] = g["review_text"].map(topics)
    g["month"] = g["date"].str[:7]
    dist = {str(s): int((g["stars"] == s).sum()) for s in range(1, 6)}
    monthly = [{"month": m, "n": int(len(x)), "avg_stars": round(float(x["stars"].mean()), 2)}
               for m, x in g.groupby("month")]
    topic_rows = []
    for k, label, _ in TOPICS:
        hit = g[g["topics"].map(lambda ts: k in ts)]
        if len(hit):
            topic_rows.append({"key": k, "label": label, "n": int(len(hit)), "share": round(len(hit) / len(g), 4),
                               "avg_stars": round(float(hit["stars"].mean()), 2)})
    sources = sorted(g["source"].dropna().unique())
    return {
        "source": SOURCE,
        "collection": sources[0] if len(sources) == 1 else "; ".join(sources),
        "collected_on": str(g["collected_on"].max()),
        "store": "android", "country": "US", "language": "en",
        "period": {"from": str(g["date"].min()), "to": str(g["date"].max())},
        "n": int(len(g)),
        "avg_stars": round(float(g["stars"].mean()), 2),
        "stars": dist,
        "reply_rate": round(float(g["developer_reply"].notna().mean()), 4),
        "monthly": monthly,
        "topics": sorted(topic_rows, key=lambda t: -t["n"]),
        "items": [{
            "date": r["date"], "stars": int(r["stars"]), "helpful": int(r["helpful_votes"] or 0),
            "text": clean(r["review_text"]), "reply": clean(r["developer_reply"]), "topics": r["topics"],
        } for _, r in g.iterrows()],
    }
