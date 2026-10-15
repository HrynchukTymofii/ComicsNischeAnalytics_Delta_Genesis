"""`make audit` (Prompt 1): inspect every raw export in data/raw/sensortower and data/raw/genesis.

Read-only. Writes data/audit_report.csv (one row per file) and data/audit_report.md
(summary, duplicates, overlaps and a *proposed* move/rename plan). Nothing is moved or renamed
unless `--move-duplicates --confirmed` is passed after the user has approved the plan.
"""
from __future__ import annotations

import hashlib
import re
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .paths import Paths
from .st_io import RAW_SUFFIXES, detect_granularity, granularity_runs, read_st


def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def raw_files(paths: Paths) -> list[tuple[str, Path]]:
    out = []
    for source, folder in paths.raw_sources.items():
        if folder.exists():
            out += [(source, p) for p in sorted(folder.rglob("*")) if p.is_file() and p.suffix.lower() in RAW_SUFFIXES]
    return out


def find_duplicate_groups(files: list[tuple[str, Path]]) -> list[list[Path]]:
    """Byte-identical files grouped by MD5. The shortest (then alphabetically first) name is kept."""
    by_hash: dict[str, list[Path]] = defaultdict(list)
    for _, p in files:
        by_hash[md5(p)].append(p)
    return [sorted(g, key=lambda p: (len(p.name), p.name)) for g in by_hash.values() if len(g) > 1]


def slug(*candidates: str) -> str:
    """First candidate that yields a Latin slug (Unified Name may be Japanese, e.g. マンガＵＰ！)."""
    for text in candidates:
        s = re.sub(r"[^A-Za-z0-9]+", "-", re.split(r"[:–]| - ", str(text))[0]).strip("-")
        if s:
            return s
    return "app"


def region_label(countries: list[str]) -> str:
    return countries[0] if len(countries) == 1 else f"WW{len(countries)}"


def file_metric_hint(name: str) -> str:
    n = name.lower()
    return "revenue" if "revenue" in n else "downloads" if "download" in n else ""


def audit_file(source: str, p: Path, root: Path) -> tuple[dict, pd.DataFrame]:
    """One report row per file, plus per-app series ranges used for overlap detection."""
    rel = p.relative_to(root).as_posix()
    row: dict = {"path": rel, "source": source, "file": p.name, "bytes": p.stat().st_size, "md5": md5(p),
                 "named_as": file_metric_hint(p.name)}
    try:
        df, fmt = read_st(p)
    except ValueError as e:
        row["error"] = str(e)[:500]
        return row, pd.DataFrame()

    countries = sorted(df["Country / Region"].dropna().astype(str).unique())
    per_app = []
    for (uid, uname), g in df.groupby(["Unified ID", "Unified Name"], dropna=False):
        per_app.append({
            "path": rel, "unified_id": uid, "unified_name": uname,
            "slug": slug(uname, *g["App Name"].dropna().unique()),
            "granularity": detect_granularity(g["Date"]),
            "start": g["Date"].min(), "end": g["Date"].max(),
            "countries": g["Country / Region"].nunique(),
            "revenue": g["Revenue ($)"].sum(), "downloads": g["Downloads"].sum(),
        })
    apps = pd.DataFrame(per_app)
    grans = sorted(apps["granularity"].unique())
    row.update({
        "format": fmt,
        "rows": len(df),
        "unified_apps": len(apps),
        "unified_names": " | ".join(apps["unified_name"].astype(str)),
        "app_slugs": " ".join(apps["slug"]),
        "granularity_runs": "; ".join(
            f"{lbl} {a:%Y-%m-%d}..{b:%Y-%m-%d}" for lbl, a, b in granularity_runs(df["Date"])
        ),
        "zero_revenue": bool(df["Revenue ($)"].fillna(0).eq(0).all()),
        "app_ids": " ".join(sorted(df["App ID"].unique())),
        "platforms": " ".join(sorted(df["Platform"].dropna().astype(str).unique())),
        "devices": " ".join(sorted(df["Device"].dropna().astype(str).unique())),
        "date_min": df["Date"].min().date().isoformat() if df["Date"].notna().any() else "",
        "date_max": df["Date"].max().date().isoformat() if df["Date"].notna().any() else "",
        "granularity": "+".join(grans),
        "countries": len(countries),
        "region": region_label(countries),
        "downloads_total": float(df["Downloads"].sum()),
        "revenue_total_usd": round(float(df["Revenue ($)"].sum()), 2),
        "has_arpdau": "ARPDAU ($)" in df.columns,
        "bad_dates": int(df["Date"].isna().sum()),
    })
    return row, apps


