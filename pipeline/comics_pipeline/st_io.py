"""Reading Sensor Tower exports: UTF-16 LE + TAB (usual), UTF-8 + comma (fallback), or .xlsx."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ST_COLUMNS = [
    "Unified Name", "Unified ID", "Publisher Name", "Publisher ID", "Developer Name", "Developer ID",
    "App Name", "App ID", "Date", "Country / Region", "Platform", "Device", "Downloads", "Revenue ($)", "RPD ($)",
]
OPTIONAL_COLUMNS = ["ARPDAU ($)"]
RAW_SUFFIXES = {".csv", ".tsv", ".txt", ".xlsx"}
ID_COLUMNS = ["Unified ID", "Publisher ID", "Developer ID", "App ID"]


def _id_to_str(v) -> str:
    """Excel turns numeric IDs into floats (6445905219.0); store them as plain digit strings."""
    if pd.isna(v):
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def read_st(path: Path) -> tuple[pd.DataFrame, str]:
    """Return (frame, format_label). Raises ValueError if no reader yields the expected columns."""
    attempts: list[tuple[str, dict]] = []
    if path.suffix.lower() == ".xlsx":
        attempts.append(("xlsx", {}))
    else:
        attempts += [("utf-16/tab", {"encoding": "utf-16", "sep": "\t"}),
                     ("utf-8/comma", {"encoding": "utf-8-sig", "sep": ","}),
                     ("utf-8/tab", {"encoding": "utf-8-sig", "sep": "\t"})]
    errors = []
    for label, kw in attempts:
        try:
            if label == "xlsx":
                df = pd.read_excel(path, dtype={c: object for c in ID_COLUMNS})
            else:
                df = pd.read_csv(path, dtype={c: str for c in ID_COLUMNS}, **kw)
        except Exception as e:  # noqa: BLE001 — try the next format
            errors.append(f"{label}: {e}")
            continue
        df.columns = [str(c).strip() for c in df.columns]
        missing = [c for c in ST_COLUMNS if c not in df.columns]
        if missing:
            errors.append(f"{label}: missing columns {missing}")
            continue
        for c in ID_COLUMNS:
            df[c] = df[c].map(_id_to_str)
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        for c in ["Downloads", "Revenue ($)", "RPD ($)", *[c for c in OPTIONAL_COLUMNS if c in df.columns]]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        return df, label
    raise ValueError("; ".join(errors))


def _gap_label(a: pd.Timestamp, b: pd.Timestamp) -> str:
    days = (b - a).days
    if days == 1:
        return "daily"
    if a.day == 1 and b.day == 1:
        return "monthly"
    if a.dayofweek == 0 and b.dayofweek == 0 and days % 7 == 0 and days <= 21:
        return "weekly"
    return "irregular"


def granularity_runs(dates: pd.Series) -> list[tuple[str, pd.Timestamp, pd.Timestamp]]:
    """Split a date series into runs of one granularity: [(label, first_date, last_date), ...].

    Handles files that switch granularity, e.g. WEBTOON: monthly 2015-01..2025-12, then weekly
    from Monday 2025-12-29. A date belongs to the run of the gap that follows it (last date: preceding gap).
    """
    d = sorted(pd.to_datetime(dates.dropna().unique()))
    if len(d) < 2:
        if not d:
            return []
        return [("monthly?" if d[0].day == 1 else "single_date", d[0], d[0])]
    labels = [_gap_label(a, b) for a, b in zip(d, d[1:])]
    # an odd gap (missing day, or a switch-over like 2025-12-01 -> 2025-12-29) keeps the previous label
    for i, lbl in enumerate(labels):
        if lbl == "irregular":
            prev = labels[i - 1] if i else next((x for x in labels if x != "irregular"), "irregular")
            labels[i] = prev
    labels.append(labels[-1])
    runs: list[list] = []
    for date, label in zip(d, labels):
        if runs and runs[-1][0] == label:
            runs[-1][2] = date
        else:
            runs.append([label, date, date])
    return [tuple(r) for r in runs]


def detect_granularity(dates: pd.Series) -> str:
    """daily | weekly (Monday-start) | monthly (day 01), joined with '+' when a series switches."""
    runs = granularity_runs(dates)
    if not runs:
        return "empty"
    labels = list(dict.fromkeys(r[0] for r in runs))
    return "+".join(labels)
