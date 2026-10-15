"""Regions for the dashboard's World / US / Tier-1 switch, defined in data/catalog/regions.json."""
from __future__ import annotations

import json

import pandas as pd

from .paths import Paths


DEFAULT = {
    "world": {"label": "World (sum of all countries in the export)", "countries": None},
    "us": {"label": "United States", "countries": ["US"]},
}


def load_regions(paths: Paths) -> dict[str, dict]:
    """{"world": {"label", "countries": None}, "us": {...}, "tier1": {...}} — order as in the file."""
    f = paths.catalog / "regions.json"
    if not f.exists():
        return DEFAULT
    raw = json.loads(f.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def in_region(df: pd.DataFrame, countries: list[str] | None) -> pd.DataFrame:
    return df if countries is None else df[df["country"].isin(countries)]