def find_overlaps(apps: pd.DataFrame, duplicate_paths: set[str]) -> pd.DataFrame:
    """Pairs of (non-duplicate) files covering the same unified app with intersecting or adjacent dates."""
    a = apps[~apps["path"].isin(duplicate_paths)]
    out = []
    for uid, g in a.groupby("unified_id"):
        g = g.sort_values("start").to_dict("records")
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                x, y = g[i], g[j]
                same_gran = x["granularity"] == y["granularity"]
                overlap = x["start"] <= y["end"] and y["start"] <= x["end"]
                if not overlap and same_gran:
                    continue
                if not overlap and not same_gran and (y["start"] - x["end"]).days > 40:
                    continue
                out.append({
                    "unified_name": x["unified_name"], "unified_id": uid,
                    "file_a": x["path"], "gran_a": x["granularity"], "range_a": f"{x['start']:%Y-%m-%d}..{x['end']:%Y-%m-%d}",
                    "file_b": y["path"], "gran_b": y["granularity"], "range_b": f"{y['start']:%Y-%m-%d}..{y['end']:%Y-%m-%d}",
                    "kind": ("SAME granularity, overlapping dates — double-count risk" if same_gran
                             else "different granularity, overlapping dates" if overlap
                             else "different granularity, adjacent periods (stitch)"),
                    "same_values": None,
                })
    return pd.DataFrame(out)


def proposed_name(row: pd.Series) -> str:
    """<App>_<granularity>_<region>_<start>_<end>.<ext>. No metric suffix: ST "Revenue" and
    "Downloads" exports carry both columns (and are often byte-identical)."""
    slugs = str(row["app_slugs"]).split()
    app = slugs[0] if len(slugs) == 1 else f"{slugs[0]}+{len(slugs) - 1}more"
    ext = Path(row["file"]).suffix.lower()
    return f"{app}_{row['granularity']}_{row['region']}_{row['date_min']}_{row['date_max']}{ext}"


def _md_table(df: pd.DataFrame, cols: list[str]) -> str:
    if df.empty:
        return "_none_\n"
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df[cols].iterrows():
        lines.append("| " + " | ".join(str(v).replace("|", "/") for v in r) + " |")
    return "\n".join(lines) + "\n"


def write_markdown(paths: Paths, report: pd.DataFrame, dup_groups: list[list[str]], overlaps: pd.DataFrame) -> Path:
    ok = report[report["error"].isna()] if "error" in report else report
    dup_paths = {p for g in dup_groups for p in g[1:]}
    keep = ok[~ok["path"].isin(dup_paths)].copy()
    keep["proposed_name"] = keep.apply(proposed_name, axis=1)
    keep["view"] = keep.apply(lambda r: f"{r['unified_names'][:40]} · {r['granularity_runs']} · {r['region']}", axis=1)
    keep["revenue_$M"] = (keep["revenue_total_usd"] / 1e6).round(2)
    keep["downloads_M"] = (keep["downloads_total"] / 1e6).round(2)

    md = [f"# Raw data audit — {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC\n",
          f"Files: {len(report)} · readable: {len(ok)} · errors: {len(report) - len(ok)} · "
          f"byte-identical duplicate groups: {len(dup_groups)} ({len(dup_paths)} redundant files)\n",
          "Revenue below is Sensor Tower **net** USD, summed over every row in the file "
          "(all countries/devices in it) — a file-level sanity number, not a market figure.\n",
          "## Files (after removing duplicates)\n",
          _md_table(keep, ["file", "view", "unified_apps", "rows", "revenue_$M", "downloads_M"])]
    errors = report[report["error"].notna()] if "error" in report else report.iloc[0:0]
    if len(errors):
        md += ["## Unreadable files\n", _md_table(errors, ["file", "error"])]
    suspicious = keep[keep["zero_revenue"]]
    if len(suspicious):
        md += ["## Suspicious: zero revenue in every row\n", _md_table(suspicious, ["file", "unified_names", "app_ids", "rows"])]
    md += ["## Exact duplicates (same MD5)\n"]
    for g in dup_groups:
        md.append(f"- keep `{g[0]}`\n" + "".join(f"  - duplicate `{p}`\n" for p in g[1:]))
    if not dup_groups:
        md.append("_none_\n")
    md += ["\n## Overlaps between remaining files\n",
           _md_table(overlaps, ["unified_name", "kind", "file_a", "gran_a", "range_a", "file_b", "gran_b", "range_b"])
           if len(overlaps) else "_none_\n"]
    md += ["\n## Proposed plan — NOT executed, waiting for OK\n",
           f"1. Move {len(dup_paths)} byte-identical duplicates to `data/raw/_duplicates/` (same subfolder layout).\n",
           "2. Rename the remaining files to `<App>_<granularity>_<region>_<start>_<end>_<metric>.<ext>`:\n",
           _md_table(keep, ["file", "proposed_name"])]
    out = paths.data / "audit_report.md"
    out.write_text("\n".join(md), encoding="utf-8")
    return out


def audit(paths: Paths) -> tuple[pd.DataFrame, list[list[str]], pd.DataFrame]:
    files = raw_files(paths)
    rows, app_frames = [], []
    for source, p in files:
        print(f"  reading {p.name[:90]}", flush=True)
        row, apps = audit_file(source, p, paths.root)
        rows.append(row)
        app_frames.append(apps)
    report = pd.DataFrame(rows)
    if "error" not in report:
        report["error"] = None
    dup_groups = [[p.relative_to(paths.root).as_posix() for p in g] for g in find_duplicate_groups(files)]
    report["duplicate_of"] = None
    for g in dup_groups:
        report.loc[report["path"].isin(g[1:]), "duplicate_of"] = g[0]
    apps = pd.concat([a for a in app_frames if len(a)], ignore_index=True) if any(len(a) for a in app_frames) else pd.DataFrame()
    overlaps = find_overlaps(apps, {p for g in dup_groups for p in g[1:]}) if len(apps) else pd.DataFrame()
    return report, dup_groups, overlaps


def move_duplicates(paths: Paths, groups: list[list[str]]) -> list[tuple[str, str]]:
    """Move all but the first file of each group into data/raw/_duplicates/, preserving subpaths. Never deletes."""
    moved = []
    for group in groups:
        for rel in group[1:]:
            src = paths.root / rel
            dst = paths.raw_duplicates / src.relative_to(paths.raw)
            if dst.exists():
                raise FileExistsError(f"{dst} already exists; not overwriting")
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            moved.append((rel, dst.relative_to(paths.root).as_posix()))
    return moved


def apply_plan(paths: Paths, report: pd.DataFrame, dup_groups: list[list[str]]) -> Path:
    """Move duplicates and rename the rest to the proposed names. Logs every step (with MD5) to
    data/raw/_rename_log.csv so the original export names can always be traced. Never deletes."""
    log = []
    for src, dst in move_duplicates(paths, dup_groups):
        log.append({"action": "move_duplicate", "from": src, "to": dst})
    dup_paths = {p for g in dup_groups for p in g[1:]}
    ok = report[report["error"].isna() & ~report["path"].isin(dup_paths)]
    targets = {r["path"]: (paths.root / r["path"]).with_name(proposed_name(r)) for _, r in ok.iterrows()}
    clashes = pd.Series([t.as_posix() for t in targets.values()]).duplicated(keep=False)
    if clashes.any():
        raise ValueError(f"proposed names collide: {sorted(set(pd.Series(list(targets.values()))[clashes.values]))}")
    for rel, dst in targets.items():
        src = paths.root / rel
        if src == dst:
            continue
        if dst.exists():
            raise FileExistsError(f"{dst} already exists; not overwriting")
        src.rename(dst)
        log.append({"action": "rename", "from": rel, "to": dst.relative_to(paths.root).as_posix()})
    md5s = dict(zip(report["path"], report["md5"]))
    for entry in log:
        entry["md5"] = md5s[entry["from"]]
    out = paths.raw / "_rename_log.csv"
    pd.DataFrame(log).to_csv(out, index=False, mode="a", header=not out.exists(), encoding="utf-8")
    return out


def run(paths: Paths, *, move: bool = False, confirmed: bool = False, apply: bool = False) -> pd.DataFrame:
    report, dup_groups, overlaps = audit(paths)
    report.to_csv(paths.data / "audit_report.csv", index=False, encoding="utf-8")
    if len(overlaps):
        overlaps.to_csv(paths.data / "audit_overlaps.csv", index=False, encoding="utf-8")
    md = write_markdown(paths, report, dup_groups, overlaps)
    print(f"\n{len(report)} files · {len(dup_groups)} duplicate groups · {len(overlaps)} overlaps")
    print(f"Report: data/audit_report.csv, {md.relative_to(paths.root).as_posix()}")

    if apply:
        if not confirmed:
            print("--apply-plan needs --confirmed (only after the user approved the plan). Nothing changed.")
        else:
            log = apply_plan(paths, report, dup_groups)
            print(f"Plan applied; log: {log.relative_to(paths.root).as_posix()}. Re-running audit on the new layout.")
            return run(paths)
    elif move:
        if not confirmed:
            print("--move-duplicates needs --confirmed (only after the user approved the plan). Nothing moved.")
        else:
            for src, dst in move_duplicates(paths, dup_groups):
                print(f"  moved {src} -> {dst}")
    else:
        print("Nothing was moved or renamed. Proposed plan is at the end of the markdown report.")
    return report
